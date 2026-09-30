import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DenialRecorder } from '../authorization-denials/denial-recorder.service';
import { AppConfigService } from '../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { DocumentPipelineProcessor, PipelineJob } from './document-pipeline.processor';

export const DOCUMENT_PIPELINE_QUEUE = 'document-pipeline';

/**
 * Attempts before a job is recorded as FAILED. The first attempt is delayed:
 * the job is enqueued inside the upload's transaction, before it commits, and
 * the worker's insert references that document row (a retry covers a slow
 * commit; a rolled-back upload never succeeds and simply fails).
 */
export const PIPELINE_ATTEMPTS = 4;
const FIRST_ATTEMPT_DELAY_MS = 1500;

/**
 * BullMQ wiring for the document pipeline (classify -> extract -> maybe
 * consistency). Uses its own Redis connections (BullMQ needs
 * maxRetriesPerRequest: null), built from RedisService.connectionOptions().
 * The queue is created on first use; the worker starts at bootstrap unless
 * DOCUMENT_WORKER_ENABLED=false (the e2e test environment, which has no
 * Redis).
 */
@Injectable()
export class DocumentPipelineQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private queue: Queue<PipelineJob> | null = null;
  private worker: Worker<PipelineJob> | null = null;
  private lastErrorLoggedAt = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly processor: DocumentPipelineProcessor,
    private readonly denials: DenialRecorder,
    @InjectPinoLogger(DocumentPipelineQueue.name) private readonly logger: PinoLogger,
  ) {}

  private connection() {
    return { ...this.redis.connectionOptions(), maxRetriesPerRequest: null };
  }

  async enqueue(job: PipelineJob): Promise<void> {
    this.queue ??= new Queue<PipelineJob>(DOCUMENT_PIPELINE_QUEUE, {
      connection: this.connection(),
    });
    await this.queue.add('process-document', job, {
      jobId: job.documentId, // one pipeline run per document
      delay: FIRST_ATTEMPT_DELAY_MS,
      attempts: PIPELINE_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  onApplicationBootstrap(): void {
    if (!this.config.documents.workerEnabled) return;
    this.worker = new Worker<PipelineJob>(
      DOCUMENT_PIPELINE_QUEUE,
      (job: Job<PipelineJob>) =>
        this.processor.process(job.data, {
          attempt: job.attemptsMade + 1,
          finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
        }),
      { connection: this.connection(), concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        { err, documentId: job?.data.documentId, attempt: job?.attemptsMade },
        'document pipeline attempt failed',
      );
      // Refused privileged actions (e.g. a failed SYSTEM-actor guard) are
      // recorded by the same classifier/recorder as HTTP refusals.
      void this.denials.recordJob(err, {
        queue: DOCUMENT_PIPELINE_QUEUE,
        jobId: job?.id ?? null,
        attempt: job?.attemptsMade ?? null,
        requestId: job?.data.requestId ?? null,
        subjectType: job ? 'application' : null,
        subjectId: job?.data.applicationId ?? null,
      });
    });
    this.worker.on('error', (err) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt >= 10_000) {
        this.lastErrorLoggedAt = now;
        this.logger.error({ err }, 'document pipeline worker error');
      }
    });
    this.logger.info('document pipeline worker started');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }
}
