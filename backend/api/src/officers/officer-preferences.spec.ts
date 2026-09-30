import type { Actor } from '../auth/actor';
import { OfficerPreferencesService } from './officer-preferences';

const actor = { accountId: 'acc-1', role: 'DISTRICT_NODAL_OFFICER', officerId: 'off-1' } as Actor;

function setup(existing: { preferred_language: string; updated_at: Date } | null = null) {
  const upsert = jest.fn((a: { create: { preferred_language: string } }) =>
    Promise.resolve({ preferred_language: a.create.preferred_language, updated_at: new Date(0) }),
  );
  const client = {
    officer: { findUnique: jest.fn(() => Promise.resolve({ id: 'off-1' })) },
    officerPreference: { findUnique: jest.fn(() => Promise.resolve(existing)), upsert },
  };
  const service = new OfficerPreferencesService(
    { client } as never,
    { languages: { supported: ['en', 'hi', 'sat'] } } as never,
    { info: jest.fn() } as never,
  );
  return { service, upsert };
}

describe('officer notice language (Phase 16, M50)', () => {
  it('defaults to English when nothing is set', async () => {
    const { service } = setup();
    await expect(service.mine(actor)).resolves.toMatchObject({
      preferred_language: 'en',
      is_default: true,
    });
  });

  it('accepts a supported language and records who set it', async () => {
    const { service, upsert } = setup();
    await expect(service.setMine(actor, 'hi')).resolves.toMatchObject({
      preferred_language: 'hi',
      is_default: false,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { officer_id: 'off-1', preferred_language: 'hi', updated_by_account_id: 'acc-1' },
      }),
    );
  });

  it('refuses a language outside SUPPORTED_LANGUAGES (standard error shape)', async () => {
    const { service, upsert } = setup();
    await expect(service.setMine(actor, 'fr')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(upsert).not.toHaveBeenCalled();
  });
});
