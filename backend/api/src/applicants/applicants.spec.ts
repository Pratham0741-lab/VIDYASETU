import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { AppConfigService } from '../config/app-config.service';
import type { DbContext } from '../database/db-context';
import { ApplicantsService } from './applicants.service';

const actor = { accountId: 'acc-1', role: AppRole.APPLICANT, officerId: null } as unknown as Actor;
const ROW = {
  id: 'app-1',
  email: 'a@example.org',
  first_name: 'Asha',
  last_name: 'Munda',
  phone: '9000000001',
  gender: 'FEMALE',
  dob: new Date('2004-01-01'),
  category: 'ST',
  pvtg_group: null,
  is_disabled: false,
  disability_type: null,
  disability_percentage: null,
  domicile_state: 'Jharkhand',
  domicile_district: 'Ranchi',
  caste_cert_number: 'JH-ST-2026-123456',
  income: '180000.00',
  bank_account: 'SBIN0004455:12345678',
  preferred_language: 'en',
  updated_at: new Date(),
};

function setup() {
  let row = { ...ROW };
  const findFirst = jest.fn((args: { where: { user_id: string } }) =>
    Promise.resolve(args.where.user_id === 'acc-1' ? row : null),
  );
  const update = jest.fn((args: { data: Partial<typeof ROW> }) => {
    row = { ...row, ...args.data };
    return Promise.resolve({ id: row.id });
  });
  const create = jest.fn(() => Promise.resolve({ id: 'chg-1' }));
  const info = jest.fn();
  const db = {
    client: { applicant: { findFirst, update }, applicantProfileChange: { create } },
  } as unknown as DbContext;
  const config = { languages: { supported: ['en', 'hi', 'sat'] } } as unknown as AppConfigService;
  return {
    svc: new ApplicantsService(db, config, { info } as never),
    findFirst,
    update,
    create,
    info,
  };
}

describe('ApplicantsService (Phase 13D)', () => {
  it('reads only the caller’s own row, identifiers masked', async () => {
    const { svc, findFirst } = setup();
    const me = await svc.me(actor);
    expect(findFirst.mock.calls[0][0].where).toEqual({ user_id: 'acc-1' });
    expect(me).toMatchObject({
      caste_cert_number_masked: '****3456',
      bank_account_masked: '****5678',
      editable_fields: ['phone', 'preferred_language'],
    });
    expect(JSON.stringify(me)).not.toContain('JH-ST-2026-123456');
    expect(JSON.stringify(me)).not.toContain('12345678');
  });

  it('a caller without an applicant profile gets 404', async () => {
    const { svc } = setup();
    await expect(svc.me({ ...actor, accountId: 'other' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('changes language and phone; records which fields changed, never the values; logs names only', async () => {
    const { svc, update, create, info } = setup();
    const r = await svc.update(actor, { preferred_language: 'hi', phone: '9000000002' });
    expect(update.mock.calls[0][0]).toMatchObject({
      data: { phone: '9000000002', preferred_language: 'hi' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        applicant_id: 'app-1',
        changed_fields: ['phone', 'preferred_language'],
        changed_by_account_id: 'acc-1',
      },
      select: { id: true },
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('9000000002');
    expect(r.preferred_language).toBe('hi');
  });

  it('refuses an unsupported language; an unchanged value writes nothing', async () => {
    const { svc, update, create } = setup();
    await expect(svc.update(actor, { preferred_language: 'fr' })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
    });
    const r = await svc.update(actor, { preferred_language: 'en', phone: '9000000001' });
    expect(r.changed_fields).toEqual([]);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
