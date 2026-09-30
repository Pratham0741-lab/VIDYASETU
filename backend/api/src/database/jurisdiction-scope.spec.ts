import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import {
  APPLICATION_SCOPED_MODELS,
  applicationScopeFor,
  SCOPED_OPERATIONS,
  withScope,
} from './jurisdiction-scope';

const officer = (overrides: Partial<Actor>): Actor => ({
  accountId: 'acc-1',
  role: AppRole.DISTRICT_NODAL_OFFICER,
  officerId: 'off-1',
  jurisdictionState: 'Jharkhand',
  jurisdictionDistrict: 'Ranchi',
  ...overrides,
});

describe('applicationScopeFor (mirror of the applications RLS policy)', () => {
  it('adds no application-layer filter without an actor (RLS alone decides)', () => {
    expect(applicationScopeFor(undefined)).toBeNull();
  });

  it('restricts applicants to their own applications', () => {
    const applicant: Actor = {
      accountId: 'acc-9',
      role: AppRole.APPLICANT,
      officerId: null,
      jurisdictionState: null,
      jurisdictionDistrict: null,
    };
    expect(applicationScopeFor(applicant)).toEqual({ applicant: { user_id: 'acc-9' } });
  });

  it('gives officers with NULL jurisdiction_state national scope', () => {
    expect(
      applicationScopeFor(
        officer({
          role: AppRole.MINISTRY_OFFICER,
          jurisdictionState: null,
          jurisdictionDistrict: null,
        }),
      ),
    ).toBeNull();
  });

  it('limits state officers to their state, plus their assigned applications', () => {
    expect(
      applicationScopeFor(
        officer({ role: AppRole.STATE_NODAL_OFFICER, jurisdictionDistrict: null }),
      ),
    ).toEqual({ OR: [{ jurisdiction_state: 'Jharkhand' }, { assigned_officer_id: 'off-1' }] });
  });

  it('limits district officers to state AND district, plus their assigned applications', () => {
    expect(applicationScopeFor(officer({}))).toEqual({
      OR: [
        { jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Ranchi' },
        { assigned_officer_id: 'off-1' },
      ],
    });
  });
});

describe('withScope', () => {
  const scope = { jurisdiction_state: 'Jharkhand' };

  it('keeps unique fields top-level so findUnique/update remain valid', () => {
    expect(withScope({ id: 'a1' }, scope)).toEqual({ id: 'a1', AND: [scope] });
  });

  it('appends to an existing AND array or object instead of replacing it', () => {
    expect(withScope({ AND: [{ status: 'PENDING' }] }, scope)).toEqual({
      AND: [{ status: 'PENDING' }, scope],
    });
    expect(withScope({ AND: { status: 'PENDING' } }, scope)).toEqual({
      AND: [{ status: 'PENDING' }, scope],
    });
  });

  it('creates a where when there was none', () => {
    expect(withScope(undefined, scope)).toEqual({ AND: [scope] });
  });
});

describe('scoped models and operations', () => {
  it('reaches the owning application from every child model', () => {
    const s = { jurisdiction_state: 'X' };
    expect(APPLICATION_SCOPED_MODELS.Application(s)).toEqual(s);
    expect(APPLICATION_SCOPED_MODELS.Document(s)).toEqual({ application: s });
    expect(APPLICATION_SCOPED_MODELS.DocumentExtraction(s)).toEqual({
      document: { application: s },
    });
    expect(APPLICATION_SCOPED_MODELS.Renewal(s)).toEqual({ parent_application: s });
    for (const model of [
      'DecisionRecord',
      'Deficiency',
      'WorkflowTransition',
      'Score',
      'Selection',
      'Disbursement',
    ]) {
      expect(APPLICATION_SCOPED_MODELS[model](s)).toEqual({ application: s });
    }
  });

  it('scopes every read, update and delete operation', () => {
    for (const op of [
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'upsert',
    ]) {
      expect(SCOPED_OPERATIONS.has(op)).toBe(true);
    }
    expect(SCOPED_OPERATIONS.has('create')).toBe(false);
  });
});
