import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { applicationRef, DOMAIN_EVENTS, eventActor } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { Outcome } from '../schemes/eligibility-engine';
import { EligibilityService, StorageReport } from '../schemes/eligibility.service';
import { decideTransition, statesActionableBy, TransitionDecision, WorkflowError } from './engine';
import { SystemActor } from './system-actor';
import {
  ELIGIBILITY_GATE,
  isStage,
  Principal,
  Stage,
  STAGE_SLA_DAYS,
  stageDueAt,
  statusForStage,
  SYSTEM,
  T,
  VIDYASETU_WORKFLOW,
  WorkflowContext,
} from './vidyasetu-workflow';

const WORKFLOW = VIDYASETU_WORKFLOW;

/** Application fields returned by workflow endpoints: no PII. */
export const WORKFLOW_APPLICATION_SELECT = {
  id: true,
  application_no: true,
  applicant_id: true,
  scheme_id: true,
  scheme_version_id: true,
  academic_year: true,
  current_stage: true,
  status: true,
  jurisdiction_state: true,
  jurisdiction_district: true,
  institution_name: true,
  institution_code: true,
  assigned_officer_id: true,
  submitted_at: true,
  stage_entered_at: true,
  stage_due_at: true,
  needs_eligibility_review: true,
} satisfies Prisma.ApplicationSelect;

type WorkflowApplication = Prisma.ApplicationGetPayload<{
  select: typeof WORKFLOW_APPLICATION_SELECT;
}>;

export type SlaState = 'WITHIN_SLA' | 'BREACHED' | 'NO_SLA';

export interface SlaView {
  stage: string;
  stage_entered_at: string;
  sla_days: number | null;
  due_at: string | null;
  state: SlaState;
}

export interface EligibilityGateResult {
  outcome: Outcome;
  routed_to: Stage;
  needs_eligibility_review: boolean;
  evaluation_run_id: string;
  storage: StorageReport;
  /** Live, unredacted explanations: returned to the caller, never stored here. */
  failed_rules: Array<{ rule_id: string; message_key: string | null; explanation: string }>;
  error_rules: Array<{ rule_id: string; explanation: string }>;
}

export interface TransitionResult {
  application: WorkflowApplication & { sla: SlaView };
  transition: { id: string; from_stage: string; to_stage: string; trigger_action: string };
  decision_record_id: string | null;
  deficiency_id: string | null;
  /** Present when the application (re-)entered SUBMITTED and the gate ran. */
  eligibility_gate: EligibilityGateResult | null;
}

/** Officer action input (validated DTO fields). */
export interface ActionInput {
  remarks?: string;
  eligibility_review_confirmed?: boolean;
  deficiency?: { code: string; title: string; description: string };
  declared?: Record<string, unknown>;
}

const GATE_TRANSITION: Record<Outcome, string> = {
  ELIGIBLE: T.ELIGIBLE,
  INDETERMINATE: T.NEEDS_REVIEW,
  INELIGIBLE: T.INELIGIBLE,
};

export function slaView(
  app: Pick<WorkflowApplication, 'current_stage' | 'stage_entered_at' | 'stage_due_at'>,
  now: Date,
): SlaView {
  const days = isStage(app.current_stage) ? (STAGE_SLA_DAYS[app.current_stage] ?? null) : null;
  const due = app.stage_due_at;
  return {
    stage: app.current_stage,
    stage_entered_at: app.stage_entered_at.toISOString(),
    sla_days: days,
    due_at: due ? due.toISOString() : null,
    state: due === null ? 'NO_SLA' : due.getTime() < now.getTime() ? 'BREACHED' : 'WITHIN_SLA',
  };
}

function toAppError(err: WorkflowError): AppError {
  const details = { reason: err.kind.toLowerCase(), ...err.details };
  switch (err.kind) {
    case 'PRINCIPAL_NOT_PERMITTED':
      return new AppError(ErrorCode.FORBIDDEN, { message: err.message, details });
    case 'UNKNOWN_STATE':
      return new AppError(ErrorCode.INTERNAL_ERROR, { details, cause: err });
    default:
      // The application's current stage does not allow this action.
      return new AppError(ErrorCode.CONFLICT, { message: err.message, details });
  }
}

/**
 * Applies workflow transitions to applications. Every read and write goes
 * through DbContext (the request's Phase 2 actor transaction), so the
 * jurisdiction scope and RLS apply and every transition's rows - the
 * application update, workflow_transitions, decision_records, deficiencies,
 * rule_evaluations - commit or roll back together, each with its audit row.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly db: DbContext,
    private readonly eligibility: EligibilityService,
    private readonly systemActor: SystemActor,
    private readonly events: DomainEvents,
  ) {}

  /** Initial values for a new application's stage columns. */
  initialStageColumns(now: Date) {
    const stage = WORKFLOW.initial;
    return {
      current_stage: stage,
      status: statusForStage(stage),
      stage_entered_at: now,
      stage_due_at: stageDueAt(stage, now),
    };
  }

  /**
   * Runs the automatic step of the application's current state, if it has
   * one. Called in the same transaction that entered that state.
   */
  async runAutomatic(
    applicationId: string,
    declared: unknown,
  ): Promise<EligibilityGateResult | null> {
    const app = await this.load(applicationId);
    const state = isStage(app.current_stage) ? WORKFLOW.states[app.current_stage] : undefined;
    if (state?.automatic !== ELIGIBILITY_GATE) return null;
    return this.eligibilityGate(app, declared);
  }

  /**
   * The automatic eligibility gate. Reads under the caller's visibility (the
   * submitting applicant sees their own application); writes its decision -
   * rule_evaluations, the stage change, the workflow_transitions row - as the
   * SYSTEM actor.
   */
  private async eligibilityGate(
    app: WorkflowApplication,
    declared: unknown,
  ): Promise<EligibilityGateResult> {
    const prepared = await this.eligibility.prepareApplicationEvaluation(app.id, declared);
    const { outcome } = prepared.evaluation;
    const needsReview = outcome === 'INDETERMINATE';
    const failed = prepared.evaluation.rules.filter((r) => r.verdict === 'FAIL');
    const errors = prepared.evaluation.rules.filter(
      (r) => r.verdict === 'ERROR' && (r.rule_type === 'eligibility' || r.rule_type === 'unknown'),
    );

    return this.systemActor.run(async () => {
      const { runId, storage } = await this.eligibility.persistApplicationEvaluation(prepared);
      const decision = this.decide(app, GATE_TRANSITION[outcome], SYSTEM, {});
      const enteredAt = new Date();
      const dueAt = stageDueAt(decision.to, enteredAt);

      const rows = await this.db.client.$queryRaw<Array<{ updated: number }>>`
        SELECT workflow_system_transition(
          ${app.id}::uuid, ${decision.from}, ${decision.to}, ${statusForStage(decision.to)},
          ${enteredAt}, ${dueAt}, ${needsReview}
        ) AS updated`;
      if (rows[0]?.updated !== 1) throw this.staleStage(app);

      // Only rule ids and message keys: explanations may carry sensitive
      // values and this table is audited (the redacted evidence is in
      // rule_evaluations under evaluation_run_id).
      const gateRow = await this.db.client.workflowTransition.create({
        data: {
          application_id: app.id,
          from_stage: decision.from,
          to_stage: decision.to,
          triggered_by: SYSTEM,
          trigger_action: decision.transition,
          metadata: {
            workflow: WORKFLOW.name,
            actor: { type: SYSTEM },
            gate: ELIGIBILITY_GATE,
            outcome,
            evaluation_run_id: runId,
            scheme_version_id: prepared.version.id,
            failed_rules: failed.map((r) => ({ rule_id: r.rule_id, message_key: r.message_key })),
            error_rules: errors.map((r) => r.rule_id),
            needs_eligibility_review: needsReview,
            stage_due_at: dueAt?.toISOString() ?? null,
          },
        },
        select: { id: true },
      });

      // Emitted after the request's transaction commits (DomainEvents).
      this.events.record(DOMAIN_EVENTS.WORKFLOW_TRANSITION, {
        ...applicationRef(app),
        workflow_transition_id: gateRow.id,
        from_stage: decision.from,
        to_stage: decision.to,
        transition: decision.transition,
        actor: eventActor(null),
        decision_record_id: null,
        deficiency_id: null,
        deficiency: null,
        stage_due_at: dueAt?.toISOString() ?? null,
        eligibility_gate: {
          outcome,
          needs_eligibility_review: needsReview,
          evaluation_run_id: runId,
          failed_rules: failed.map((r) => ({ rule_id: r.rule_id, message_key: r.message_key })),
          error_rules: errors.map((r) => r.rule_id),
        },
        occurred_at: enteredAt.toISOString(),
      });

      return {
        outcome,
        routed_to: decision.to,
        needs_eligibility_review: needsReview,
        evaluation_run_id: runId,
        storage,
        failed_rules: failed.map((r) => ({
          rule_id: r.rule_id,
          message_key: r.message_key,
          explanation: r.explanation ?? '',
        })),
        error_rules: errors.map((r) => ({ rule_id: r.rule_id, explanation: r.explanation ?? '' })),
      };
    });
  }

  /** A human action (verify / reject / mark_defective / resubmit) on one application. */
  async act(
    actor: Actor,
    applicationId: string,
    transition: string,
    input: ActionInput,
  ): Promise<TransitionResult> {
    const isOfficer = actor.role !== AppRole.APPLICANT;
    if (isOfficer && !actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }

    if (transition === T.MARK_DEFECTIVE && !input.deficiency) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, { details: { field: 'deficiency' } });
    }

    const app = await this.load(applicationId);
    const origin = await this.db.client.workflowTransition.findFirst({
      where: { application_id: app.id, to_stage: app.current_stage },
      orderBy: { created_at: 'desc' },
      select: { from_stage: true },
    });
    const decision = this.decide(
      app,
      transition,
      actor.role,
      {
        needs_eligibility_review: app.needs_eligibility_review,
        eligibility_review_confirmed: input.eligibility_review_confirmed === true,
      },
      origin?.from_stage ?? null,
    );

    const client = this.db.client;
    const enteredAt = new Date();
    const dueAt = stageDueAt(decision.to, enteredAt);
    const clearsReview = decision.transition === T.VERIFY && app.needs_eligibility_review === true;

    // Compare-and-swap on the stage read above; jurisdiction scope + RLS apply.
    const updated = await client.application.updateMany({
      where: { id: app.id, current_stage: decision.from },
      data: {
        current_stage: decision.to,
        status: statusForStage(decision.to),
        stage_entered_at: enteredAt,
        stage_due_at: dueAt,
        ...(clearsReview ? { needs_eligibility_review: false } : {}),
      },
    });
    if (updated.count !== 1) throw this.staleStage(app);

    const applicant = actor.role === AppRole.APPLICANT;
    const row = await client.workflowTransition.create({
      data: {
        application_id: app.id,
        from_stage: decision.from,
        to_stage: decision.to,
        // Officer UUID for officers (per the column's contract); the
        // applicant's applicants.id for an applicant's resubmission.
        triggered_by: applicant ? app.applicant_id : actor.officerId!,
        trigger_action: decision.transition,
        metadata: {
          workflow: WORKFLOW.name,
          actor: {
            type: applicant ? 'APPLICANT' : 'OFFICER',
            role: actor.role,
            account_id: actor.accountId,
          },
          stage_due_at: dueAt?.toISOString() ?? null,
          ...(clearsReview ? { eligibility_review_confirmed: true } : {}),
        },
      },
      select: { id: true, from_stage: true, to_stage: true, trigger_action: true },
    });

    let decisionRecordId: string | null = null;
    let deficiencyId: string | null = null;
    const decisionCode = decision.def.meta?.decision;
    if (!applicant && decisionCode) {
      const level = WORKFLOW.states[decision.from].meta?.level ?? decision.from;
      const record = await client.decisionRecord.create({
        data: {
          application_id: app.id,
          officer_id: actor.officerId!,
          decision: decisionCode,
          stage: level,
          remarks: input.remarks ?? null,
          reasons: {
            workflow_transition_id: row.id,
            from_stage: decision.from,
            to_stage: decision.to,
            ...(input.deficiency ? { deficiency_code: input.deficiency.code } : {}),
            ...(clearsReview ? { eligibility_review_confirmed: true } : {}),
          },
        },
        select: { id: true },
      });
      decisionRecordId = record.id;
    }

    if (decision.transition === T.MARK_DEFECTIVE && input.deficiency) {
      const deficiency = await client.deficiency.create({
        data: {
          application_id: app.id,
          officer_id: actor.officerId!,
          code: input.deficiency.code,
          title: input.deficiency.title,
          description: input.deficiency.description,
        },
        select: { id: true },
      });
      deficiencyId = deficiency.id;
    }

    // Emitted after the request's transaction commits (DomainEvents).
    this.events.record(DOMAIN_EVENTS.WORKFLOW_TRANSITION, {
      ...applicationRef(app),
      workflow_transition_id: row.id,
      from_stage: decision.from,
      to_stage: decision.to,
      transition: decision.transition,
      actor: eventActor(actor),
      decision_record_id: decisionRecordId,
      deficiency_id: deficiencyId,
      deficiency:
        deficiencyId && input.deficiency
          ? { code: input.deficiency.code, title: input.deficiency.title }
          : null,
      stage_due_at: dueAt?.toISOString() ?? null,
      eligibility_gate: null,
      occurred_at: enteredAt.toISOString(),
    });

    // Re-entering SUBMITTED re-runs the automatic eligibility gate.
    const gate = await this.runAutomatic(app.id, input.declared);
    const now = new Date();
    const fresh = await this.load(app.id);
    return {
      application: { ...fresh, sla: slaView(fresh, now) },
      transition: row,
      decision_record_id: decisionRecordId,
      deficiency_id: deficiencyId,
      eligibility_gate: gate,
    };
  }

  /**
   * The caller's scrutiny queue: applications in the stages where the
   * caller's role can act (derived from the workflow definition). The
   * jurisdiction filter is the Phase 2 scope extension + RLS; nothing here.
   */
  async queue(actor: Actor, needsReview?: boolean, fraud?: 'HIGH' | 'ANY') {
    const stages = statesActionableBy(WORKFLOW, actor.role as Principal);
    const now = new Date();
    // Phase 11: flags not yet dismissed as false positives (RLS-scoped like the rows).
    const liveFlag = { status: { not: 'FALSE_POSITIVE' } };
    const rows = await this.db.client.application.findMany({
      where: {
        current_stage: { in: stages },
        ...(needsReview === undefined ? {} : { needs_eligibility_review: needsReview }),
        ...(fraud === undefined
          ? {}
          : {
              fraud_flags: {
                some: fraud === 'HIGH' ? { ...liveFlag, severity: 'HIGH' } : liveFlag,
              },
            }),
      },
      select: {
        ...WORKFLOW_APPLICATION_SELECT,
        fraud_flags: {
          where: liveFlag,
          select: { id: true, flag_type: true, severity: true, status: true },
        },
      },
      orderBy: [
        { needs_eligibility_review: 'desc' },
        { stage_due_at: { sort: 'asc', nulls: 'last' } },
      ],
      take: 100,
    });
    return {
      role: actor.role,
      stages,
      count: rows.length,
      applications: rows.map(({ fraud_flags, ...r }) => ({
        ...r,
        sla: slaView(r, now),
        fraud: {
          held: fraud_flags.some((f) => f.severity === 'HIGH'),
          open_flags: fraud_flags.length,
          flags: fraud_flags,
        },
      })),
    };
  }

  async slaStatus(applicationId: string) {
    const app = await this.load(applicationId);
    return {
      application_id: app.id,
      application_no: app.application_no,
      current_stage: app.current_stage,
      status: app.status,
      checked_at: new Date().toISOString(),
      ...slaView(app, new Date()),
    };
  }

  /** Applications (visible to the caller) whose current stage is past its due time. */
  async findBreached(now: Date = new Date()) {
    const rows = await this.db.client.application.findMany({
      where: { stage_due_at: { lt: now } },
      select: WORKFLOW_APPLICATION_SELECT,
      orderBy: { stage_due_at: 'asc' },
      take: 100,
    });
    return {
      checked_at: now.toISOString(),
      count: rows.length,
      applications: rows.map((r) => ({ ...r, sla: slaView(r, now) })),
    };
  }

  private decide(
    app: WorkflowApplication,
    transition: string,
    principal: Principal,
    context: Partial<WorkflowContext>,
    enteredFrom: string | null = null,
  ): TransitionDecision<Stage, Principal, WorkflowContext> {
    try {
      return decideTransition(WORKFLOW, {
        from: app.current_stage,
        transition,
        principal,
        context: {
          needs_eligibility_review: false,
          eligibility_review_confirmed: false,
          ...context,
        },
        enteredFrom,
      });
    } catch (err) {
      if (err instanceof WorkflowError) throw toAppError(err);
      throw err;
    }
  }

  private async load(applicationId: string): Promise<WorkflowApplication> {
    // Jurisdiction scope + RLS: out-of-jurisdiction and nonexistent look
    // identical (404), the Phase 2 precedent (ApplicationsService.get).
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: WORKFLOW_APPLICATION_SELECT,
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    return app;
  }

  private staleStage(app: WorkflowApplication): AppError {
    return new AppError(ErrorCode.CONFLICT, {
      message: 'The application changed stage while this action was being applied.',
      details: { reason: 'stage_changed', expected_stage: app.current_stage },
    });
  }
}
