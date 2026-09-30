import { lastValueFrom, of } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/errors/app-error';
import { DocumentAccessInterceptor, DocumentAccessService } from './document-access';
import { DOCUMENT_ACCESS_ROUTES } from './document-access-routes';

const actor = { accountId: 'acc-1', role: 'INSTITUTE_NODAL_OFFICER' };
const req = {
  method: 'GET',
  baseUrl: '',
  route: { path: '/api/v1/documents/:id' },
  params: { id: 'doc-1' },
  headers: {},
  actor,
};

function service(rows: number) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return Promise.resolve(rows);
    },
  };
  return { svc: new DocumentAccessService({ client } as never), calls };
}

describe('document access log (Phase 17, Part E)', () => {
  it('writes one row: actor, kind, resource, route pattern - ids only', async () => {
    const { svc, calls } = service(1);
    await svc.record({ kind: 'VIEW', resource: 'document' }, req as never, actor as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO document_access_log');
    expect(calls[0].sql).not.toMatch(/RETURNING/i);
    expect(calls[0].values).toEqual(
      expect.arrayContaining(['acc-1', 'INSTITUTE_NODAL_OFFICER', 'VIEW', 'document', 'doc-1']),
    );
    expect(calls[0].values).toContain('GET /api/v1/documents/:id');
  });

  it('fails closed: no row written -> the view is not served', async () => {
    const { svc } = service(0);
    await expect(
      svc.record({ kind: 'VIEW', resource: 'document' }, req as never, actor as never),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('the interceptor records only after the handler succeeded, and passes the body through', async () => {
    const recorded: unknown[] = [];
    const access = { record: (...a: unknown[]) => (recorded.push(a), Promise.resolve()) };
    const reflector = {
      get: () => ({ kind: 'VIEW', resource: 'document' }),
    } as unknown as Reflector;
    const icpt = new DocumentAccessInterceptor(reflector, access as never);
    const ctx = {
      getHandler: () => undefined,
      switchToHttp: () => ({ getRequest: () => req }),
    };
    const body = await lastValueFrom(icpt.intercept(ctx as never, { handle: () => of({ ok: 1 }) }));
    expect(body).toEqual({ ok: 1 });
    expect(recorded).toHaveLength(1);
  });

  it('the logged route list names each decorated route', () => {
    expect([...DOCUMENT_ACCESS_ROUTES].sort()).toEqual([
      'GET /api/v1/applications/:id/deficiencies/items/:itemId/crop',
      'GET /api/v1/applications/:id/documents',
      'GET /api/v1/documents/:id',
      'GET /api/v1/documents/:id/file',
      'GET /api/v1/sanction-orders/:id',
      'GET /api/v1/sanction-orders/:id/pdf',
    ]);
  });
});
