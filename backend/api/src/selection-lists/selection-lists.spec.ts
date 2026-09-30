import { AppRole } from '../auth/roles';
import { decideTransition, statesActionableBy, WorkflowError } from '../workflow/engine';
import { finalOutcome, ListContext, LT, SELECTION_LIST_WORKFLOW } from './selection-list-workflow';

const ctx = (over: Partial<ListContext> = {}): ListContext => ({
  valid_approvals: 1,
  approvals_required: 1,
  window_elapsed: false,
  pending_objections: 0,
  ...over,
});
const decide = (
  from: string,
  transition: string,
  principal: AppRole,
  over: Partial<ListContext> = {},
) => decideTransition(SELECTION_LIST_WORKFLOW, { from, transition, principal, context: ctx(over) });
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as WorkflowError).kind;
  }
  return 'ALLOWED';
};

describe('selection list workflow (Phase 13E)', () => {
  it('the full path: approve -> publish -> decide -> close -> final', () => {
    expect(decide('DRAFT', LT.APPROVE, AppRole.COMMITTEE).to).toBe('DRAFT');
    expect(decide('DRAFT', LT.PUBLISH_PROVISIONAL, AppRole.MINISTRY_OFFICER).to).toBe(
      'PROVISIONAL_PUBLISHED',
    );
    expect(decide('PROVISIONAL_PUBLISHED', LT.DECIDE_OBJECTION, AppRole.COMMITTEE).to).toBe(
      'PROVISIONAL_PUBLISHED',
    );
    expect(
      decide('PROVISIONAL_PUBLISHED', LT.CLOSE_WINDOW, AppRole.MINISTRY_OFFICER, {
        window_elapsed: true,
      }).to,
    ).toBe('OBJECTION_WINDOW_CLOSED');
    expect(decide('OBJECTION_WINDOW_CLOSED', LT.PUBLISH_FINAL, AppRole.MINISTRY_OFFICER).to).toBe(
      'FINAL_PUBLISHED',
    );
  });

  it('who: the committee decides, the ministry publishes; nobody else acts', () => {
    expect(refusal(() => decide('DRAFT', LT.APPROVE, AppRole.MINISTRY_OFFICER))).toBe(
      'PRINCIPAL_NOT_PERMITTED',
    );
    expect(refusal(() => decide('DRAFT', LT.PUBLISH_PROVISIONAL, AppRole.COMMITTEE))).toBe(
      'PRINCIPAL_NOT_PERMITTED',
    );
    for (const role of [
      AppRole.AUDITOR,
      AppRole.APPLICANT,
      AppRole.SUPER_ADMIN,
      AppRole.STATE_NODAL_OFFICER,
    ]) {
      expect(statesActionableBy(SELECTION_LIST_WORKFLOW, role)).toEqual([]);
    }
  });

  it('when: approvals and overrides only in DRAFT; objections only while published; nothing after FINAL', () => {
    expect(refusal(() => decide('PROVISIONAL_PUBLISHED', LT.OVERRIDE, AppRole.COMMITTEE))).toBe(
      'TRANSITION_NOT_ALLOWED',
    );
    expect(refusal(() => decide('DRAFT', LT.DECIDE_OBJECTION, AppRole.COMMITTEE))).toBe(
      'TRANSITION_NOT_ALLOWED',
    );
    expect(refusal(() => decide('FINAL_PUBLISHED', LT.OVERRIDE, AppRole.COMMITTEE))).toBe(
      'TERMINAL_STATE',
    );
    expect(
      refusal(() => decide('OBJECTION_WINDOW_CLOSED', LT.DECIDE_OBJECTION, AppRole.COMMITTEE)),
    ).toBe('TRANSITION_NOT_ALLOWED');
  });

  it('guards: approvals, an open window, undecided objections', () => {
    expect(
      refusal(() =>
        decide('DRAFT', LT.PUBLISH_PROVISIONAL, AppRole.MINISTRY_OFFICER, {
          valid_approvals: 1,
          approvals_required: 2,
        }),
      ),
    ).toBe('GUARD_REJECTED');
    expect(
      refusal(() => decide('PROVISIONAL_PUBLISHED', LT.CLOSE_WINDOW, AppRole.MINISTRY_OFFICER)),
    ).toBe('GUARD_REJECTED');
    expect(
      refusal(() =>
        decide('PROVISIONAL_PUBLISHED', LT.CLOSE_WINDOW_EARLY, AppRole.COMMITTEE, {
          pending_objections: 1,
        }),
      ),
    ).toBe('GUARD_REJECTED');
    expect(decide('PROVISIONAL_PUBLISHED', LT.CLOSE_WINDOW_EARLY, AppRole.COMMITTEE).to).toBe(
      'OBJECTION_WINDOW_CLOSED',
    );
  });

  it('final outcome: the committee decision beside the computed result; held always wins', () => {
    const e = (computed_outcome: string, committee_decision: string | null) => ({
      computed_outcome,
      committee_decision,
    });
    expect(finalOutcome(e('SELECTED', null), false)).toBe('SELECTED');
    expect(finalOutcome(e('SELECTED', 'EXCLUDE'), false)).toBe('NOT_SELECTED');
    expect(finalOutcome(e('NOT_SELECTED', 'INCLUDE'), false)).toBe('SELECTED');
    expect(finalOutcome(e('NOT_SELECTED', null), false)).toBe('NOT_SELECTED');
    expect(finalOutcome(e('HELD', 'INCLUDE'), false)).toBe('HELD');
    expect(finalOutcome(e('SELECTED', null), true)).toBe('HELD');
  });
});
