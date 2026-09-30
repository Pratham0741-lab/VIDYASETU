import { AppRole } from '../auth/roles';
import { validateDefinition, WorkflowDefinition } from '../workflow/engine';

/**
 * Phase 13E: the lifecycle of a selection run's list, on the generic
 * workflow engine (src/workflow/engine.ts) - a second definition beside the
 * application workflow, which is unchanged.
 *
 *   DRAFT                     the allocator's provisional list; the committee
 *                             approves it and may override rows (with reasons)
 *   PROVISIONAL_PUBLISHED     published to applicants; the objection window
 *                             is open until window_closes_at; the committee
 *                             decides objections
 *   OBJECTION_WINDOW_CLOSED   no more objections
 *   FINAL_PUBLISHED           the final list; frozen (database trigger)
 *
 * Committee actions that do not move the list are self-transitions, so who
 * may do what in which state is declared here in one place. The ministry
 * publishes and closes; the committee decides.
 */
export const LIST_STATES = [
  'DRAFT',
  'PROVISIONAL_PUBLISHED',
  'OBJECTION_WINDOW_CLOSED',
  'FINAL_PUBLISHED',
] as const;
export type ListState = (typeof LIST_STATES)[number];

export const LT = {
  APPROVE: 'approve',
  OVERRIDE: 'override',
  PUBLISH_PROVISIONAL: 'publish_provisional',
  DECIDE_OBJECTION: 'decide_objection',
  CLOSE_WINDOW: 'close_objection_window',
  CLOSE_WINDOW_EARLY: 'close_objection_window_early',
  PUBLISH_FINAL: 'publish_final',
} as const;

export interface ListContext {
  /** Committee approvals given after the latest override. */
  valid_approvals: number;
  approvals_required: number;
  window_elapsed: boolean;
  /** Objections to this run not yet decided. */
  pending_objections: number;
}

const approvalsMet = (c: ListContext) =>
  c.valid_approvals >= c.approvals_required
    ? null
    : `The list needs ${c.approvals_required} committee approval(s) given after the last override; it has ${c.valid_approvals}.`;
const noPendingObjections = (c: ListContext) =>
  c.pending_objections === 0
    ? null
    : `${c.pending_objections} objection(s) to this list are not decided yet.`;
const windowElapsed = (c: ListContext) =>
  !c.window_elapsed
    ? 'The objection window is still open. The committee can close it early with a reason.'
    : noPendingObjections(c);

const C = AppRole.COMMITTEE;
const M = AppRole.MINISTRY_OFFICER;

export const SELECTION_LIST_WORKFLOW: WorkflowDefinition<ListState, AppRole, ListContext> = {
  name: 'vidyasetu-selection-list/v1',
  initial: 'DRAFT',
  states: {
    DRAFT: {
      transitions: {
        [LT.APPROVE]: { to: 'DRAFT', by: [C] },
        [LT.OVERRIDE]: { to: 'DRAFT', by: [C] },
        [LT.PUBLISH_PROVISIONAL]: { to: 'PROVISIONAL_PUBLISHED', by: [M], guard: approvalsMet },
      },
    },
    PROVISIONAL_PUBLISHED: {
      transitions: {
        [LT.DECIDE_OBJECTION]: { to: 'PROVISIONAL_PUBLISHED', by: [C] },
        [LT.CLOSE_WINDOW]: { to: 'OBJECTION_WINDOW_CLOSED', by: [M], guard: windowElapsed },
        [LT.CLOSE_WINDOW_EARLY]: {
          to: 'OBJECTION_WINDOW_CLOSED',
          by: [C],
          guard: noPendingObjections,
        },
      },
    },
    OBJECTION_WINDOW_CLOSED: {
      transitions: {
        [LT.PUBLISH_FINAL]: { to: 'FINAL_PUBLISHED', by: [M] },
      },
    },
    FINAL_PUBLISHED: { terminal: true, transitions: {} },
  },
};

const problems = validateDefinition(SELECTION_LIST_WORKFLOW);
if (problems.length > 0) {
  throw new Error(`Invalid selection list workflow: ${problems.join('; ')}`);
}

/** The final outcome of an entry (set when the final list is published). */
export function finalOutcome(
  entry: { computed_outcome: string; committee_decision: string | null },
  heldNow: boolean,
): 'SELECTED' | 'NOT_SELECTED' | 'HELD' {
  if (entry.computed_outcome === 'HELD' || heldNow) return 'HELD';
  if (entry.committee_decision === 'EXCLUDE') return 'NOT_SELECTED';
  if (entry.committee_decision === 'INCLUDE') return 'SELECTED';
  return entry.computed_outcome === 'SELECTED' ? 'SELECTED' : 'NOT_SELECTED';
}
