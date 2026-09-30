import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AuthorizationDenialsService } from './authorization-denials.controller';

describe('AuthorizationDenialsService.list', () => {
  const rows = [
    { id: 'd2', denial_reason: 'WRONG_ROLE', seq: 9007199254740993n, occurred_at: new Date(0) },
    { id: 'd1', denial_reason: 'WRONG_ROLE', seq: null, occurred_at: new Date(0) },
  ];
  const service = new AuthorizationDenialsService({
    client: { authorizationDenial: { findMany: () => Promise.resolve(rows) } },
  } as never);
  const actor = {
    accountId: 'a',
    role: AppRole.STATE_NODAL_OFFICER,
    officerId: 'o',
    jurisdictionState: 'Jharkhand',
    jurisdictionDistrict: null,
  } as Actor;

  it('returns seq as a decimal string (a BigInt is not JSON-serialisable), exactly', async () => {
    const r = await service.list(actor, {});
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r.denials.map((d) => d.seq)).toEqual(['9007199254740993', null]);
  });
});
