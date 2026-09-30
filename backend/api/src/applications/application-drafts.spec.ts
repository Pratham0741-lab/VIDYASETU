import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ApplicationDraftsService } from './application-drafts.service';
import type { ApplicationsService } from './applications.service';

const actor = { accountId: 'acc-1', role: 'APPLICANT', officerId: null } as unknown as Actor;
const VERSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function setup(draft: Record<string, unknown>) {
  const row = {
    id: 'd1',
    status: 'DRAFT',
    scheme_version_id: VERSION,
    academic_year: '2026-27',
    institution_name: null,
    institution_code: 'U-0001',
    course_name: null,
    course_year: 2,
    is_hosteller: null,
    declared: { education_level: 'UG' },
    submitted_application_id: null,
    submitted_at: null,
    ...draft,
  };
  const client = {
    applicant: { findUnique: jest.fn(() => Promise.resolve({ id: 'applicant-1' })) },
    schemeVersion: { findUnique: jest.fn(() => Promise.resolve({ status: 'active' })) },
    applicationDraft: {
      count: jest.fn(() => Promise.resolve(0)),
      create: jest.fn((a: { data: unknown }) => Promise.resolve({ ...row, ...(a.data as object) })),
      findFirst: jest.fn(() => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve(row)),
    },
  };
  const create = jest.fn(() => Promise.resolve({ id: 'app-9', current_stage: 'INO_VERIFIED' }));
  const service = new ApplicationDraftsService(
    { client } as never,
    { create } as unknown as ApplicationsService,
    { info: jest.fn() } as never,
  );
  return { service, client, create };
}

describe('application drafts (Phase 14 loose ends, Part C)', () => {
  it.each(['family_income_annual', 'category', 'caste_cert_number', 'bank_account', 'income'])(
    'refuses %s in declared (recorded or sensitive: never stored in a draft)',
    async (key) => {
      const { service, client } = setup({});
      await expect(service.create(actor, { declared: { [key]: 1 } })).rejects.toBeInstanceOf(
        AppError,
      );
      expect(client.applicationDraft.create).not.toHaveBeenCalled();
    },
  );

  it('a scheme draft version is as invisible as a missing one', async () => {
    const { service, client } = setup({});
    client.schemeVersion.findUnique.mockResolvedValueOnce({ status: 'draft' });
    await expect(service.create(actor, { scheme_version_id: VERSION })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('submit: the unchanged create path with the draft fields, then the draft is frozen', async () => {
    const { service, client, create } = setup({});
    await service.submit(actor, 'd1');
    expect(create).toHaveBeenCalledWith(
      actor,
      {
        scheme_version_id: VERSION,
        academic_year: '2026-27',
        institution_code: 'U-0001',
        course_year: 2,
        declared: { education_level: 'UG' },
      },
      false,
    );
    expect(client.applicationDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUBMITTED', submitted_application_id: 'app-9' }),
      }),
    );
  });

  it('submit awaiting documents: the gate is left for when the documents are in', async () => {
    const { service, create } = setup({});
    await service.submit(actor, 'd1', true);
    expect(create).toHaveBeenCalledWith(actor, expect.anything(), true);
  });

  it('an incomplete draft cannot be submitted; a submitted one cannot change', async () => {
    const incomplete = setup({ academic_year: null });
    await expect(incomplete.service.submit(actor, 'd1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(incomplete.create).not.toHaveBeenCalled();
    const done = setup({ status: 'SUBMITTED', submitted_application_id: 'app-9' });
    await expect(done.service.update('d1', { course_year: 3 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(done.service.submit(actor, 'd1')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
