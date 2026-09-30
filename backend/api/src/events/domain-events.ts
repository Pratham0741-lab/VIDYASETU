/**
 * Internal domain events (Phase 8). Emitted only AFTER the writing
 * transaction commits (see DomainEvents), so a consumer never hears about a
 * change that was rolled back.
 *
 * Payloads are self-contained: a consumer runs outside any request, has no
 * actor, and cannot read RLS-protected rows, so everything it needs to
 * route a notification (applicant, jurisdiction, stage) is carried here.
 * They never carry extracted or sensitive values (Phase 3 redaction
 * policy): field NAMES only.
 */

export const DOMAIN_EVENTS = {
  WORKFLOW_TRANSITION: 'workflow.transition',
  DOCUMENT_QUALITY_REJECTED: 'documents.quality_rejected',
  DOCUMENT_NEEDS_REVIEW: 'documents.needs_review',
  DOCUMENT_CONSISTENCY_EVALUATED: 'documents.consistency_evaluated',
  DOCUMENT_ELIGIBILITY_MISMATCH: 'documents.eligibility_mismatch',
  SELECTION_RUN_COMPLETED: 'selection.run_completed',
  GRIEVANCE_STATUS_CHANGED: 'grievances.status_changed',
  DEFICIENCY_ISSUED: 'deficiencies.issued',
  SELECTION_LIST_PUBLISHED: 'selection_lists.published',
  SLA_BREACHED: 'workflow.sla_breached',
  CORRECTION_DECIDED: 'privacy.correction_decided',
} as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

export interface EventActor {
  type: 'OFFICER' | 'APPLICANT' | 'SYSTEM';
  role: string;
  account_id: string | null;
  officer_id: string | null;
}

/** Where an application sits, for routing (carried because consumers cannot read it). */
export interface ApplicationRef {
  application_id: string;
  application_no: string;
  applicant_id: string;
  jurisdiction_state: string;
  jurisdiction_district: string | null;
}

export interface WorkflowTransitionEvent extends ApplicationRef {
  workflow_transition_id: string;
  from_stage: string;
  to_stage: string;
  transition: string;
  actor: EventActor;
  decision_record_id: string | null;
  deficiency_id: string | null;
  /** The raised deficiency's code and title (mark_defective only). */
  deficiency: { code: string; title: string } | null;
  stage_due_at: string | null;
  /** Present only for the automatic eligibility gate's SYSTEM transition. */
  eligibility_gate: {
    outcome: 'ELIGIBLE' | 'INELIGIBLE' | 'INDETERMINATE';
    needs_eligibility_review: boolean;
    evaluation_run_id: string;
    failed_rules: Array<{ rule_id: string; message_key: string | null }>;
    error_rules: string[];
  } | null;
  occurred_at: string;
}

export interface DocumentQualityRejectedEvent extends ApplicationRef {
  document_id: string;
  document_type: string;
  issues: string[];
  ml_engine: string;
  occurred_at: string;
}

export interface DocumentNeedsReviewEvent extends ApplicationRef {
  /**
   * The application's stage when the document was uploaded (read in the
   * applicant's own request - the worker cannot read it under RLS). Routes
   * the officer notification to the role responsible for that stage.
   */
  current_stage: string;
  document_id: string;
  extraction_id: string;
  document_slot: string;
  fields_needing_review: string[];
  reasons: string[];
  ml_engine: string;
  occurred_at: string;
}

/**
 * Emitted on every consistency evaluation, with the new status. Whether it
 * CHANGED is not known to the emitter: the SYSTEM worker cannot read the
 * application's previous status (RLS), and the flag function returns only
 * a row count. See the Phase 8 report.
 */
export interface DocumentConsistencyEvaluatedEvent extends ApplicationRef {
  /**
   * The application's stage when the document was uploaded (read in the
   * applicant's own request - the worker cannot read it under RLS). Routes
   * the officer notification to the role responsible for that stage.
   */
  current_stage: string;
  status: 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN';
  checks: Record<string, boolean>;
  confidence: Record<string, number>;
  documents_compared: number;
  ml_engine: string;
  occurred_at: string;
}

export interface DocumentEligibilityMismatchEvent extends ApplicationRef {
  /**
   * The application's stage when the document was uploaded (read in the
   * applicant's own request - the worker cannot read it under RLS). Routes
   * the officer notification to the role responsible for that stage.
   */
  current_stage: string;
  document_id: string;
  extraction_id: string;
  /** Field names only - never the extracted or recorded values. */
  fields: Array<{ field: string; sensitive: boolean; source: 'recorded' | 'declared' }>;
  occurred_at: string;
}

/**
 * One event per selection run (not per Selection row): a consumer needs the
 * whole run - basis, pools, reservation shortfalls, who was not selected and
 * why - to write either an applicant's message or an officer's summary; a
 * per-row event would lose that context, and fanning out per applicant from
 * one event is trivial for the consumer.
 */
export interface SelectionRunCompletedEvent {
  selection_run_id: string;
  scheme_code: string;
  academic_year: string;
  scheme_version_id: string;
  basis: string;
  actor: EventActor;
  selected: Array<{
    selection_id: string;
    application_id: string;
    application_no: string;
    applicant_id: string;
    merit_rank: number | null;
    vertical_category: string;
    horizontal_reservation: string | null;
  }>;
  not_selected: Array<{
    application_id: string;
    application_no: string;
    applicant_id: string;
    merit_rank: number | null;
    reason: string;
  }>;
  /**
   * Phase 11.5: MINISTRY_APPROVED applications left out of this run because a
   * HIGH fraud flag awaits review. Neither selected nor not selected - they
   * re-enter the next run once released. Optional: consumers may ignore it.
   */
  held?: Array<{
    application_id: string;
    application_no: string;
    applicant_id: string;
    fraud_flag_ids: string[];
  }>;
  reservations: unknown[];
  occurred_at: string;
  /**
   * Phase 13E: the run has a selection list - applicants hear the outcome
   * when the committee-approved list is published, not now.
   */
  list_managed?: boolean;
}

/** A grievance was raised or changed status (Phase 9). */
export interface GrievanceStatusChangedEvent extends ApplicationRef {
  grievance_id: string;
  subject_type: string;
  previous_status: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
  /** The application's stage, for routing officer notifications. */
  current_stage: string;
  sla_due_at: string | null;
  /** The officer's resolution note (RESOLVED / REJECTED). */
  resolution_note: string | null;
  actor: EventActor;
  occurred_at: string;
}

/**
 * An itemised deficiency was raised (Phase 13C). Carries only codes, slot
 * names and deadlines - never an extracted value or the officer's reason.
 */
export interface DeficiencyIssuedEvent extends ApplicationRef {
  deficiency_id: string;
  items: Array<{
    /** Phase 13D: the item, and whether it has a crop (the notice links to it). */
    item_id?: string;
    has_crop?: boolean;
    document_slot: string | null;
    document_type: string | null;
    problem_code: string;
    fix_code: string;
    deadline_at: string;
  }>;
  occurred_at: string;
}

/**
 * Phase 13E: a selection list was published (provisional or final). One
 * entry per candidate - their own outcome and rank, never anyone else's.
 */
export interface SelectionListPublishedEvent {
  selection_list_id: string;
  phase: 'PROVISIONAL' | 'FINAL';
  scheme_code: string;
  academic_year: string;
  window_closes_at: string | null;
  entries: Array<{
    application_id: string;
    application_no: string;
    applicant_id: string;
    outcome: 'SELECTED' | 'NOT_SELECTED' | 'HELD';
    rank: number | null;
  }>;
  occurred_at: string;
}

/**
 * Phase 14 loose ends (Part B): the scheduled sweep recorded a breach - one
 * per stage instance (application, stage, stage_entered_at), never twice.
 */
export interface SlaBreachedEvent extends ApplicationRef {
  sla_breach_id: string;
  stage: string;
  stage_entered_at: string;
  stage_due_at: string;
  sla_days: number;
  detected_at: string;
  sweep_run_id: string;
  occurred_at: string;
}

/**
 * Phase 17 (B4): an officer decided an applicant's correction request. No
 * value is carried - the field name, the decision and the officer's reason.
 */
export interface CorrectionDecidedEvent {
  applicant_id: string;
  correction_request_id: string;
  field: string;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  occurred_at: string;
}

export interface DomainEventPayloads {
  [DOMAIN_EVENTS.WORKFLOW_TRANSITION]: WorkflowTransitionEvent;
  [DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED]: DocumentQualityRejectedEvent;
  [DOMAIN_EVENTS.DOCUMENT_NEEDS_REVIEW]: DocumentNeedsReviewEvent;
  [DOMAIN_EVENTS.DOCUMENT_CONSISTENCY_EVALUATED]: DocumentConsistencyEvaluatedEvent;
  [DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH]: DocumentEligibilityMismatchEvent;
  [DOMAIN_EVENTS.SELECTION_RUN_COMPLETED]: SelectionRunCompletedEvent;
  [DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED]: GrievanceStatusChangedEvent;
  [DOMAIN_EVENTS.DEFICIENCY_ISSUED]: DeficiencyIssuedEvent;
  [DOMAIN_EVENTS.SELECTION_LIST_PUBLISHED]: SelectionListPublishedEvent;
  [DOMAIN_EVENTS.SLA_BREACHED]: SlaBreachedEvent;
  [DOMAIN_EVENTS.CORRECTION_DECIDED]: CorrectionDecidedEvent;
}

export function eventActor(
  actor: { accountId: string; role: string; officerId: string | null } | null,
): EventActor {
  if (!actor) return { type: 'SYSTEM', role: 'SYSTEM', account_id: null, officer_id: null };
  return {
    type: actor.role === 'APPLICANT' ? 'APPLICANT' : 'OFFICER',
    role: actor.role,
    account_id: actor.accountId,
    officer_id: actor.officerId,
  };
}

/** ApplicationRef from any row carrying those columns. */
export function applicationRef(app: {
  id: string;
  application_no: string;
  applicant_id: string;
  jurisdiction_state: string;
  jurisdiction_district: string | null;
}): ApplicationRef {
  return {
    application_id: app.id,
    application_no: app.application_no,
    applicant_id: app.applicant_id,
    jurisdiction_state: app.jurisdiction_state,
    jurisdiction_district: app.jurisdiction_district,
  };
}
