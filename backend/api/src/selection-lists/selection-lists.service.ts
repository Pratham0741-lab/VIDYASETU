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
import { DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { GrievanceService } from '../post-selection/grievance.service';
import { decideTransition, WorkflowError } from '../workflow/engine';
import {
  finalOutcome,
  ListContext,
  ListState,
  LT,
  SELECTION_LIST_WORKFLOW,
} from './selection-list-workflow';

/** What a committed selection run hands over (SelectionService.run). */
export interface RunForList {
  runId: string;
  schemeCode: string;
  academicYear: string;
  selected: Array<{
    application_id: string;
    selection_id: string | null;
    merit_rank: number | null;
    vertical_category: string;
    horizontal_reservation: string | null;
  }>;
  notSelected: Array<{
    application_id: string;
    merit_rank: number | null;
    vertical_category: string;
    reason: string;
  }>;
  held: Array<{ application_id: string }>;
}

const LIST_SELECT = {
  id: true,
  selection_run_id: true,
  scheme_code: true,
  academic_year: true,
  status: true,
  approvals_required: true,
  objection_window_days: true,
  provisional_published_at: true,
  window_closes_at: true,
  window_closed_at: true,
  window_closed_early: true,
  final_published_at: true,
  created_at: true,
} as const;

/**
 * Phase 13E: committee review, publication, objections and the final list,
 * around the Phase 6 allocator (never re-run, never changed). Every action
 * is decided by SELECTION_LIST_WORKFLOW (who, in which state, guards) and
 * writes an audited row; committee decisions are insert-only rows with their
 * reasons. Entries are read through row-level security, so a committee
 * member sees and acts on its own jurisdiction only.
 */
@Injectable()
export class SelectionListsService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    private readonly events: DomainEvents,
    private readonly fraud: FraudDetectionService,
    private readonly grievances: GrievanceService,
    @InjectPinoLogger(SelectionListsService.name) private readonly logger: PinoLogger,
  ) {}

  /** Called by the selection run after it commits its rows: the DRAFT list. */
  async createForRun(run: RunForList): Promise<string> {
    const client = this.db.client;
    const list = await client.selectionList.create({
      data: {
        selection_run_id: run.runId,
        scheme_code: run.schemeCode,
        academic_year: run.academicYear,
        approvals_required: this.config.selectionLists.approvalsRequired,
        objection_window_days: this.config.postSelection.objectionWindowDays,
      },
      select: { id: true },
    });
    const rows: Prisma.SelectionListEntryCreateManyInput[] = [
      ...run.selected.map((s) => ({
        selection_list_id: list.id,
        application_id: s.application_id,
        selection_id: s.selection_id,
        computed_outcome: 'SELECTED',
        computed_rank: s.merit_rank,
        vertical_category: s.vertical_category,
        horizontal_reservation: s.horizontal_reservation,
      })),
      ...run.notSelected.map((n) => ({
        selection_list_id: list.id,
        application_id: n.application_id,
        computed_outcome: 'NOT_SELECTED',
        computed_rank: n.merit_rank,
        not_selected_reason: n.reason,
        vertical_category: n.vertical_category,
      })),
      ...run.held.map((h) => ({
        selection_list_id: list.id,
        application_id: h.application_id,
        computed_outcome: 'HELD',
      })),
    ];
    if (rows.length > 0) await client.selectionListEntry.createMany({ data: rows });
    this.logger.info({ selectionListId: list.id, entries: rows.length }, 'selection list created');
    return list.id;
  }

  /**
   * Phase 17.2: the objections raised against a list's run, for the committee
   * and the list readers. Grievance row-level security decides which ones the
   * caller sees (officers in jurisdiction); the answer carries ids, status and
   * dates only - no applicant name, no objection text, no decision note.
   */
  async objections(id: string) {
    const list = await this.load(id);
    const client = this.db.client;
    const rows = await client.grievance.findMany({
      where: { subject_type: 'SELECTION_OBJECTION', selection_run_id: list.selection_run_id },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true, application_id: true, status: true, created_at: true },
    });
    const apps = await client.application.findMany({
      where: { id: { in: rows.map((r) => r.application_id) } },
      select: { id: true, application_no: true },
    });
    const no = new Map(apps.map((a) => [a.id, a.application_no]));
    return {
      selection_list_id: list.id,
      objections: rows
        // An objection whose application the caller cannot see is not shown.
        .filter((r) => no.has(r.application_id))
        .map((r) => ({
          grievance_id: r.id,
          application_no: no.get(r.application_id)!,
          status: r.status,
          created_at: r.created_at.toISOString(),
          decided: r.status === 'RESOLVED' || r.status === 'REJECTED',
        })),
    };
  }

  private async load(id: string) {
    const list = await this.db.client.selectionList.findUnique({
      where: { id },
      select: LIST_SELECT,
    });
    if (!list) throw new AppError(ErrorCode.NOT_FOUND);
    return list;
  }

  /** The engine decides; the context is read from the database. */
  private async decide(
    actor: Actor,
    list: {
      id: string;
      status: string;
      selection_run_id: string;
      approvals_required: number;
      window_closes_at: Date | null;
    },
    transition: string,
  ) {
    const client = this.db.client;
    let context: ListContext = {
      valid_approvals: 0,
      approvals_required: list.approvals_required,
      window_elapsed: list.window_closes_at !== null && list.window_closes_at <= new Date(),
      pending_objections: 0,
    };
    if (transition === LT.PUBLISH_PROVISIONAL) {
      const lastChange = await client.selectionCommitteeDecision.findFirst({
        where: {
          selection_list_id: list.id,
          kind: { in: ['OVERRIDE_INCLUDE', 'OVERRIDE_EXCLUDE'] },
        },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
      const valid = await client.selectionCommitteeDecision.count({
        where: {
          selection_list_id: list.id,
          kind: 'APPROVE_LIST',
          ...(lastChange ? { created_at: { gt: lastChange.created_at } } : {}),
        },
      });
      context = { ...context, valid_approvals: valid };
    }
    if (transition === LT.CLOSE_WINDOW || transition === LT.CLOSE_WINDOW_EARLY) {
      const [row] = await client.$queryRaw<Array<{ n: number }>>`
        SELECT selection_list_pending_objections(${list.selection_run_id}::uuid) AS n`;
      context = { ...context, pending_objections: Number(row?.n ?? 0) };
    }
    try {
      return decideTransition(SELECTION_LIST_WORKFLOW, {
        from: list.status,
        transition,
        principal: actor.role,
        context,
      });
    } catch (err) {
      if (!(err instanceof WorkflowError)) throw err;
      throw new AppError(
        err.kind === 'PRINCIPAL_NOT_PERMITTED' ? ErrorCode.FORBIDDEN : ErrorCode.CONFLICT,
        { message: err.message, details: { reason: err.kind.toLowerCase(), ...err.details } },
      );
    }
  }

  private officer(actor: Actor): string {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    return actor.officerId;
  }

  async lists(q: { scheme?: string; academic_year?: string }) {
    const rows = await this.db.client.selectionList.findMany({
      where: {
        ...(q.scheme ? { scheme_code: q.scheme } : {}),
        ...(q.academic_year ? { academic_year: q.academic_year } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: LIST_SELECT,
    });
    return { lists: rows };
  }

  /** The list and the entries the caller may see (RLS), with the decisions beside them. */
  async get(id: string) {
    const list = await this.load(id);
    const entries = await this.db.client.selectionListEntry.findMany({
      where: { selection_list_id: id },
      orderBy: [{ computed_outcome: 'desc' }, { computed_rank: 'asc' }],
      select: {
        id: true,
        application_id: true,
        computed_outcome: true,
        computed_rank: true,
        not_selected_reason: true,
        vertical_category: true,
        horizontal_reservation: true,
        committee_decision: true,
        final_outcome: true,
        decisions: {
          orderBy: { created_at: 'asc' },
          select: {
            kind: true,
            reason: true,
            officer_id: true,
            grievance_id: true,
            created_at: true,
          },
        },
      },
    });
    const apps = await this.db.client.application.findMany({
      where: { id: { in: entries.map((e) => e.application_id) } },
      select: { id: true, application_no: true },
    });
    const no = new Map(apps.map((a) => [a.id, a.application_no]));
    const approvals = await this.db.client.selectionCommitteeDecision.findMany({
      where: { selection_list_id: id, entry_id: null },
      orderBy: { created_at: 'asc' },
      select: { kind: true, reason: true, officer_id: true, created_at: true },
    });
    return {
      ...list,
      list_decisions: approvals,
      entries_in_scope: entries.length,
      entries: entries.map((e) => ({ ...e, application_no: no.get(e.application_id) ?? null })),
    };
  }

  async approve(actor: Actor, id: string, reason?: string) {
    const officerId = this.officer(actor);
    const list = await this.load(id);
    await this.decide(actor, list, LT.APPROVE);
    // One approval per member per round: a member approves again only after
    // an override has made their earlier approval stale.
    const lastChange = await this.db.client.selectionCommitteeDecision.findFirst({
      where: { selection_list_id: id, kind: { in: ['OVERRIDE_INCLUDE', 'OVERRIDE_EXCLUDE'] } },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });
    const already = await this.db.client.selectionCommitteeDecision.findFirst({
      where: {
        selection_list_id: id,
        kind: 'APPROVE_LIST',
        officer_id: officerId,
        ...(lastChange ? { created_at: { gt: lastChange.created_at } } : {}),
      },
      select: { id: true },
    });
    if (already) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'already_approved' } });
    }
    const d = await this.db.client.selectionCommitteeDecision.create({
      data: {
        selection_list_id: id,
        officer_id: officerId,
        kind: 'APPROVE_LIST',
        reason: reason?.trim() ? reason.trim() : null,
      },
      select: { id: true, created_at: true },
    });
    this.logger.info({ selectionListId: id, decisionId: d.id }, 'selection list approved');
    return {
      selection_list_id: id,
      decision_id: d.id,
      kind: 'APPROVE_LIST',
      created_at: d.created_at,
    };
  }

  /** The entry (visible to the caller) and whether its application is held right now. */
  private async entry(listId: string, where: Prisma.SelectionListEntryWhereInput) {
    const e = await this.db.client.selectionListEntry.findFirst({
      where: { selection_list_id: listId, ...where },
      select: {
        id: true,
        application_id: true,
        computed_outcome: true,
        committee_decision: true,
      },
    });
    if (!e) throw new AppError(ErrorCode.NOT_FOUND);
    return e;
  }

  private async refuseIfHeld(e: { computed_outcome: string; application_id: string }) {
    const holding =
      e.computed_outcome === 'HELD'
        ? ['listed as held']
        : await this.fraud.holdingFlags(e.application_id, '');
    if (holding.length > 0) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'An application held for fraud review cannot be approved into the list.',
        details: { reason: 'held_by_fraud_review' },
      });
    }
  }

  async override(
    actor: Actor,
    id: string,
    entryId: string,
    decision: 'INCLUDE' | 'EXCLUDE',
    reasonIn: string | undefined,
  ) {
    const reason = requireReason(reasonIn, 'reason');
    const officerId = this.officer(actor);
    const list = await this.load(id);
    await this.decide(actor, list, LT.OVERRIDE);
    const e = await this.entry(id, { id: entryId });
    const effective = finalOutcome(e, false);
    if (decision === 'INCLUDE') {
      await this.refuseIfHeld(e);
      if (effective === 'SELECTED') {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'already_selected' } });
      }
    } else if (effective !== 'SELECTED') {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'not_selected' } });
    }
    return this.record(id, e.id, officerId, `OVERRIDE_${decision}`, reason, decision, null);
  }

  private async record(
    listId: string,
    entryId: string,
    officerId: string,
    kind: string,
    reason: string,
    decision: 'INCLUDE' | 'EXCLUDE' | null,
    grievanceId: string | null,
  ) {
    const d = await this.db.client.selectionCommitteeDecision.create({
      data: {
        selection_list_id: listId,
        entry_id: entryId,
        grievance_id: grievanceId,
        officer_id: officerId,
        kind,
        reason,
      },
      select: { id: true, created_at: true },
    });
    if (decision) {
      await this.db.client.selectionListEntry.update({
        where: { id: entryId },
        data: { committee_decision: decision },
        select: { id: true },
      });
    }
    // Ids and kinds only: never the reason.
    this.logger.info(
      { selectionListId: listId, entryId, kind, decisionId: d.id },
      'committee decision',
    );
    return {
      selection_list_id: listId,
      entry_id: entryId,
      decision_id: d.id,
      kind,
      committee_decision: decision,
      created_at: d.created_at,
    };
  }

  /** An objection to this run: upheld (the applicant is included) or dismissed; the grievance is resolved with the reason. */
  async decideObjection(
    actor: Actor,
    id: string,
    grievanceId: string,
    outcome: 'UPHELD' | 'DISMISSED',
    reasonIn: string | undefined,
  ) {
    const reason = requireReason(reasonIn, 'reason');
    const officerId = this.officer(actor);
    const list = await this.load(id);
    await this.decide(actor, list, LT.DECIDE_OBJECTION);
    const g = await this.db.client.grievance.findFirst({
      where: {
        id: grievanceId,
        subject_type: 'SELECTION_OBJECTION',
        selection_run_id: list.selection_run_id,
      },
      select: { id: true, application_id: true, status: true },
    });
    if (!g) throw new AppError(ErrorCode.NOT_FOUND);
    if (!['OPEN', 'IN_PROGRESS'].includes(g.status)) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'objection_already_decided', status: g.status },
      });
    }
    const e = await this.entry(id, { application_id: g.application_id });
    if (outcome === 'UPHELD') await this.refuseIfHeld(e);
    const r = await this.record(
      id,
      e.id,
      officerId,
      `OBJECTION_${outcome}`,
      reason,
      outcome === 'UPHELD' && finalOutcome(e, false) !== 'SELECTED' ? 'INCLUDE' : null,
      g.id,
    );
    // The existing grievance flow tells the applicant (their language).
    await this.grievances.resolve(
      actor,
      g.id,
      outcome === 'UPHELD' ? 'RESOLVED' : 'REJECTED',
      reason,
    );
    return { ...r, grievance_id: g.id, outcome };
  }

  private async publishedEntries(listId: string, finalOnly: boolean) {
    const rows = await this.db.client.selectionListEntry.findMany({
      where: { selection_list_id: listId },
      select: {
        application_id: true,
        computed_outcome: true,
        computed_rank: true,
        committee_decision: true,
        final_outcome: true,
      },
    });
    const apps = await this.db.client.application.findMany({
      where: { id: { in: rows.map((r) => r.application_id) } },
      select: { id: true, application_no: true, applicant_id: true },
    });
    const byId = new Map(apps.map((a) => [a.id, a]));
    return rows
      .filter((r) => byId.has(r.application_id))
      .map((r) => ({
        application_id: r.application_id,
        application_no: byId.get(r.application_id)!.application_no,
        applicant_id: byId.get(r.application_id)!.applicant_id,
        outcome: (finalOnly ? r.final_outcome : finalOutcome(r, false)) as
          'SELECTED' | 'NOT_SELECTED' | 'HELD',
        rank: r.computed_rank,
      }));
  }

  async publishProvisional(actor: Actor, id: string) {
    const officerId = this.officer(actor);
    const list = await this.load(id);
    const t = await this.decide(actor, list, LT.PUBLISH_PROVISIONAL);
    const now = new Date();
    const closes = new Date(now.getTime() + list.objection_window_days * 86_400_000);
    await this.db.client.selectionList.update({
      where: { id },
      data: {
        status: t.to,
        provisional_published_at: now,
        provisional_published_by: officerId,
        window_closes_at: closes,
      },
      select: { id: true },
    });
    const entries = await this.publishedEntries(id, false);
    this.events.record(DOMAIN_EVENTS.SELECTION_LIST_PUBLISHED, {
      selection_list_id: id,
      phase: 'PROVISIONAL',
      scheme_code: list.scheme_code,
      academic_year: list.academic_year,
      window_closes_at: closes.toISOString(),
      entries,
      occurred_at: now.toISOString(),
    });
    this.logger.info(
      { selectionListId: id, entries: entries.length },
      'provisional list published',
    );
    return { ...(await this.load(id)), notified: entries.length };
  }

  async closeWindow(actor: Actor, id: string, early: boolean, reasonIn?: string) {
    const officerId = this.officer(actor);
    const list = await this.load(id);
    const reason = early ? requireReason(reasonIn, 'reason') : null;
    const t = await this.decide(actor, list, early ? LT.CLOSE_WINDOW_EARLY : LT.CLOSE_WINDOW);
    if (early) {
      await this.db.client.selectionCommitteeDecision.create({
        data: { selection_list_id: id, officer_id: officerId, kind: 'CLOSE_WINDOW_EARLY', reason },
        select: { id: true },
      });
    }
    await this.db.client.selectionList.update({
      where: { id },
      data: {
        status: t.to,
        window_closed_at: new Date(),
        window_closed_by: officerId,
        window_closed_early: early,
      },
      select: { id: true },
    });
    this.logger.info({ selectionListId: id, early }, 'objection window closed');
    return this.load(id);
  }

  /** Final outcomes are fixed (held re-checked now), then the list is frozen. */
  async publishFinal(actor: Actor, id: string) {
    const officerId = this.officer(actor);
    const list = await this.load(id);
    const t = await this.decide(actor, list, LT.PUBLISH_FINAL);
    const rows = await this.db.client.selectionListEntry.findMany({
      where: { selection_list_id: id },
      select: { id: true, application_id: true, computed_outcome: true, committee_decision: true },
    });
    for (const r of rows) {
      const held = (await this.fraud.holdingFlags(r.application_id, '')).length > 0;
      await this.db.client.selectionListEntry.update({
        where: { id: r.id },
        data: { final_outcome: finalOutcome(r, held) },
        select: { id: true },
      });
    }
    const now = new Date();
    await this.db.client.selectionList.update({
      where: { id },
      data: { status: t.to, final_published_at: now, final_published_by: officerId },
      select: { id: true },
    });
    const entries = await this.publishedEntries(id, true);
    this.events.record(DOMAIN_EVENTS.SELECTION_LIST_PUBLISHED, {
      selection_list_id: id,
      phase: 'FINAL',
      scheme_code: list.scheme_code,
      academic_year: list.academic_year,
      window_closes_at: null,
      entries,
      occurred_at: now.toISOString(),
    });
    this.logger.info({ selectionListId: id, entries: entries.length }, 'final list published');
    return {
      ...(await this.load(id)),
      final: {
        selected: entries.filter((e) => e.outcome === 'SELECTED').length,
        not_selected: entries.filter((e) => e.outcome === 'NOT_SELECTED').length,
        held: entries.filter((e) => e.outcome === 'HELD').length,
      },
    };
  }

  /**
   * One application's result: the caller sees it only if the entry is visible
   * (RLS: the applicant's own, officers in jurisdiction); an applicant never
   * sees an unpublished (DRAFT) list. Committee reasons are not shown.
   */
  async result(actor: Actor, applicationId: string) {
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: { id: true, application_no: true },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    const entries = await this.db.client.selectionListEntry.findMany({
      where: {
        application_id: app.id,
        ...(actor.role === AppRole.APPLICANT
          ? { selection_list: { status: { not: 'DRAFT' } } }
          : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 1,
      select: {
        computed_outcome: true,
        computed_rank: true,
        not_selected_reason: true,
        vertical_category: true,
        horizontal_reservation: true,
        committee_decision: true,
        final_outcome: true,
        selection_list: {
          select: {
            id: true,
            // Phase 17.2: what POST /grievances needs for a SELECTION_OBJECTION.
            selection_run_id: true,
            scheme_code: true,
            academic_year: true,
            status: true,
            window_closes_at: true,
          },
        },
      },
    });
    const e = entries[0];
    if (!e) throw new AppError(ErrorCode.NOT_FOUND, { details: { reason: 'no_published_result' } });
    const score = await this.db.client.score.findFirst({
      where: { application_id: app.id },
      orderBy: { created_at: 'desc' },
      select: { score_type: true, score_value: true, breakdown: true },
    });
    return {
      application_id: app.id,
      application_no: app.application_no,
      list: e.selection_list,
      computed_outcome: e.computed_outcome,
      computed_rank: e.computed_rank,
      not_selected_reason: e.not_selected_reason,
      vertical_category: e.vertical_category,
      horizontal_reservation: e.horizontal_reservation,
      committee_decision: e.committee_decision,
      final_outcome: e.final_outcome,
      current_outcome: e.final_outcome ?? finalOutcome(e, false),
      score,
    };
  }
}

export type { ListState };
