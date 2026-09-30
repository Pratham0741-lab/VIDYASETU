import { randomUUID } from 'node:crypto';
import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { RedisService } from '../redis/redis.service';
import { STAGE_SLA_DAYS } from './vidyasetu-workflow';

export const SLA_SWEEP_QUEUE = 'sla-sweep';
const SCHEDULER_ID = 'sla-sweep-every';

interface BreachRow {
  breach_id: string;
  application_id: string;
  application_no: string;
  applicant_id: string;
  jurisdiction_state: string;
  jurisdiction_district: string | null;
  stage: string;
  stage_entered_at: Date;
  stage_due_at: Date;
  sla_days: unknown;
  detected_at: Date;
  newly_recorded: boolean;
}

export interface SweepResult {
  sweep_run_id: string;
  checked_at: string;
  trigger: 'SCHEDULE' | 'MANUAL';
  /** Stage instances past their due time at checked_at (recorded now or before). */
  breached_now: number;
  /** Recorded by this run (each emits one SLA_BREACHED event). */
  newly_recorded: number;
  already_recorded: number;
  breaches: Array<{
    sla_breach_id: string;
    application_id: string;
    application_no: string;
    stage: string;
    stage_entered_at: string;
    stage_due_at: string;
    sla_days: number;
    detected_at: string;
    newly_recorded: boolean;
  }>;
}

/**
 * The SLA breach sweep (Phase 14 loose ends, Part B; plan Phase 5).
 *
 * Breach rule: the one the on-demand endpoint (findBreached / slaView) and
 * the analytics SLA view already use - the current stage's stage_due_at is
 * before now. Due times come only from the workflow (STAGE_SLA_DAYS, set when
 * the stage is entered); nothing here invents a duration.
 *
 * One breach per stage instance (application, stage, stage_entered_at),
 * recorded by sla_record_breaches() as the SYSTEM actor (audited, unique
 * key: a second sweep records nothing new). Each NEW record emits one
 * SLA_BREACHED domain event after the transaction commits; the notification
 * listener tells the officer role(s) acting at that stage.
 *
 * Scheduled as a BullMQ repeatable job every SLA_SWEEP_INTERVAL_MS
 * (SLA_SWEEP_ENABLED=false: no scheduler, no worker). SUPER_ADMIN can also
 * run it on demand (POST /applications/sla-breaches/sweep).
 */
@Injectable()
export class SlaSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private lastErrorLoggedAt = 0;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly systemTx: SystemTransactionRunner,
    private readonly db: DbContext,
    private readonly events: DomainEvents,
    @InjectPinoLogger(SlaSweepService.name) private readonly logger: PinoLogger,
  ) {}

  async sweep(
    trigger: 'SCHEDULE' | 'MANUAL',
    triggeredByAccountId: string | null = null,
    now: Date = new Date(),
  ): Promise<SweepResult> {
    const runId = randomUUID();
    const rows = await this.systemTx.run(
      `sla-sweep:${runId}`,
      () =>
        this.db.client.$queryRaw<BreachRow[]>`
        SELECT * FROM sla_record_breaches(${now}::timestamptz, ${runId}::uuid, ${triggeredByAccountId}::uuid)`,
    );
    // After the SYSTEM transaction committed: one event per NEW record.
    for (const r of rows.filter((x) => x.newly_recorded)) {
      this.events.record(DOMAIN_EVENTS.SLA_BREACHED, {
        application_id: r.application_id,
        application_no: r.application_no,
        applicant_id: r.applicant_id,
        jurisdiction_state: r.jurisdiction_state,
        jurisdiction_district: r.jurisdiction_district,
        sla_breach_id: r.breach_id,
        stage: r.stage,
        stage_entered_at: r.stage_entered_at.toISOString(),
        stage_due_at: r.stage_due_at.toISOString(),
        sla_days: Number(r.sla_days),
        detected_at: r.detected_at.toISOString(),
        sweep_run_id: runId,
        occurred_at: now.toISOString(),
      });
    }
    const fresh = rows.filter((r) => r.newly_recorded).length;
    // Ids and counts only: never an applicant value.
    this.logger.info(
      {
        sweepRunId: runId,
        trigger,
        breachedNow: rows.length,
        newlyRecorded: fresh,
        stageSlaDays: STAGE_SLA_DAYS,
      },
      'sla sweep',
    );
    return {
      sweep_run_id: runId,
      checked_at: now.toISOString(),
      trigger,
      breached_now: rows.length,
      newly_recorded: fresh,
      already_recorded: rows.length - fresh,
      breaches: rows.map((r) => ({
        sla_breach_id: r.breach_id,
        application_id: r.application_id,
        application_no: r.application_no,
        stage: r.stage,
        stage_entered_at: r.stage_entered_at.toISOString(),
        stage_due_at: r.stage_due_at.toISOString(),
        sla_days: Number(r.sla_days),
        detected_at: r.detected_at.toISOString(),
        newly_recorded: r.newly_recorded,
      })),
    };
  }

  /** Recorded breaches visible to the caller (jurisdiction RLS), newest first. */
  async recorded(limit = 100) {
    const rows = await this.db.client.slaBreach.findMany({
      orderBy: [{ detected_at: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return {
      count: rows.length,
      breaches: rows.map((r) => ({ ...r, sla_days: Number(r.sla_days) })),
    };
  }

  private connection() {
    return { ...this.redis.connectionOptions(), maxRetriesPerRequest: null };
  }

  async onApplicationBootstrap(): Promise<void> {
    const { enabled, intervalMs } = this.config.slaSweep;
    if (!enabled) return;
    this.queue = new Queue(SLA_SWEEP_QUEUE, { connection: this.connection() });
    this.worker = new Worker(
      SLA_SWEEP_QUEUE,
      async (_job: Job) => {
        const r = await this.sweep('SCHEDULE');
        return { sweep_run_id: r.sweep_run_id, newly_recorded: r.newly_recorded };
      },
      { connection: this.connection(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.warn({ err, jobId: job?.id }, 'sla sweep failed'),
    );
    this.worker.on('error', (err) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt >= 10_000) {
        this.lastErrorLoggedAt = now;
        this.logger.error({ err }, 'sla sweep worker error');
      }
    });
    // One repeatable schedule, replaced (not duplicated) on every start.
    try {
      await this.queue.upsertJobScheduler(
        SCHEDULER_ID,
        { every: intervalMs },
        { name: 'sla-sweep', opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
      this.logger.info({ intervalMs }, 'sla sweep scheduled');
    } catch (err) {
      this.logger.error({ err }, 'sla sweep could not be scheduled');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }
}
