import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { DOMAIN_EVENTS, WorkflowTransitionEvent } from '../events/domain-events';
import {
  AppFacts,
  DetectorContext,
  detectDuplicateFileHash,
  detectFuzzyIdentityMatch,
  detectInstitutionSurge,
  detectRepeatedCertificateNumber,
  detectSharedBankAccount,
  FlagDraft,
  SurgeResult,
} from './detectors';
import { PrismaFraudData } from './fraud-data';
import { HOLDING_STATUSES } from './holding';

/** Re-exported: the hold rule lives in ./holding (also read by Phase 6's selection pool). */
export { HOLDING_STATUSES };

export interface DetectionRun {
  application_id: string;
  new_flags: number;
  /** Existing INSTITUTION_SURGE flags whose figures were brought up to date. */
  refreshed_flags: number;
  surge: SurgeResult | null;
}

/**
 * Runs the Phase 11 detectors for one application as the SYSTEM actor, in a
 * transaction of its own (detection needs every jurisdiction; its reads go
 * through the SYSTEM-only fraud_*_facts functions and pii_match_index), and
 * records each finding once (dedup_key). Detection only: it never changes an
 * application, a document or a workflow stage.
 */
@Injectable()
export class FraudDetectionService {
  constructor(
    private readonly systemTx: SystemTransactionRunner,
    private readonly data: PrismaFraudData,
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    @InjectPinoLogger(FraudDetectionService.name) private readonly logger: PinoLogger,
  ) {}

  private matchKey: Buffer | null = null;

  private ctx(): DetectorContext {
    this.matchKey ??= Buffer.from(this.config.fraud.matchKeyBase64, 'base64');
    return { data: this.data, matchKey: this.matchKey, now: () => new Date() };
  }

  async runForApplication(applicationId: string, requestId: string): Promise<DetectionRun> {
    return this.systemTx.run(requestId, async () => {
      const ctx = this.ctx();
      const [app] = await this.data.applications({ applicationIds: [applicationId] });
      if (!app) {
        return { application_id: applicationId, new_flags: 0, refreshed_flags: 0, surge: null };
      }
      const drafts: FlagDraft[] = [
        ...(await detectSharedBankAccount(ctx, applicationId)),
        ...(await detectRepeatedCertificateNumber(ctx, applicationId)),
      ];
      for (const d of await this.data.documents({ applicationId })) {
        drafts.push(...(await detectDuplicateFileHash(ctx, d.document_id)));
      }
      drafts.push(...(await detectFuzzyIdentityMatch(ctx, app.applicant_id)));
      let surge: SurgeResult | null = null;
      if (app.institution_code) {
        const { windowDays, ...rest } = this.config.fraud.surge;
        surge = await detectInstitutionSurge(ctx, app.institution_code, windowDays, rest);
        drafts.push(...surge.flags);
      }
      const created = await this.db.client.fraudFlag.createMany({
        data: drafts.map((d) => ({ ...d, evidence: d.evidence as Prisma.InputJsonObject })),
        skipDuplicates: true, // one flag per finding (dedup_key)
      });
      // A surge flag already raised this week keeps its identity and any
      // disposition; only its figures follow the current window count.
      let refreshed = 0;
      for (const d of drafts.filter((x) => x.flag_type === 'INSTITUTION_SURGE')) {
        const [row] = await this.db.client.$queryRaw<Array<{ updated: number }>>`
          SELECT fraud_refresh_surge_flag(${d.dedup_key}, ${d.summary},
            ${JSON.stringify(d.evidence)}::jsonb, ${d.related_application_ids}::uuid[]) AS updated`;
        refreshed += row?.updated ?? 0;
      }
      // Counts and types only: never evidence, never an identifier.
      this.logger.info(
        {
          applicationId,
          drafts: drafts.length,
          new_flags: created.count,
          refreshed_flags: refreshed,
          types: [...new Set(drafts.map((d) => d.flag_type))],
        },
        'fraud detection run',
      );
      return {
        application_id: applicationId,
        new_flags: created.count,
        refreshed_flags: refreshed,
        surge,
      };
    });
  }

  /**
   * One pass of detection over every existing application (index + flags),
   * for data that predates Phase 11. Idempotent: flags dedupe, the index upserts.
   */
  async backfill(requestId: string): Promise<{ applications: number; new_flags: number }> {
    let after: string | null = null;
    let applications = 0;
    let newFlags = 0;
    for (;;) {
      const page: string[] = await this.systemTx.run(requestId, async () =>
        (
          await this.db.client.$queryRaw<Array<{ application_id: string }>>`
            SELECT application_id FROM fraud_application_ids_page(${after}::uuid, 200)`
        ).map((r) => r.application_id),
      );
      if (page.length === 0) break;
      for (const id of page) {
        newFlags += (await this.runForApplication(id, requestId)).new_flags;
        applications += 1;
      }
      after = page[page.length - 1];
    }
    this.logger.info({ applications, new_flags: newFlags }, 'fraud detection backfill');
    return { applications, new_flags: newFlags };
  }

  /** Application facts (any jurisdiction), by application or disbursement id. */
  async facts(
    q: { applicationId?: string; disbursementId?: string },
    requestId: string,
  ): Promise<AppFacts | null> {
    return this.systemTx.run(requestId, async () => {
      const [app] = await this.data.applications(
        q.applicationId
          ? { applicationIds: [q.applicationId] }
          : { disbursementIds: [q.disbursementId!] },
      );
      return app ?? null;
    });
  }

  /** Open HIGH flags that hold this application (read as SYSTEM). */
  async holdingFlags(applicationId: string, requestId: string) {
    return this.systemTx.run(requestId, () =>
      this.db.client.fraudFlag.findMany({
        where: {
          application_id: applicationId,
          severity: 'HIGH',
          status: { in: [...HOLDING_STATUSES] },
        },
        select: { id: true, flag_type: true, status: true },
        orderBy: { created_at: 'asc' },
      }),
    );
  }

  /**
   * Detection after every workflow transition (the automatic eligibility gate
   * at submission included): Phase 8's existing event, subscribed to, not
   * changed. At-most-once like every Phase 8 consumer - which is why the hold
   * guard also re-runs detection before a forward action.
   */
  @OnEvent(DOMAIN_EVENTS.WORKFLOW_TRANSITION, {
    async: true,
    promisify: true,
    suppressErrors: true,
  })
  async onTransition(e: WorkflowTransitionEvent): Promise<void> {
    try {
      await this.runForApplication(e.application_id, `fraud:${e.workflow_transition_id}`);
    } catch (err) {
      this.logger.error(
        { err, applicationId: e.application_id },
        'fraud detection after transition failed',
      );
    }
  }
}

/** Phase 2's jurisdiction rule (jurisdiction-scope.ts) applied to one application's facts. */
export function actorCoversApplication(actor: Actor, app: AppFacts): boolean {
  if (actor.role === AppRole.APPLICANT) return false;
  if (actor.officerId && app.assigned_officer_id === actor.officerId) return true;
  if (actor.jurisdictionState === null) return true;
  if (actor.jurisdictionState !== app.jurisdiction_state) return false;
  return (
    actor.jurisdictionDistrict === null || actor.jurisdictionDistrict === app.jurisdiction_district
  );
}
