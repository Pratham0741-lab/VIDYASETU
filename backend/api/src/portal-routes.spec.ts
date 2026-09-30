import { Readable } from 'node:stream';
import { ApplicationHistoryService } from './applications/application-history';
import { MeService } from './auth/me';
import { AppRole } from './auth/roles';
import { AppError } from './common/errors/app-error';
import { ErrorCode } from './common/errors/error-code.enum';
import { DocumentsService, SERVABLE_MIME_TYPES } from './documents/documents.service';
import { SchemeCatalogueService } from './schemes/scheme-catalogue';
import { SelectionListsService } from './selection-lists/selection-lists.service';

/** Phase 17.2: the portal read routes' services, with the database mocked. */

const APP = '11111111-1111-4111-8111-111111111111';

describe('GET /documents/:id/file (DocumentsService.file)', () => {
  const make = (row: unknown) => {
    const opened: string[] = [];
    const storage = {
      documentsBucket: 'documents',
      getStream: (_b: string, key: string) => {
        opened.push(key);
        return Promise.resolve(Readable.from([Buffer.from('bytes')]));
      },
    };
    const svc = Object.create(DocumentsService.prototype) as DocumentsService;
    Object.assign(svc, {
      db: { client: { document: { findFirst: () => Promise.resolve(row) } } },
      storage,
    });
    return { svc, opened };
  };

  it('serves exactly JPEG, PNG, WebP and PDF', () => {
    expect([...SERVABLE_MIME_TYPES].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
  });

  it('streams a visible document with its stored type (never buffered here)', async () => {
    const { svc, opened } = make({
      id: 'd1',
      mime_type: 'image/png',
      file_path: 'applications/a/k',
    });
    const f = await svc.file('d1');
    expect(f.mime_type).toBe('image/png');
    expect(f.stream).toBeInstanceOf(Readable);
    expect(opened).toEqual(['applications/a/k']);
  });

  it('404 when row-level security hides it (or it does not exist)', async () => {
    const { svc, opened } = make(null);
    await expect(svc.file('d1')).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(opened).toEqual([]);
  });

  it('415 with a message key for any other stored type; the object is never opened', async () => {
    const { svc, opened } = make({ id: 'd1', mime_type: 'text/html', file_path: 'k' });
    const e = (await svc.file('d1').catch((x: unknown) => x)) as AppError;
    expect(e.code).toBe(ErrorCode.UNSUPPORTED_MEDIA_TYPE);
    expect(e.status).toBe(415);
    expect(e.details).toMatchObject({
      reason: 'document_type_not_served',
      message_key: 'document.file.unsupported_type',
    });
    expect(opened).toEqual([]);
  });

  it('404 for a document with no stored file (DigiLocker)', async () => {
    const { svc } = make({ id: 'd1', mime_type: null, file_path: null });
    await expect(svc.file('d1')).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe('GET /applications/:id/history', () => {
  it('returns the four facts only, oldest first, from the security-invoker view', async () => {
    const queries: string[] = [];
    const svc = new ApplicationHistoryService({
      client: {
        application: { findFirst: () => Promise.resolve({ id: APP }) },
        $queryRaw: (sql: TemplateStringsArray) => {
          queries.push(sql.join('?'));
          return Promise.resolve([
            // Anything else the query might carry must not reach the response.
            {
              from_stage: null,
              to_stage: 'INO_VERIFIED',
              trigger_action: 'eligibility_passed',
              at: new Date('2026-08-17T05:00:00Z'),
              triggered_by: 'officer',
              remarks: 'secret',
            },
            {
              from_stage: 'INO_VERIFIED',
              to_stage: 'DNO_VERIFIED',
              trigger_action: 'verify',
              at: new Date('2026-08-20T05:00:00Z'),
            },
          ]);
        },
      },
    } as never);
    const r = await svc.history(APP);
    expect(queries[0]).toContain('FROM application_history');
    expect(r.history).toEqual([
      {
        from_stage: null,
        to_stage: 'INO_VERIFIED',
        trigger_action: 'eligibility_passed',
        at: '2026-08-17T05:00:00.000Z',
      },
      {
        from_stage: 'INO_VERIFIED',
        to_stage: 'DNO_VERIFIED',
        trigger_action: 'verify',
        at: '2026-08-20T05:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/officer|secret|remark/);
  });

  it('404 when the application is not visible', async () => {
    const svc = new ApplicationHistoryService({
      client: { application: { findFirst: () => Promise.resolve(null) } },
    } as never);
    await expect(svc.history(APP)).rejects.toBeInstanceOf(AppError);
  });
});

describe('GET /selection-lists/:id/objections', () => {
  it('ids, status, dates and decided only; objections on invisible applications are dropped', async () => {
    const svc = Object.create(SelectionListsService.prototype) as SelectionListsService;
    Object.assign(svc, {
      load: () => Promise.resolve({ id: 'L1', selection_run_id: 'R1' }),
      db: {
        client: {
          grievance: {
            findMany: () =>
              Promise.resolve([
                {
                  id: 'g1',
                  application_id: 'a1',
                  status: 'OPEN',
                  created_at: new Date('2026-09-01T00:00:00Z'),
                },
                {
                  id: 'g2',
                  application_id: 'a2',
                  status: 'REJECTED',
                  created_at: new Date('2026-09-02T00:00:00Z'),
                },
                {
                  id: 'g3',
                  application_id: 'hidden',
                  status: 'RESOLVED',
                  created_at: new Date('2026-09-03T00:00:00Z'),
                },
              ]),
          },
          application: {
            findMany: () =>
              Promise.resolve([
                { id: 'a1', application_no: 'VS-1' },
                { id: 'a2', application_no: 'VS-2' },
              ]),
          },
        },
      },
    });
    const r = await svc.objections('L1');
    expect(r).toEqual({
      selection_list_id: 'L1',
      objections: [
        {
          grievance_id: 'g1',
          application_no: 'VS-1',
          status: 'OPEN',
          created_at: '2026-09-01T00:00:00.000Z',
          decided: false,
        },
        {
          grievance_id: 'g2',
          application_no: 'VS-2',
          status: 'REJECTED',
          created_at: '2026-09-02T00:00:00.000Z',
          decided: true,
        },
      ],
    });
  });
});

describe('GET /auth/me', () => {
  const officer = {
    accountId: 'acc',
    role: AppRole.INSTITUTE_NODAL_OFFICER,
    officerId: 'o1',
    jurisdictionState: 'Jharkhand',
    jurisdictionDistrict: 'Ranchi',
  };
  const applicant = {
    accountId: 'acc2',
    role: AppRole.APPLICANT,
    officerId: null,
    jurisdictionState: null,
    jurisdictionDistrict: null,
  };

  it('officers get their name and institution code', async () => {
    const svc = new MeService({
      client: {
        $queryRaw: () => Promise.resolve([{ name: 'Officer Name', institution_code: 'U-1' }]),
      },
    } as never);
    expect(await svc.me(officer)).toEqual({
      ...officer,
      name: 'Officer Name',
      institution_code: 'U-1',
    });
  });

  it('applicants get exactly what they got before (no query at all)', async () => {
    let queried = false;
    const svc = new MeService({
      client: { $queryRaw: () => ((queried = true), Promise.resolve([])) },
    } as never);
    expect(await svc.me(applicant)).toEqual(applicant);
    expect(queried).toBe(false);
  });
});

describe('GET /schemes', () => {
  it('maps active versions to the six public fields, dates as YYYY-MM-DD', async () => {
    const svc = new SchemeCatalogueService({
      client: {
        $queryRaw: () =>
          Promise.resolve([
            {
              scheme_code: 'NFST',
              scheme_name: 'N',
              version_no: 5,
              scheme_version_id: 'v5',
              effective_from: new Date('2026-09-28T00:00:00Z'),
              effective_to: null,
              config: { secret: 1 },
            },
          ]),
      },
    } as never);
    expect(await svc.active()).toEqual({
      schemes: [
        {
          scheme_code: 'NFST',
          scheme_name: 'N',
          version_no: 5,
          scheme_version_id: 'v5',
          effective_from: '2026-09-28',
          effective_to: null,
        },
      ],
    });
  });
});
