import { randomUUID } from 'node:crypto';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { RedisService } from '../redis/redis.service';

export const RETENTION_QUEUE = 'data-retention';
const SCHEDULER_ID = 'data-retention-every';

export const RETENTION_CLASSES = ['notifications', 'refresh_tokens', 'application_drafts'] as const;
type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface RetentionResult {
  retention_run_id: string;
  trigger: 'SCHEDULE' | 'MANUAL';
  dry_run: boolean;
  run_at: string;
  policy: Record<RetentionClass, { days: number; cutoff: string | null }>;
  counts: Record<RetentionClass, { eligible: number; protected: number; deleted: number }>;
}

interface RunRow {
  run_id: string;
  policy: RetentionResult['policy'];
  counts: RetentionResult['counts'];
}

/**
 * Phase 17 (Part C): data retention.
 *
 * Three data classes, each purged after its own period (config, days; 0 =
 * never): delivered / failed notifications, expired / revoked refresh
 * tokens, abandoned application drafts. Anything whose application has an
 * open grievance or deficiency is kept. The rules live in one place, the
 * database function retention_apply() - SECURITY DEFINER, SYSTEM actor only,
 * naming only those three tables - so audit_logs, the denial log, decision
 * records, final lists, sanction orders and disbursements are out of its
 * reach by construction.
 *
 * Every run, dry or real, records one retention_runs row (audited): the
 * cutoffs and the counts, never an id or a value. A dry run deletes nothing.
 *
 * Scheduled as a BullMQ repeatable job every RETENTION_INTERVAL_MS only when
 * RETENTION_ENABLED=true (default false), and then a dry run unless
 * RETENTION_DRY_RUN=false. SUPER_ADMIN can run it on demand (dry run unless
 * asked otherwise).
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private lastErrorLoggedAt = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly systemTx: SystemTransactionRunner,
    private readonly db: DbContext,
    @InjectPinoLogger(RetentionService.name) private readonly logger: PinoLogger,
  ) {}

  async run(
    trigger: 'SCHEDULE' | 'MANUAL',
    dryRun: boolean,
    triggeredByAccountId: string | null = null,
    now: Date = new Date(),
  ): Promise<RetentionResult> {
    const { notificationsDays, refreshTokensDays, draftsDays } = this.config.retention;
    const [row] = await this.systemTx.run(
      `retention:${randomUUID()}`,
      () =>
        this.db.client.$queryRaw<RunRow[]>`
        SELECT * FROM retention_apply(${now}::timestamptz, ${dryRun}, ${notificationsDays}::int,
          ${refreshTokensDays}::int, ${draftsDays}::int, ${trigger}, ${triggeredByAccountId}::uuid)`,
    );
    // Counts only: never an id or a value from the purged rows.
    this.logger.info(
      { retentionRunId: row.run_id, trigger, dryRun, counts: row.counts },
      'data retention run',
    );
    return {
      retention_run_id: row.run_id,
      trigger,
      dry_run: dryRun,
      run_at: now.toISOString(),
      policy: row.policy,
      counts: row.counts,
    };
  }

  /** The recorded runs (counts only), newest first. */
  async runs(limit = 50) {
    const rows = await this.db.client.retentionRun.findMany({
      orderBy: [{ run_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return { count: rows.length, runs: rows };
  }

  private connection() {
    return { ...this.redis.connectionOptions(), maxRetriesPerRequest: null };
  }

  async onApplicationBootstrap(): Promise<void> {
    const { enabled, intervalMs, dryRun } = this.config.retention;
    if (!enabled) return;
    this.queue = new Queue(RETENTION_QUEUE, { connection: this.connection() });
    this.worker = new Worker(
      RETENTION_QUEUE,
      async (_job: Job) => {
        const r = await this.run('SCHEDULE', dryRun);
        return { retention_run_id: r.retention_run_id, dry_run: r.dry_run };
      },
      { connection: this.connection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ err, jobId: job?.id }, 'data retention run failed'),
    );
    this.worker.on('error', (err) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt >= 10_000) {
        this.lastErrorLoggedAt = now;
        this.logger.error({ err }, 'data retention worker error');
      }
    });
    // One repeatable schedule, replaced (not duplicated) on every start.
    try {
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: intervalMs },
        { name: 'data-retention', opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
      this.logger.info({ intervalMs, dryRun }, 'data retention scheduled');
    } catch (err) {
      this.logger.error({ err }, 'data retention could not be scheduled');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }
}
