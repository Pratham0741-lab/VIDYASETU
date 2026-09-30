import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { applicationRef, DOMAIN_EVENTS, eventActor } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { listForRun } from '../selection-lists/list-lookup';
import { finalOutcome } from '../selection-lists/selection-list-workflow';
import { grievanceDueAt } from './policies';

export type GrievanceSubject = 'APPLICATION' | 'SELECTION' | 'DISBURSEMENT' | 'SELECTION_OBJECTION';
type Status = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';

export interface RaiseGrievanceInput {
  application_id: string;
  subject_type: GrievanceSubject;
  selection_id?: string;
  disbursement_id?: string;
  selection_run_id?: string;
  description: string;
}

const GRIEVANCE_SELECT = {
  id: true,
  application_id: true,
  raised_by_applicant_id: true,
  subject_type: true,
  selection_id: true,
  disbursement_id: true,
  selection_run_id: true,
  description: true,
  status: true,
  status_entered_at: true,
  sla_due_at: true,
  resolution_note: true,
  resolved_by_officer_id: true,
  resolved_at: true,
  created_at: true,
} satisfies Prisma.GrievanceSelect;

const APP_REF_SELECT = {
  id: true,
  application_no: true,
  applicant_id: true,
  jurisdiction_state: true,
  jurisdiction_district: true,
  current_stage: true,
} satisfies Prisma.ApplicationSelect;

/**
 * Grievances, including objections to a non-selection (decision D). Reads
 * and writes go through DbContext: jurisdiction scope (Phase 2 map) + RLS
 * decide visibility; writes are audited. SLA: GRIEVANCE_SLA_DAYS per
 * status, due-at stored on every status entry (Phase 4's pattern).
 * Status changes are domain events; Phase 8's listener notifies.
 */
@Injectable()
export class GrievanceService {
  constructor(
    private readonly db: DbContext,
    private readonly events: DomainEvents,
  ) {}

  private async application(id: string) {
    const app = await this.db.client.application.findFirst({
      where: { id },
      select: APP_REF_SELECT,
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'application_id' } });
    return app;
  }

  async raise(actor: Actor, input: RaiseGrievanceInput) {
    const client = this.db.client;
    const app = await this.application(input.application_id);
    const applicant = await client.applicant.findUnique({
      where: { user_id: actor.accountId },
      select: { id: true },
    });
    if (!applicant || applicant.id !== app.applicant_id) {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'application_id' } });
    }

    const refs: { selection_id?: string; disbursement_id?: string; selection_run_id?: string } = {};
    const bad = (field: string, reason: string) =>
      new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field, constraints: { subject: reason } }],
      });
    switch (input.subject_type) {
      case 'APPLICATION':
        break;
      case 'SELECTION': {
        const s = input.selection_id
          ? await client.selection.findFirst({
              where: { id: input.selection_id, application_id: app.id },
              select: { id: true },
            })
          : null;
        if (!s) throw bad('selection_id', 'must be a selection of this application');
        refs.selection_id = s.id;
        break;
      }
      case 'DISBURSEMENT': {
        const d = input.disbursement_id
          ? await client.disbursement.findFirst({
              where: { id: input.disbursement_id, application_id: app.id },
              select: { id: true },
            })
          : null;
        if (!d) throw bad('disbursement_id', 'must be a disbursement of this application');
        refs.disbursement_id = d.id;
        break;
      }
      case 'SELECTION_OBJECTION': {
        // Objection to one's own NON-selection: such applications have no
        // selections row (Phase 6), so it references the run. What the
        // applicant's own visibility can check is checked here; whether the
        // run id is real is visible to the resolving ministry officer.
        if (!input.selection_run_id)
          throw bad('selection_run_id', 'an objection names the selection run');
        // Phase 13E: a run with a selection list takes objections only while
        // its published provisional list's objection window is open, from an
        // applicant whose outcome in that list is NOT_SELECTED - computed, or
        // excluded by the committee (whose selections row is still live).
        const list = await listForRun(client, input.selection_run_id);
        if (list) {
          if (
            list.status !== 'PROVISIONAL_PUBLISHED' ||
            (list.window_closes_at !== null && list.window_closes_at <= new Date())
          ) {
            throw new AppError(ErrorCode.CONFLICT, {
              message: 'The objection window for this selection list is not open.',
              details: { reason: 'objection_window_not_open', list_status: list.status },
            });
          }
          const entry = await client.selectionListEntry.findFirst({
            where: { selection_list_id: list.id, application_id: app.id },
            select: { computed_outcome: true, committee_decision: true },
          });
          const outcome = entry ? finalOutcome(entry, false) : null;
          if (outcome !== 'NOT_SELECTED') {
            throw new AppError(ErrorCode.CONFLICT, {
              message: 'An objection can be raised only against a non-selection in this list.',
              details: { reason: 'not_a_non_selection', list_outcome: outcome },
            });
          }
        } else {
          const live = await client.selection.count({
            where: {
              application_id: app.id,
              selection_status: { in: ['PROVISIONAL', 'CONFIRMED'] },
            },
          });
          if (live > 0 || app.current_stage !== 'MINISTRY_APPROVED') {
            throw new AppError(ErrorCode.CONFLICT, {
              message:
                'An objection can be raised only against a non-selection of an approved application.',
              details: {
                reason: 'not_a_non_selection',
                current_stage: app.current_stage,
                live_selections: live,
              },
            });
          }
        }
        refs.selection_run_id = input.selection_run_id;
        break;
      }
      default:
        throw bad('subject_type', 'unknown subject type');
    }

    const now = new Date();
    const due = grievanceDueAt('OPEN', now);
    const g = await client.grievance.create({
      data: {
        application_id: app.id,
        raised_by_applicant_id: applicant.id,
        subject_type: input.subject_type,
        ...refs,
        description: input.description,
        status: 'OPEN',
        status_entered_at: now,
        sla_due_at: due,
      },
      select: GRIEVANCE_SELECT,
    });
    this.emit(app, g.id, g.subject_type, null, 'OPEN', due, null, actor, now);
    return g;
  }

  async list(status?: Status) {
    return this.db.client.grievance.findMany({
      where: status ? { status } : {},
      select: GRIEVANCE_SELECT,
      orderBy: [{ sla_due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
      take: 100,
    });
  }

  async get(id: string) {
    const g = await this.db.client.grievance.findFirst({ where: { id }, select: GRIEVANCE_SELECT });
    if (!g) throw new AppError(ErrorCode.NOT_FOUND);
    return g;
  }

  /** OPEN -> IN_PROGRESS (reviewer). */
  async start(actor: Actor, id: string) {
    return this.move(actor, id, ['OPEN'], 'IN_PROGRESS', null);
  }

  /** OPEN | IN_PROGRESS -> RESOLVED | REJECTED with a note (reviewer). */
  async resolve(actor: Actor, id: string, outcome: 'RESOLVED' | 'REJECTED', note: string) {
    return this.move(actor, id, ['OPEN', 'IN_PROGRESS'], outcome, note);
  }

  private async move(actor: Actor, id: string, from: Status[], to: Status, note: string | null) {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    const g = await this.get(id);
    if (!from.includes(g.status as Status)) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'grievance_status', status: g.status, allowed_from: from },
      });
    }
    const now = new Date();
    const due = grievanceDueAt(to, now);
    const final = to === 'RESOLVED' || to === 'REJECTED';
    const updated = await this.db.client.grievance.updateMany({
      where: { id: g.id, status: g.status },
      data: {
        status: to,
        status_entered_at: now,
        sla_due_at: due,
        ...(final
          ? { resolution_note: note, resolved_by_officer_id: actor.officerId, resolved_at: now }
          : {}),
      },
    });
    if (updated.count !== 1)
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'grievance_changed' } });
    const app = await this.application(g.application_id);
    this.emit(app, g.id, g.subject_type, g.status, to, due, note, actor, now);
    return this.get(g.id);
  }

  private emit(
    app: Prisma.ApplicationGetPayload<{ select: typeof APP_REF_SELECT }>,
    grievanceId: string,
    subject: string,
    previous: string | null,
    status: Status,
    due: Date | null,
    note: string | null,
    actor: Actor,
    at: Date,
  ) {
    // Emitted after the request's transaction commits (DomainEvents).
    this.events.record(DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED, {
      ...applicationRef(app),
      grievance_id: grievanceId,
      subject_type: subject,
      previous_status: previous,
      status,
      current_stage: app.current_stage,
      sla_due_at: due?.toISOString() ?? null,
      resolution_note: note,
      actor: eventActor(actor),
      occurred_at: at.toISOString(),
    });
  }
}
