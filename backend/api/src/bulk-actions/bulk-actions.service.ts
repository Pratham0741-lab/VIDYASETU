import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { RequestContext } from '../common/context/request-context';
import { requireReason } from '../common/reason';
import { DbContext } from '../database/db-context';
import { DeficienciesService } from '../deficiencies/deficiencies.service';
import { canonicalTypeForSlot } from '../documents/document-types';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { deriveFormSchema } from '../schemes/form-schema';
import { T, VIDYASETU_WORKFLOW } from '../workflow/vidyasetu-workflow';
import { WorkflowService } from '../workflow/workflow.service';
import type { BulkActionDto } from './bulk-actions.dto';

export type ItemOutcome = 'WOULD_CHANGE' | 'CHANGED' | 'NO_CHANGE' | 'SKIPPED';
export type SkipReason =
  | 'NOT_FOUND_OR_OUT_OF_SCOPE'
  | 'WRONG_STAGE_FOR_ROLE'
  | 'NEEDS_INDIVIDUAL_ELIGIBILITY_REVIEW'
  | 'HELD_BY_FRAUD_REVIEW'
  // Phase 13C (deficiency actions)
  | 'NO_MATCHING_DOCUMENT_SLOT'
  | 'NOT_DEFECTIVE'
  | 'NO_OPEN_ITEMISED_DEFICIENCY';

export interface ItemResult {
  application_id: string;
  application_no: string | null;
  outcome: ItemOutcome;
  skip_reason?: SkipReason;
  from_stage: string | null;
  to_stage?: string;
  decision_record_id?: string | null;
  fraud_flag_ids?: string[];
  /** Phase 13C: the deficiency acted on, and its items after the action. */
  deficiency_id?: string | null;
  document_slot?: string;
  deficiency_items?: Array<{ id: string; status: string; problem_code: string }>;
  checks_run?: number;
  checks_skipped?: number;
}

/**
 * Phase 13B: one officer clears many queue items with one action.
 *
 * Every item is checked on its own - visible to the caller (row-level
 * security), at a stage the caller's role acts on, no individual eligibility
 * review pending (VERIFY), not held by an unreviewed HIGH fraud flag (the
 * same rule and the same fresh detection run as the per-item hold guard) -
 * and anything that fails a check is reported as SKIPPED with its reason.
 *
 * The allowed items then go through WorkflowService.act one by one, exactly
 * like single actions (each writes its own transition, decision record and
 * audit rows), inside the request's single transaction: all of them commit
 * together, or - if any fails unexpectedly - none does and the error names
 * the item. A dry run performs the checks (without the detection run) and
 * writes nothing.
 *
 * Phase 13C adds the deficiency loop's bulk actions, through the same
 * checks and the same single transaction: ISSUE_DEFICIENCY (the same
 * itemised deficiency and reason to many applications - each through
 * DeficienciesService.issue, i.e. the mark_defective transition) and
 * RESOLVE_DEFICIENCY (each application's partial recheck; items whose
 * replaced documents now pass become RESOLVED; the stage is not changed -
 * the applicant's resubmission does that).
 */
@Injectable()
export class BulkActionsService {
  constructor(
    private readonly db: DbContext,
    private readonly workflow: WorkflowService,
    private readonly fraud: FraudDetectionService,
    private readonly deficiencies: DeficienciesService,
    @InjectPinoLogger(BulkActionsService.name) private readonly logger: PinoLogger,
  ) {}

  async run(actor: Actor, dto: BulkActionDto) {
    const dryRun = dto.dry_run === true;
    const issuing = dto.action === 'ISSUE_DEFICIENCY';
    const resolving = dto.action === 'RESOLVE_DEFICIENCY';
    // The workflow transition whose permission decides WRONG_STAGE_FOR_ROLE
    // (RESOLVE changes no stage: it needs DEFECTIVE instead).
    const transition = dto.action === 'VERIFY' ? T.VERIFY : T.MARK_DEFECTIVE;
    // One shared reason where one is needed (validated before anything else).
    const reason =
      dto.action === 'MARK_DEFECTIVE' || issuing
        ? requireReason(dto.reason, 'reason')
        : dto.reason?.trim() || undefined;
    if (dto.action === 'MARK_DEFECTIVE' && !dto.deficiency) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          { field: 'deficiency', constraints: { required: 'MARK_DEFECTIVE needs a deficiency' } },
        ],
      });
    }
    if (issuing && !dto.deficiency_item) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'deficiency_item',
            constraints: { required: 'ISSUE_DEFICIENCY needs a deficiency_item' },
          },
        ],
      });
    }
    const requestId = RequestContext.requestId() ?? '';
    const batchId = randomUUID();

    const visible = await this.db.client.application.findMany({
      where: { id: { in: dto.application_ids } },
      select: {
        id: true,
        application_no: true,
        current_stage: true,
        needs_eligibility_review: true,
        scheme_version: { select: { config: true } },
      },
    });
    const byId = new Map(visible.map((a) => [a.id, a]));

    const results: ItemResult[] = [];
    const allowed: ItemResult[] = [];
    for (const id of dto.application_ids) {
      const app = byId.get(id);
      const base: ItemResult = {
        application_id: id,
        application_no: app?.application_no ?? null,
        outcome: 'SKIPPED',
        from_stage: app?.current_stage ?? null,
      };
      if (!app) {
        results.push({ ...base, skip_reason: 'NOT_FOUND_OR_OUT_OF_SCOPE', from_stage: null });
        continue;
      }
      if (resolving) {
        if (app.current_stage !== 'DEFECTIVE') {
          results.push({ ...base, skip_reason: 'NOT_DEFECTIVE' });
          continue;
        }
      } else {
        const state = (
          VIDYASETU_WORKFLOW.states as Record<
            string,
            { transitions?: Record<string, { by: readonly string[] }> }
          >
        )[app.current_stage];
        if (!state?.transitions?.[transition]?.by.includes(actor.role)) {
          results.push({ ...base, skip_reason: 'WRONG_STAGE_FOR_ROLE' });
          continue;
        }
      }
      if (dto.action === 'VERIFY' && app.needs_eligibility_review) {
        results.push({ ...base, skip_reason: 'NEEDS_INDIVIDUAL_ELIGIBILITY_REVIEW' });
        continue;
      }
      let slot: string | undefined;
      if (issuing) {
        slot = deriveFormSchema(app.scheme_version.config).documents.checklist.find(
          (s) => canonicalTypeForSlot(s) === dto.deficiency_item!.document_type,
        );
        if (!slot) {
          results.push({ ...base, skip_reason: 'NO_MATCHING_DOCUMENT_SLOT' });
          continue;
        }
      }
      let deficiencyId: string | null = null;
      if (resolving) {
        deficiencyId = (await this.deficiencies.openItemised(id)).deficiencyId;
        if (!deficiencyId) {
          results.push({ ...base, skip_reason: 'NO_OPEN_ITEMISED_DEFICIENCY' });
          continue;
        }
      }
      // The per-item hold guard's rule: fresh detection, then any HIGH flag
      // not marked FALSE_POSITIVE holds the item (never cleared in bulk).
      if (!dryRun) await this.fraud.runForApplication(id, requestId);
      const holding = await this.fraud.holdingFlags(id, requestId);
      if (holding.length > 0) {
        results.push({
          ...base,
          skip_reason: 'HELD_BY_FRAUD_REVIEW',
          fraud_flag_ids: holding.map((f) => f.id),
        });
        continue;
      }
      const item: ItemResult = {
        ...base,
        outcome: 'WOULD_CHANGE',
        ...(slot ? { document_slot: slot } : {}),
        ...(deficiencyId ? { deficiency_id: deficiencyId } : {}),
      };
      results.push(item);
      allowed.push(item);
    }

    // Phase 17 (F4): every decision the items write in this transaction
    // carries the batch id (decision_records.bulk_batch_id takes its default
    // from this transaction-local setting), so the workload view can tell
    // bulk from individual decisions. Nothing else changes for the items.
    if (!dryRun && allowed.length > 0) {
      await this.db.client.$executeRaw`SELECT set_config('app.bulk_batch_id', ${batchId}, true)`;
    }
    for (const item of allowed) {
      if (dryRun && !resolving) continue;
      try {
        if (issuing) {
          const r = await this.deficiencies.issue(actor, item.application_id, {
            reason,
            include_failed_checks: false,
            items: [
              {
                document_slot: item.document_slot!,
                check_code: dto.deficiency_item!.check_code,
                problem_code: dto.deficiency_item!.problem_code,
              },
            ],
          });
          if ('dry_run' in r) continue;
          item.outcome = 'CHANGED';
          item.to_stage = r.current_stage;
          item.decision_record_id = r.decision_record_id;
          item.deficiency_id = r.deficiency_id;
          item.deficiency_items = r.items.map((i) => ({
            id: i.id,
            status: i.status,
            problem_code: i.problem_code,
          }));
        } else if (resolving) {
          const { app } = await this.deficiencies.openItemised(item.application_id);
          const report = await this.deficiencies.recheck(app, item.deficiency_id!, !dryRun);
          const resolvedNow = report.checks_run.filter(
            (c) => c.item_id && c.outcome !== 'FAIL' && c.outcome !== 'PENDING',
          ).length;
          item.outcome = dryRun
            ? resolvedNow > 0
              ? 'WOULD_CHANGE'
              : 'NO_CHANGE'
            : resolvedNow > 0
              ? 'CHANGED'
              : 'NO_CHANGE';
          item.deficiency_items = report.items;
          item.checks_run = report.checks_run.length;
          item.checks_skipped = report.checks_skipped.length;
        } else {
          const r = await this.workflow.act(actor, item.application_id, transition, {
            remarks: reason,
            ...(dto.action === 'MARK_DEFECTIVE' ? { deficiency: dto.deficiency } : {}),
          });
          item.outcome = 'CHANGED';
          item.to_stage = r.transition.to_stage;
          item.decision_record_id = r.decision_record_id;
        }
      } catch (err) {
        // Nothing in this batch is committed: the request's transaction rolls back.
        const code = err instanceof AppError ? err.code : ErrorCode.INTERNAL_ERROR;
        throw new AppError(ErrorCode.CONFLICT, {
          message: 'The bulk action was rolled back: one item could not be changed.',
          details: {
            reason: 'bulk_item_failed',
            batch_id: batchId,
            application_id: item.application_id,
            item_error: code,
            committed: 0,
          },
        });
      }
    }

    if (!dryRun && allowed.length > 0) {
      await this.db.client.$executeRaw`SELECT set_config('app.bulk_batch_id', '', true)`;
    }

    const summary = {
      requested: dto.application_ids.length,
      changed: results.filter((r) => r.outcome === 'CHANGED').length,
      would_change: results.filter((r) => r.outcome === 'WOULD_CHANGE').length,
      no_change: results.filter((r) => r.outcome === 'NO_CHANGE').length,
      skipped: results.filter((r) => r.outcome === 'SKIPPED').length,
    };
    // Counts only: never the reason text.
    this.logger.info({ batchId, action: dto.action, dryRun, ...summary }, 'bulk action');
    return {
      batch_id: batchId,
      action: dto.action,
      dry_run: dryRun,
      transaction: dryRun
        ? 'nothing written'
        : 'one transaction: every CHANGED item committed together; SKIPPED items untouched',
      ...summary,
      items: results,
    };
  }
}
