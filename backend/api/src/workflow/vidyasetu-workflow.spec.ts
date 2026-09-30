import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppRole } from '../auth/roles';
import { decideTransition, statesActionableBy, validateDefinition, WorkflowError } from './engine';
import {
  Principal,
  Stage,
  STAGE_SLA_DAYS,
  stageDueAt,
  STAGES,
  STATUS_FOR_STAGE,
  SYSTEM,
  T,
  VIDYASETU_WORKFLOW as W,
} from './vidyasetu-workflow';

const MIGRATION = readFileSync(
  join(__dirname, '../../prisma/migrations/20260926070000_workflow_state_machine/migration.sql'),
  'utf8',
);

const edges = () =>
  STAGES.flatMap((from) =>
    Object.entries(W.states[from].transitions).map(([name, t]) => ({
      from,
      name,
      to: typeof t.to === 'string' ? t.to : `<origin:${t.to.allowed.join('|')}>`,
      by: [...t.by],
    })),
  );

const ctx = { needs_eligibility_review: false, eligibility_review_confirmed: false };

function attempt(from: Stage, transition: string, principal: Principal, context = ctx) {
  try {
    return decideTransition(W, { from, transition, principal, context }).to;
  } catch (err) {
    if (err instanceof WorkflowError) return err.kind;
    throw err;
  }
}

describe('VIDYASETU workflow definition', () => {
  it('is structurally valid and starts at SUBMITTED (no draft state)', () => {
    expect(validateDefinition(W)).toEqual([]);
    expect(W.initial).toBe('SUBMITTED');
    expect(Object.keys(W.states).sort()).toEqual([...STAGES].sort());
  });

  it('has exactly the specified graph', () => {
    expect(edges()).toEqual([
      { from: 'SUBMITTED', name: T.ELIGIBLE, to: 'INO_VERIFIED', by: [SYSTEM] },
      { from: 'SUBMITTED', name: T.NEEDS_REVIEW, to: 'INO_VERIFIED', by: [SYSTEM] },
      { from: 'SUBMITTED', name: T.INELIGIBLE, to: 'DEFECTIVE', by: [SYSTEM] },
      { from: 'INO_VERIFIED', name: T.VERIFY, to: 'DNO_VERIFIED', by: ['INSTITUTE_NODAL_OFFICER'] },
      {
        from: 'INO_VERIFIED',
        name: T.MARK_DEFECTIVE,
        to: 'DEFECTIVE',
        by: ['INSTITUTE_NODAL_OFFICER'],
      },
      { from: 'INO_VERIFIED', name: T.REJECT, to: 'REJECTED', by: ['INSTITUTE_NODAL_OFFICER'] },
      { from: 'DNO_VERIFIED', name: T.VERIFY, to: 'SNO_VERIFIED', by: ['DISTRICT_NODAL_OFFICER'] },
      {
        from: 'DNO_VERIFIED',
        name: T.MARK_DEFECTIVE,
        to: 'DEFECTIVE',
        by: ['DISTRICT_NODAL_OFFICER'],
      },
      { from: 'DNO_VERIFIED', name: T.REJECT, to: 'REJECTED', by: ['DISTRICT_NODAL_OFFICER'] },
      {
        from: 'SNO_VERIFIED',
        name: T.VERIFY,
        to: 'MINISTRY_APPROVED',
        by: ['STATE_NODAL_OFFICER'],
      },
      {
        from: 'SNO_VERIFIED',
        name: T.MARK_DEFECTIVE,
        to: 'DEFECTIVE',
        by: ['STATE_NODAL_OFFICER'],
      },
      { from: 'SNO_VERIFIED', name: T.REJECT, to: 'REJECTED', by: ['STATE_NODAL_OFFICER'] },
      { from: 'MINISTRY_APPROVED', name: T.DISBURSE, to: 'DISBURSED', by: ['MINISTRY_OFFICER'] },
      {
        from: 'DEFECTIVE',
        name: T.RESUBMIT,
        to: '<origin:SUBMITTED|INO_VERIFIED|DNO_VERIFIED|SNO_VERIFIED>',
        by: ['APPLICANT'],
      },
    ]);
    expect(W.states.REJECTED.terminal).toBe(true);
    expect(W.states.DISBURSED.terminal).toBe(true);
  });

  it('only the SYSTEM principal can leave SUBMITTED; no token role is SYSTEM', () => {
    expect(attempt('SUBMITTED', T.ELIGIBLE, AppRole.INSTITUTE_NODAL_OFFICER)).toBe(
      'PRINCIPAL_NOT_PERMITTED',
    );
    expect(attempt('SUBMITTED', T.ELIGIBLE, SYSTEM)).toBe('INO_VERIFIED');
    expect(Object.values(AppRole)).not.toContain(SYSTEM);
  });

  it('rejects verify on DEFECTIVE and final stages, and the wrong role at a stage', () => {
    expect(attempt('DEFECTIVE', T.VERIFY, AppRole.INSTITUTE_NODAL_OFFICER)).toBe(
      'TRANSITION_NOT_ALLOWED',
    );
    expect(attempt('REJECTED', T.VERIFY, AppRole.INSTITUTE_NODAL_OFFICER)).toBe('TERMINAL_STATE');
    expect(attempt('INO_VERIFIED', T.VERIFY, AppRole.DISTRICT_NODAL_OFFICER)).toBe(
      'PRINCIPAL_NOT_PERMITTED',
    );
  });

  it('requires a confirmed manual review to verify a flagged application', () => {
    const flagged = { needs_eligibility_review: true, eligibility_review_confirmed: false };
    expect(attempt('INO_VERIFIED', T.VERIFY, AppRole.INSTITUTE_NODAL_OFFICER, flagged)).toBe(
      'GUARD_REJECTED',
    );
    expect(
      attempt('INO_VERIFIED', T.VERIFY, AppRole.INSTITUTE_NODAL_OFFICER, {
        ...flagged,
        eligibility_review_confirmed: true,
      }),
    ).toBe('DNO_VERIFIED');
  });

  it('derives each queue from the graph', () => {
    expect(statesActionableBy(W, AppRole.INSTITUTE_NODAL_OFFICER)).toEqual(['INO_VERIFIED']);
    expect(statesActionableBy(W, AppRole.DISTRICT_NODAL_OFFICER)).toEqual(['DNO_VERIFIED']);
    expect(statesActionableBy(W, AppRole.STATE_NODAL_OFFICER)).toEqual(['SNO_VERIFIED']);
    expect(statesActionableBy(W, AppRole.MINISTRY_OFFICER)).toEqual(['MINISTRY_APPROVED']);
    expect(statesActionableBy(W, AppRole.SUPER_ADMIN)).toEqual([]);
  });

  it('status mapping in code equals the database CHECK in the migration', () => {
    const pairs = [...MIGRATION.matchAll(/WHEN '([A-Z_]+)' THEN '([A-Z_]+)'/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(Object.fromEntries(pairs)).toEqual(STATUS_FOR_STAGE);
  });

  it('computes due times only for stages with an SLA', () => {
    const t0 = new Date('2026-09-26T00:00:00.000Z');
    expect(stageDueAt('INO_VERIFIED', t0)?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(stageDueAt('SUBMITTED', t0)).toBeNull();
    expect(stageDueAt('REJECTED', t0)).toBeNull();
    for (const stage of Object.keys(STAGE_SLA_DAYS)) {
      expect(W.states[stage as Stage].terminal).toBeFalsy();
    }
  });
});
