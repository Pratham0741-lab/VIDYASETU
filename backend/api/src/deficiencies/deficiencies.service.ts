import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { requireReason } from '../common/reason';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { canonicalTypeForSlot } from '../documents/document-types';
import { MlClientService } from '../ml-client/ml-client.service';
import { StorageService } from '../storage/storage.service';
import { applicationRef, DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { deriveFormSchema } from '../schemes/form-schema';
import { decideTransition, WorkflowError } from '../workflow/engine';
import { T, VIDYASETU_WORKFLOW } from '../workflow/vidyasetu-workflow';
import { WorkflowService } from '../workflow/workflow.service';
import {
  BoxRef,
  CheckPolicy,
  CheckResult,
  consistencyEvidence,
  cropFor,
  CropRef,
  deadlineDays,
  dependsOn,
  effectiveStatus,
  failedChecks,
  FIX_FOR,
  ITEMISED_DEFICIENCY,
  OFFICER_PROBLEMS,
  PROBLEM,
  rulesDependingOn,
  runConsistencyCheck,
  runSlotCheck,
  SlotEvidence,
  validityMonthsFor,
} from './deficiency-checks';
import type { IssueDeficiencyDto, OfficerItemDto } from './deficiencies.dto';

const APP_SELECT = {
  id: true,
  application_no: true,
  applicant_id: true,
  jurisdiction_state: true,
  jurisdiction_district: true,
  current_stage: true,
  document_consistency_details: true,
  document_consistency_checked_at: true,
  scheme_version: { select: { config: true } },
} as const;
type AppRow = Prisma.ApplicationGetPayload<{ select: typeof APP_SELECT }>;

const UNRESOLVED = ['OPEN', 'RESUBMITTED'];
/** Pixels of context around a cropped field (the ml service caps it at 200). */
const CROP_MARGIN_PX = 24;

interface NewItem {
  document_slot: string | null;
  document_type: string | null;
  field: string | null;
  check_code: string;
  source: 'CHECK' | 'OFFICER';
  problem_code: string;
  fix_code: string;
  officer_reason: string | null;
  /** Phase 13D: the region the item is about, when the page shows it. */
  crop_ref: CropRef | null;
}

export interface RecheckReport {
  deficiency_id: string;
  /** Slots whose latest document is newer than the deficiency. */
  changed_slots: string[];
  checks_run: Array<
    Omit<CheckResult, 'check'> & { check: string; item_id?: string; rules?: string[] }
  >;
  checks_skipped: Array<{
    check: string;
    slot: string | null;
    item_id?: string;
    reason: 'NO_CHANGED_INPUT' | 'MANUAL_ITEM' | 'ALREADY_RESOLVED';
  }>;
  items: Array<{
    id: string;
    status: string;
    problem_code: string;
    previous_problem_code: string | null;
  }>;
  all_cleared: boolean;
}

/**
 * Phase 13C: the deficiency loop (plan Phase 10).
 *
 *  issue    - an officer returns an application with itemised deficiencies,
 *             generated from the automatic checks that fail and/or added by
 *             the officer (with the shared reason). The stage change is the
 *             existing mark_defective transition (WorkflowService.act); the
 *             items and the notice event are written alongside it.
 *  list     - the deficiencies and items the caller may see (RLS).
 *  recheck  - partial re-verification: only the checks whose documents
 *             changed since the deficiency run; the rest are reported as
 *             skipped. Passing items resolve; failing ones stay OPEN (with a
 *             new problem code if it changed).
 *  resubmit - the applicant's recheck; when every item is cleared, the
 *             existing resubmit transition returns the application to the
 *             stage that raised it.
 */
@Injectable()
export class DeficienciesService {
  constructor(
    private readonly db: DbContext,
    private readonly workflow: WorkflowService,
    private readonly events: DomainEvents,
    private readonly config: AppConfigService,
    private readonly storage: StorageService,
    private readonly ml: MlClientService,
    @InjectPinoLogger(DeficienciesService.name) private readonly logger: PinoLogger,
  ) {}

  private async loadApp(applicationId: string): Promise<AppRow> {
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: APP_SELECT,
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    return app;
  }

  /** The validity rules for this application's scheme version (Phase 13D, M37). */
  private policy(app: AppRow): CheckPolicy {
    return {
      validityMonths: validityMonthsFor(
        app.scheme_version.config,
        this.config.deficiencies.validityMonths,
      ),
      now: new Date(),
    };
  }

  /** The latest document (and its latest extraction) per checklist slot. */
  private async evidence(app: AppRow): Promise<SlotEvidence[]> {
    const checklist = deriveFormSchema(app.scheme_version.config).documents.checklist;
    const docs = await this.db.client.document.findMany({
      where: { application_id: app.id },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        document_type: true,
        created_at: true,
        quality_usable: true,
        extractions: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            status: true,
            field_review: true,
            extracted_data: true,
            eligibility_mismatches: true,
            field_boxes: true,
          },
        },
      },
    });
    return checklist.map((slot) => {
      const d = docs.find((x) => x.document_type === slot);
      const x = d?.extractions[0];
      return {
        slot,
        document_type: canonicalTypeForSlot(slot),
        document: d
          ? { id: d.id, created_at: d.created_at, quality_usable: d.quality_usable }
          : null,
        extraction: x
          ? {
              status: x.status,
              field_review: (x.field_review ?? {}) as Record<string, string>,
              values: (x.extracted_data ?? {}) as Record<string, unknown>,
              eligibility_mismatch_fields: Array.isArray(x.eligibility_mismatches)
                ? (x.eligibility_mismatches as Array<{ field?: string }>).map((m) =>
                    String(m.field),
                  )
                : [],
              field_boxes: (x.field_boxes ?? undefined) as
                Record<string, BoxRef | null> | undefined,
            }
          : null,
      };
    });
  }

  private officerItem(dto: OfficerItemDto, slots: SlotEvidence[], reason: string): NewItem {
    const ev = slots.find((s) => s.slot === dto.document_slot);
    const invalid = (field: string, rule: string) =>
      new AppError(ErrorCode.VALIDATION_ERROR, { details: [{ field, constraints: { rule } }] });
    if (!ev)
      throw invalid('items.document_slot', 'must be one of the application’s checklist slots');
    let problem: string;
    let field: string | null = null;
    switch (dto.check_code) {
      case 'OFFICER':
        if (!dto.problem_code || !OFFICER_PROBLEMS.includes(dto.problem_code)) {
          throw invalid('items.problem_code', `must be one of ${OFFICER_PROBLEMS.join(', ')}`);
        }
        problem = dto.problem_code;
        break;
      case 'FIELD_CONFIDENCE':
        if (!dto.field || ev.extraction?.field_review[dto.field] !== 'NEEDS_REVIEW') {
          throw invalid('items.field', 'must be a field of this document marked NEEDS_REVIEW');
        }
        field = dto.field;
        problem = PROBLEM.FIELD_UNREADABLE;
        break;
      case 'DOCUMENT_PRESENT':
        problem = PROBLEM.DOCUMENT_MISSING;
        break;
      case 'QUALITY_GATE':
        problem = PROBLEM.IMAGE_UNREADABLE;
        break;
      default:
        problem = PROBLEM.DOCUMENT_EXPIRED;
    }
    return {
      document_slot: ev.slot,
      document_type: ev.document_type,
      field,
      check_code: dto.check_code,
      source: 'OFFICER',
      problem_code: problem,
      fix_code: FIX_FOR[problem],
      officer_reason: reason,
      crop_ref: cropFor(dto.check_code, ev, field),
    };
  }

  /**
   * Returns the application with itemised deficiencies. Runs inside the
   * caller's transaction (single route or a bulk batch).
   */
  async issue(actor: Actor, applicationId: string, dto: IssueDeficiencyDto) {
    const reason = requireReason(dto.reason, 'reason');
    const app = await this.loadApp(applicationId);
    // The engine's own permission check, before anything is computed or
    // written, so a dry run answers exactly as the real call would.
    try {
      decideTransition(VIDYASETU_WORKFLOW, {
        from: app.current_stage,
        transition: T.MARK_DEFECTIVE,
        principal: actor.role,
        context: { needs_eligibility_review: false, eligibility_review_confirmed: false },
      });
    } catch (err) {
      if (!(err instanceof WorkflowError)) throw err;
      throw new AppError(
        err.kind === 'PRINCIPAL_NOT_PERMITTED' ? ErrorCode.FORBIDDEN : ErrorCode.CONFLICT,
        { message: err.message, details: { reason: err.kind.toLowerCase(), ...err.details } },
      );
    }
    const slots = await this.evidence(app);
    const policy = this.policy(app);

    const items: NewItem[] = [];
    if (dto.include_failed_checks !== false) {
      const consistency = consistencyEvidence(
        app.document_consistency_details,
        app.document_consistency_checked_at,
      );
      for (const r of failedChecks(slots, consistency, policy)) {
        items.push({
          document_slot: r.slot,
          document_type: r.slot ? canonicalTypeForSlot(r.slot) : null,
          field: null,
          check_code: r.check,
          source: 'CHECK',
          problem_code: r.problem_code!,
          fix_code: r.fix_code!,
          officer_reason: null,
          crop_ref: cropFor(
            r.check,
            slots.find((x) => x.slot === r.slot),
          ),
        });
      }
    }
    for (const i of dto.items ?? []) {
      const item = this.officerItem(i, slots, reason);
      const dup = items.find(
        (x) =>
          x.document_slot === item.document_slot &&
          x.check_code === item.check_code &&
          x.field === item.field,
      );
      if (!dup) items.push(item);
    }
    if (items.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'No deficiency to raise: every check passes and no item was given.',
        details: { reason: 'no_deficiency_items' },
      });
    }

    const now = new Date();
    const days = deadlineDays(app.scheme_version.config, this.config.deficiencies.deadlineDays);
    const deadline = new Date(now.getTime() + days * 86_400_000);
    const preview = items.map((i) => ({
      ...i,
      deadline_at: deadline.toISOString(),
      crop_ref: null,
    }));
    if (dto.dry_run === true) {
      return { dry_run: true, application_id: app.id, deadline_days: days, items: preview };
    }

    // The stage change is the existing mark_defective transition.
    const t = await this.workflow.act(actor, app.id, T.MARK_DEFECTIVE, {
      remarks: reason,
      deficiency: { ...ITEMISED_DEFICIENCY },
    });
    const deficiencyId = t.deficiency_id!;
    const created = [];
    for (const i of items) {
      created.push(
        await this.db.client.deficiencyItem.create({
          data: {
            deficiency_id: deficiencyId,
            application_id: app.id,
            document_slot: i.document_slot,
            document_type: i.document_type,
            field: i.field,
            check_code: i.check_code,
            source: i.source,
            problem_code: i.problem_code,
            fix_code: i.fix_code,
            officer_reason: i.officer_reason,
            crop_ref: i.crop_ref
              ? (i.crop_ref as unknown as Prisma.InputJsonObject)
              : Prisma.DbNull,
            deadline_at: deadline,
            created_by_officer_id: actor.officerId!,
          },
          select: ITEM_SELECT,
        }),
      );
    }
    this.events.record(DOMAIN_EVENTS.DEFICIENCY_ISSUED, {
      ...applicationRef(app),
      deficiency_id: deficiencyId,
      items: created.map((c) => ({
        item_id: c.id,
        has_crop: c.crop_ref !== null,
        document_slot: c.document_slot,
        document_type: c.document_type,
        problem_code: c.problem_code,
        fix_code: c.fix_code,
        deadline_at: c.deadline_at.toISOString(),
      })),
      occurred_at: now.toISOString(),
    });
    this.logger.info(
      { applicationId: app.id, deficiencyId, items: created.length, deadlineDays: days },
      'itemised deficiency issued',
    );
    return {
      application_id: app.id,
      application_no: app.application_no,
      current_stage: t.application.current_stage,
      deficiency_id: deficiencyId,
      decision_record_id: t.decision_record_id,
      deadline_days: days,
      items: created.map((c) => this.view(c, now)),
    };
  }

  private view(i: ItemRow, now: Date) {
    return {
      id: i.id,
      document_slot: i.document_slot,
      document_type: i.document_type,
      field: i.field,
      check_code: i.check_code,
      source: i.source,
      problem_code: i.problem_code,
      fix_code: i.fix_code,
      previous_problem_code: i.previous_problem_code,
      deadline_at: i.deadline_at,
      status: effectiveStatus(i.status, i.deadline_at, now),
      stored_status: i.status,
      // The OCR service returns no bounding boxes, so there is never a crop.
      crop_ref: i.crop_ref ?? null,
      last_check: i.last_check,
      resolved_at: i.resolved_at,
    };
  }

  /** Deficiencies (with items) the caller may see; 404 outside scope (RLS). */
  async list(applicationId: string) {
    const app = await this.loadApp(applicationId);
    const now = new Date();
    const rows = await this.db.client.deficiency.findMany({
      where: { application_id: app.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        created_at: true,
        resolved_at: true,
        items: { orderBy: { created_at: 'asc' }, select: ITEM_SELECT },
      },
    });
    return {
      application_id: app.id,
      application_no: app.application_no,
      current_stage: app.current_stage,
      deficiencies: rows.map((d) => ({
        id: d.id,
        itemised: d.code === ITEMISED_DEFICIENCY.code,
        code: d.code,
        title: d.title,
        status: d.status,
        created_at: d.created_at,
        resolved_at: d.resolved_at,
        items: d.items.map((i) => this.view(i, now)),
      })),
    };
  }

  /**
   * Partial re-verification of one open itemised deficiency. With `write`
   * false (dry run) nothing is stored.
   */
  async recheck(app: AppRow, deficiencyId: string, write: boolean): Promise<RecheckReport> {
    const deficiency = await this.db.client.deficiency.findFirst({
      where: { id: deficiencyId, application_id: app.id, code: ITEMISED_DEFICIENCY.code },
      select: { id: true, status: true, created_at: true, items: { select: ITEM_SELECT } },
    });
    if (!deficiency) throw new AppError(ErrorCode.NOT_FOUND);
    if (deficiency.status !== 'OPEN') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'deficiency_not_open', status: deficiency.status },
      });
    }
    const slots = await this.evidence(app);
    const policy = this.policy(app);
    const changed = slots.filter(
      (s) => s.document && s.document.created_at > deficiency.created_at,
    );
    const changedSet = new Set(changed.map((s) => s.slot));
    const latestChange =
      changed.length === 0
        ? null
        : new Date(Math.max(...changed.map((s) => s.document!.created_at.getTime())));
    const consistency = consistencyEvidence(
      app.document_consistency_details,
      app.document_consistency_checked_at,
    );

    const report: RecheckReport = {
      deficiency_id: deficiency.id,
      changed_slots: [...changedSet].sort(),
      checks_run: [],
      checks_skipped: [],
      items: [],
      all_cleared: false,
    };
    const now = new Date();
    for (const item of deficiency.items) {
      if (item.status === 'RESOLVED') {
        report.checks_skipped.push({
          check: item.check_code,
          slot: item.document_slot,
          item_id: item.id,
          reason: 'ALREADY_RESOLVED',
        });
        report.items.push(itemSummary(item));
        continue;
      }
      const dep = dependsOn(item);
      if (dep.kind === 'manual') {
        // No automatic check: a replacement upload leaves it for the officer.
        const replaced = item.document_slot !== null && changedSet.has(item.document_slot);
        report.checks_skipped.push({
          check: 'OFFICER',
          slot: item.document_slot,
          item_id: item.id,
          reason: 'MANUAL_ITEM',
        });
        if (write && replaced && item.status !== 'RESUBMITTED') {
          await this.update(item.id, { status: 'RESUBMITTED' });
        }
        report.items.push({ ...itemSummary(item), status: replaced ? 'RESUBMITTED' : item.status });
        continue;
      }
      const inputChanged =
        dep.kind === 'all_documents' ? changed.length > 0 : changedSet.has(dep.slot);
      if (!inputChanged) {
        report.checks_skipped.push({
          check: item.check_code,
          slot: item.document_slot,
          item_id: item.id,
          reason: 'NO_CHANGED_INPUT',
        });
        report.items.push(itemSummary(item));
        continue;
      }
      const result =
        dep.kind === 'all_documents'
          ? runConsistencyCheck(
              item.check_code as 'NAME_CONSISTENCY' | 'DOB_CONSISTENCY',
              consistency,
              latestChange,
            )
          : runSlotCheck(
              item.check_code as
                'DOCUMENT_PRESENT' | 'QUALITY_GATE' | 'DOCUMENT_VALIDITY' | 'FIELD_CONFIDENCE',
              slots.find((s) => s.slot === dep.slot)!,
              policy,
              item.field ?? undefined,
            );
      report.checks_run.push({ ...result, item_id: item.id });

      const lastCheck = {
        check: result.check,
        outcome: result.outcome,
        problem_code: result.problem_code ?? null,
        note: result.note ?? null,
        ran_at: now.toISOString(),
      };
      let next: { status: string; problem_code: string; previous_problem_code: string | null };
      if (result.outcome === 'PASS' || result.outcome === 'NOT_APPLICABLE') {
        next = {
          status: 'RESOLVED',
          problem_code: item.problem_code,
          previous_problem_code: item.previous_problem_code,
        };
      } else if (result.outcome === 'FAIL') {
        const changedProblem = result.problem_code !== item.problem_code;
        next = {
          status: 'OPEN',
          problem_code: result.problem_code!,
          previous_problem_code: changedProblem ? item.problem_code : item.previous_problem_code,
        };
      } else {
        next = {
          status: 'RESUBMITTED',
          problem_code: item.problem_code,
          previous_problem_code: item.previous_problem_code,
        };
      }
      if (write) {
        await this.update(item.id, {
          status: next.status,
          problem_code: next.problem_code,
          fix_code: FIX_FOR[next.problem_code] ?? item.fix_code,
          previous_problem_code: next.previous_problem_code,
          resolved_at: next.status === 'RESOLVED' ? now : null,
          last_check: lastCheck,
          last_checked_at: now,
          // Phase 13D: a still-failing item points at the region on the new document.
          ...(next.status === 'OPEN'
            ? {
                crop_ref:
                  (cropFor(
                    item.check_code,
                    slots.find((x) => x.slot === item.document_slot),
                    item.field,
                  ) as unknown as Prisma.InputJsonObject | null) ?? Prisma.DbNull,
              }
            : {}),
        });
      }
      report.items.push({
        id: item.id,
        status: next.status,
        problem_code: next.problem_code,
        previous_problem_code: next.previous_problem_code,
      });
    }

    // The eligibility criteria that depend on a changed document (doc_refs):
    // the pipeline's cross-check result for the new document. Unchanged
    // documents' checks are not re-run.
    for (const s of slots) {
      const rules = rulesDependingOn(s.document_type, app.scheme_version.config);
      if (changedSet.has(s.slot)) {
        if (rules.length === 0) continue;
        const pendingExtraction = !s.extraction;
        report.checks_run.push({
          check: 'ELIGIBILITY_CROSS_CHECK',
          slot: s.slot,
          rules,
          outcome: pendingExtraction
            ? 'PENDING'
            : s.extraction!.eligibility_mismatch_fields.length === 0
              ? 'PASS'
              : 'FAIL',
          ...(pendingExtraction ? { note: 'extraction_pending' } : {}),
        });
      } else {
        const itemChecks = new Set(
          deficiency.items.filter((i) => i.document_slot === s.slot).map((i) => i.check_code),
        );
        for (const check of ['DOCUMENT_PRESENT', 'QUALITY_GATE', 'DOCUMENT_VALIDITY']) {
          if (!itemChecks.has(check)) {
            report.checks_skipped.push({ check, slot: s.slot, reason: 'NO_CHANGED_INPUT' });
          }
        }
        if (rules.length > 0) {
          report.checks_skipped.push({
            check: `ELIGIBILITY_CROSS_CHECK:${rules.join(',')}`,
            slot: s.slot,
            reason: 'NO_CHANGED_INPUT',
          });
        }
      }
    }
    report.all_cleared = report.items.every(
      (i) =>
        i.status === 'RESOLVED' || (i.status === 'RESUBMITTED' && isManual(deficiency.items, i.id)),
    );
    this.logger.info(
      {
        applicationId: app.id,
        deficiencyId: deficiency.id,
        write,
        changedSlots: report.changed_slots.length,
        checksRun: report.checks_run.length,
        checksSkipped: report.checks_skipped.length,
        resolved: report.items.filter((i) => i.status === 'RESOLVED').length,
        open: report.items.filter((i) => i.status !== 'RESOLVED').length,
      },
      'deficiency recheck',
    );
    return report;
  }

  /**
   * Phase 13D: the region of the stored document an item is about - cut on
   * demand by the ml service, never the whole page, never written anywhere.
   * Visible exactly when the item is (RLS: the owning applicant and
   * officers in jurisdiction); 404 otherwise, and when the item has no crop.
   */
  async crop(applicationId: string, itemId: string): Promise<Buffer> {
    const app = await this.loadApp(applicationId);
    const item = await this.db.client.deficiencyItem.findFirst({
      where: { id: itemId, application_id: app.id },
      select: { crop_ref: true },
    });
    const ref = item?.crop_ref as unknown as CropRef | null | undefined;
    if (!ref) throw new AppError(ErrorCode.NOT_FOUND);
    const doc = await this.db.client.document.findFirst({
      where: { id: ref.document_id, application_id: app.id },
      select: { file_path: true },
    });
    if (!doc) throw new AppError(ErrorCode.NOT_FOUND);
    const image = await this.storage.get(this.storage.documentsBucket, doc.file_path);
    const crop = await this.ml.cropImage(image, ref, CROP_MARGIN_PX);
    const png = Buffer.from(crop.png_base64, 'base64');
    // Ids and sizes only.
    this.logger.info(
      { applicationId: app.id, itemId, bytes: png.length, region: crop.region },
      'deficiency crop served',
    );
    return png;
  }

  private update(id: string, data: Prisma.DeficiencyItemUpdateInput) {
    return this.db.client.deficiencyItem.update({ where: { id }, data, select: { id: true } });
  }

  /**
   * The applicant resubmits: partial re-verification, then - only if every
   * item is cleared - the existing resubmit transition.
   */
  async resubmit(
    actor: Actor,
    applicationId: string,
    deficiencyId: string,
    declared?: Record<string, unknown>,
  ) {
    if (actor.role !== AppRole.APPLICANT) throw new AppError(ErrorCode.FORBIDDEN);
    const app = await this.loadApp(applicationId);
    if (app.current_stage !== 'DEFECTIVE') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'not_defective', current_stage: app.current_stage },
      });
    }
    const report = await this.recheck(app, deficiencyId, true);
    let transition: { from_stage: string; to_stage: string } | null = null;
    if (report.all_cleared) {
      await this.db.client.deficiency.update({
        where: { id: deficiencyId },
        data: { status: 'RESOLVED', resolved_at: new Date() },
        select: { id: true },
      });
      const t = await this.workflow.act(actor, app.id, T.RESUBMIT, declared ? { declared } : {});
      transition = { from_stage: t.transition.from_stage, to_stage: t.transition.to_stage };
    }
    return {
      application_id: app.id,
      resubmitted: transition !== null,
      transition,
      ...report,
    };
  }

  /** For bulk RESOLVE: the application's open itemised deficiency, if any. */
  async openItemised(applicationId: string) {
    const app = await this.loadApp(applicationId);
    const d = await this.db.client.deficiency.findFirst({
      where: { application_id: app.id, code: ITEMISED_DEFICIENCY.code, status: 'OPEN' },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });
    return { app, deficiencyId: d?.id ?? null };
  }

  /**
   * Upload guard (documents): while an application is DEFECTIVE with open
   * items, only the documents named in them may be replaced (any document if
   * an item is about all documents, e.g. a name mismatch).
   */
  async assertUploadAllowed(applicationId: string, currentStage: string, slot: string) {
    if (currentStage !== 'DEFECTIVE') return;
    const open = await this.openItems(applicationId);
    if (open.length === 0) return;
    if (open.some((i) => i.document_slot === null) || open.some((i) => i.document_slot === slot)) {
      return;
    }
    throw new AppError(ErrorCode.CONFLICT, {
      message: 'Only the documents named in your open deficiency items can be uploaded now.',
      details: {
        reason: 'slot_not_in_open_deficiency',
        allowed_slots: [...new Set(open.map((i) => i.document_slot))].sort(),
      },
    });
  }

  /** After an upload: the items about that slot are RESUBMITTED with the new document. */
  async markResubmitted(applicationId: string, slot: string, documentId: string) {
    const open = (await this.openItems(applicationId)).filter((i) => i.document_slot === slot);
    for (const i of open) {
      await this.update(i.id, {
        status: 'RESUBMITTED',
        resubmitted_document: { connect: { id: documentId } },
      });
    }
    return open.length;
  }

  private openItems(applicationId: string) {
    return this.db.client.deficiencyItem.findMany({
      where: {
        application_id: applicationId,
        status: { in: UNRESOLVED },
        deficiency: { status: 'OPEN', code: ITEMISED_DEFICIENCY.code },
      },
      select: { id: true, document_slot: true },
    });
  }
}

const ITEM_SELECT = {
  id: true,
  document_slot: true,
  document_type: true,
  field: true,
  check_code: true,
  source: true,
  problem_code: true,
  fix_code: true,
  previous_problem_code: true,
  deadline_at: true,
  status: true,
  crop_ref: true,
  last_check: true,
  resolved_at: true,
} as const;
type ItemRow = Prisma.DeficiencyItemGetPayload<{ select: typeof ITEM_SELECT }>;

function itemSummary(i: ItemRow) {
  return {
    id: i.id,
    status: i.status,
    problem_code: i.problem_code,
    previous_problem_code: i.previous_problem_code,
  };
}

function isManual(items: ItemRow[], id: string): boolean {
  return items.find((i) => i.id === id)?.check_code === 'OFFICER';
}
