import { AppRole } from '../auth/roles';
import { validateDefinition, WorkflowDefinition } from './engine';

/**
 * The concrete VIDYASETU scrutiny workflow: the one instance of the generic
 * engine (engine.ts) for now. A later phase can swap this object for a
 * per-scheme definition without changing the engine.
 */

export const STAGES = [
  'SUBMITTED',
  'INO_VERIFIED',
  'DNO_VERIFIED',
  'SNO_VERIFIED',
  'MINISTRY_APPROVED',
  'DEFECTIVE',
  'REJECTED',
  'DISBURSED',
] as const;
export type Stage = (typeof STAGES)[number];

export type ApplicationStatus =
  'PENDING' | 'UNDER_REVIEW' | 'DEFECTIVE' | 'APPROVED' | 'REJECTED' | 'DISBURSED';

/**
 * status is ALWAYS derived from current_stage through this mapping; nothing
 * sets it independently. The database enforces the same mapping with
 * CHECK applications_status_derived_from_stage_check (migration
 * 20260926070000); vidyasetu-workflow.spec.ts checks the two agree.
 */
export const STATUS_FOR_STAGE: Readonly<Record<Stage, ApplicationStatus>> = {
  SUBMITTED: 'PENDING',
  INO_VERIFIED: 'UNDER_REVIEW',
  DNO_VERIFIED: 'UNDER_REVIEW',
  SNO_VERIFIED: 'UNDER_REVIEW',
  MINISTRY_APPROVED: 'APPROVED',
  DEFECTIVE: 'DEFECTIVE',
  REJECTED: 'REJECTED',
  DISBURSED: 'DISBURSED',
};

export function statusForStage(stage: Stage): ApplicationStatus {
  return STATUS_FOR_STAGE[stage];
}

/**
 * SLA per stage, in days from stage entry. A stage without an entry has no
 * due date: SUBMITTED is left automatically in the same transaction, and
 * REJECTED / DISBURSED are final. DEFECTIVE's SLA is the applicant's
 * resubmission window.
 */
export const STAGE_SLA_DAYS: Readonly<Partial<Record<Stage, number>>> = {
  INO_VERIFIED: 7,
  DNO_VERIFIED: 7,
  SNO_VERIFIED: 10,
  MINISTRY_APPROVED: 15,
  DEFECTIVE: 15,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function stageDueAt(stage: Stage, enteredAt: Date): Date | null {
  const days = STAGE_SLA_DAYS[stage];
  return days === undefined ? null : new Date(enteredAt.getTime() + days * DAY_MS);
}

/** The system itself (the automatic eligibility gate). Never a token role. */
export const SYSTEM = 'SYSTEM' as const;
export type Principal = AppRole | typeof SYSTEM;

/** Guard input for a transition request. */
export interface WorkflowContext {
  needs_eligibility_review: boolean;
  eligibility_review_confirmed: boolean;
}

/** Name of the automatic resolver SUBMITTED runs on entry. */
export const ELIGIBILITY_GATE = 'eligibility_gate';

/** Transition names (also the API verbs). */
export const T = {
  ELIGIBLE: 'eligibility_passed',
  NEEDS_REVIEW: 'eligibility_indeterminate',
  INELIGIBLE: 'eligibility_failed',
  VERIFY: 'verify',
  REJECT: 'reject',
  MARK_DEFECTIVE: 'mark_defective',
  RESUBMIT: 'resubmit',
  DISBURSE: 'disburse',
} as const;

/**
 * An application flagged for manual eligibility review (INDETERMINATE gate
 * outcome) may only be verified onward by an institute officer who confirms
 * that review in the request.
 */
const eligibilityReviewed = (c: WorkflowContext): string | null =>
  c.needs_eligibility_review && !c.eligibility_review_confirmed
    ? 'This application needs a manual eligibility review: the automatic check could not decide it. Confirm the review with eligibility_review_confirmed: true.'
    : null;

/** Reviewer level recorded on decision_records.stage. */
const level = (value: string) => ({ level: value });

function reviewStage(
  role: AppRole,
  next: Stage,
  levelName: string,
  guard?: (c: WorkflowContext) => string | null,
) {
  return {
    meta: level(levelName),
    transitions: {
      [T.VERIFY]: { to: next, by: [role], guard, meta: { decision: 'APPROVE' } },
      [T.MARK_DEFECTIVE]: { to: 'DEFECTIVE' as Stage, by: [role], meta: { decision: 'DEFECT' } },
      [T.REJECT]: { to: 'REJECTED' as Stage, by: [role], meta: { decision: 'REJECT' } },
    },
  };
}

export const VIDYASETU_WORKFLOW: WorkflowDefinition<Stage, Principal, WorkflowContext> = {
  name: 'vidyasetu-scrutiny/v1',
  initial: 'SUBMITTED',
  states: {
    SUBMITTED: {
      automatic: ELIGIBILITY_GATE,
      transitions: {
        [T.ELIGIBLE]: { to: 'INO_VERIFIED', by: [SYSTEM] },
        // INDETERMINATE routes exactly like ELIGIBLE; the host flags the
        // application (needs_eligibility_review) for the manual review.
        [T.NEEDS_REVIEW]: { to: 'INO_VERIFIED', by: [SYSTEM] },
        [T.INELIGIBLE]: { to: 'DEFECTIVE', by: [SYSTEM] },
      },
    },
    INO_VERIFIED: reviewStage(
      AppRole.INSTITUTE_NODAL_OFFICER,
      'DNO_VERIFIED',
      'INSTITUTE',
      eligibilityReviewed,
    ),
    DNO_VERIFIED: reviewStage(AppRole.DISTRICT_NODAL_OFFICER, 'SNO_VERIFIED', 'DISTRICT'),
    SNO_VERIFIED: reviewStage(AppRole.STATE_NODAL_OFFICER, 'MINISTRY_APPROVED', 'STATE'),
    MINISTRY_APPROVED: {
      meta: level('MINISTRY'),
      transitions: {
        // Terminal for this phase; no disbursement processing and no endpoint yet.
        [T.DISBURSE]: {
          to: 'DISBURSED',
          by: [AppRole.MINISTRY_OFFICER],
          meta: { decision: 'DISBURSE' },
        },
      },
    },
    DEFECTIVE: {
      transitions: {
        // Back to whichever stage flagged it. Back to SUBMITTED (the gate
        // flagged it) re-runs the automatic eligibility gate.
        [T.RESUBMIT]: {
          to: {
            returnToOrigin: true,
            allowed: ['SUBMITTED', 'INO_VERIFIED', 'DNO_VERIFIED', 'SNO_VERIFIED'],
          },
          by: [AppRole.APPLICANT],
        },
      },
    },
    REJECTED: { terminal: true, transitions: {} },
    DISBURSED: { terminal: true, transitions: {} },
  },
};

const problems = validateDefinition(VIDYASETU_WORKFLOW);
if (problems.length > 0) {
  throw new Error(`Invalid workflow definition: ${problems.join('; ')}`);
}

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}
