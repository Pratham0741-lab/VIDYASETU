import { HttpException, NotFoundException } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { REDACTED_VALUE } from '../schemes/redaction';
import { classifyDenial, DenialOrigin, redactDenialDetails, subjectOf } from './denial-classifier';

const http = (route: string, params: Record<string, string> = {}): DenialOrigin => ({
  kind: 'http',
  method: 'POST',
  route,
  params,
});
const SEL = 'a3f0c9d2-0000-4000-8000-000000000001';

/** The shape Prisma gives a RAISE EXCEPTION from $queryRaw (P2010 wrapping P0001). */
function pgRaise(fn: string) {
  const msg = `${fn} may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)`;
  return Object.assign(
    new Error(
      `Invalid \`prisma.$queryRaw()\` invocation:\n\nRaw query failed. Code: \`P0001\`. Message: \`ERROR: ${msg}\``,
    ),
    { code: 'P2010', meta: { code: 'P0001', message: `ERROR: ${msg}` } },
  );
}

describe('classifyDenial - recorded', () => {
  it('RolesGuard wrong role -> WRONG_ROLE on the route, subject from the route', () => {
    const d = classifyDenial(
      new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'role_not_permitted' } }),
      http('/api/v1/selections/:id/confirm', { id: SEL }),
    );
    expect(d).toMatchObject({
      action_attempted: 'POST /api/v1/selections/:id/confirm',
      subject_type: 'selection',
      subject_id: SEL,
      denial_reason: 'WRONG_ROLE',
    });
    expect(d!.details).toMatchObject({
      error_code: 'FORBIDDEN',
      reason: 'role_not_permitted',
      origin: 'http',
    });
  });

  it('every FORBIDDEN is a denial, including reasons nobody listed yet', () => {
    expect(
      classifyDenial(
        new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_role_policy' } }),
        http('/x'),
      )!.denial_reason,
    ).toBe('NO_ROLE_POLICY');
    expect(
      classifyDenial(
        new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } }),
        http('/x'),
      )!.denial_reason,
    ).toBe('NO_OFFICER_PROFILE');
    expect(
      classifyDenial(
        new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'a_future_guard' } }),
        http('/x'),
      )!.denial_reason,
    ).toBe('FORBIDDEN');
    expect(classifyDenial(new AppError(ErrorCode.FORBIDDEN), http('/x'))!.denial_reason).toBe(
      'FORBIDDEN',
    );
  });

  it('Phase 4 engine rejections', () => {
    const cases: Array<[ErrorCode, string, string]> = [
      [ErrorCode.FORBIDDEN, 'principal_not_permitted', 'WRONG_ROLE'],
      [ErrorCode.CONFLICT, 'transition_not_allowed', 'WRONG_STAGE'],
      [ErrorCode.CONFLICT, 'terminal_state', 'WRONG_STAGE'],
      [ErrorCode.CONFLICT, 'guard_rejected', 'GUARD_REJECTED'],
      [ErrorCode.CONFLICT, 'no_return_target', 'NO_RETURN_TARGET'],
    ];
    for (const [code, reason, expected] of cases) {
      const d = classifyDenial(
        new AppError(code, { details: { reason, state: 'SUBMITTED', transition: 'verify' } }),
        http('/api/v1/applications/:id/verify', { id: SEL }),
      );
      expect([reason, d?.denial_reason, d?.subject_type]).toEqual([
        reason,
        expected,
        'application',
      ]);
    }
  });

  it('Phase 9 objection-window refusal', () => {
    const d = classifyDenial(
      new AppError(ErrorCode.CONFLICT, {
        details: {
          reason: 'objection_window_open',
          window_closes_at: '2026-10-12T00:00:00.000Z',
          open_objections_for_run: 1,
        },
      }),
      http('/api/v1/selections/:id/confirm', { id: SEL }),
    );
    expect(d).toMatchObject({ denial_reason: 'OBJECTION_WINDOW_OPEN', subject_type: 'selection' });
    expect(d!.details).toMatchObject({ open_objections_for_run: 1 });
  });

  it('a SYSTEM-actor guard RAISE, raw or wrapped, from HTTP or a job', () => {
    for (const fn of ['workflow_system_transition', 'document_system_flag_application']) {
      const raw = classifyDenial(pgRaise(fn), http('/api/v1/applications/:id/submit', { id: SEL }));
      expect(raw).toMatchObject({
        action_attempted: `db.${fn}`,
        denial_reason: 'SYSTEM_ACTOR_GUARD_FAILED',
        subject_type: 'application',
        subject_id: SEL,
      });
      const wrapped = new AppError(ErrorCode.INTERNAL_ERROR, { cause: pgRaise(fn) });
      expect(classifyDenial(wrapped, http('/x'))!.denial_reason).toBe('SYSTEM_ACTOR_GUARD_FAILED');
      const job = classifyDenial(pgRaise(fn), {
        kind: 'job',
        queue: 'document-pipeline',
        jobId: 'j1',
        attempt: 1,
        subjectType: 'application',
        subjectId: SEL,
      });
      expect(job).toMatchObject({ action_attempted: `db.${fn}`, subject_id: SEL });
      expect(job!.details).toMatchObject({
        origin: 'job',
        queue: 'document-pipeline',
        function: fn,
      });
    }
  });

  it('Phase 17 (M32): a write the database refused because the actor is the AUDITOR', () => {
    const raise = Object.assign(
      new Error('ERROR: AUDITOR_READ_ONLY: the AUDITOR role cannot UPDATE notifications'),
      { code: 'P2010' },
    );
    const d = classifyDenial(raise, http('/api/v1/notifications/:id/read', { id: SEL }));
    expect(d).toMatchObject({
      action_attempted: 'POST /api/v1/notifications/:id/read',
      denial_reason: 'AUDITOR_READ_ONLY',
      subject_type: 'notification',
      subject_id: SEL,
    });
    expect(d!.details).toMatchObject({ table: 'notifications' });
    const wrapped = new AppError(ErrorCode.INTERNAL_ERROR, { cause: raise });
    expect(classifyDenial(wrapped, http('/x'))!.denial_reason).toBe('AUDITOR_READ_ONLY');
  });

  it('Phase 17 (E): a 404 on a document view / download / crop route, and only there', () => {
    const get = (route: string, params: Record<string, string>): DenialOrigin => ({
      kind: 'http',
      method: 'GET',
      route,
      params,
    });
    const nf = new AppError(ErrorCode.NOT_FOUND);
    expect(classifyDenial(nf, get('/api/v1/documents/:id', { id: SEL }))).toMatchObject({
      action_attempted: 'GET /api/v1/documents/:id',
      denial_reason: 'DOCUMENT_NOT_ACCESSIBLE',
      subject_type: 'document',
      subject_id: SEL,
    });
    for (const route of [
      '/api/v1/applications/:id/documents',
      '/api/v1/applications/:id/deficiencies/items/:itemId/crop',
      '/api/v1/sanction-orders/:id',
      '/api/v1/sanction-orders/:id/pdf',
    ]) {
      expect(classifyDenial(nf, get(route, { id: SEL }))!.denial_reason).toBe(
        'DOCUMENT_NOT_ACCESSIBLE',
      );
    }
    // Elsewhere, and for a POST to the same pattern, NOT_FOUND stays unrecorded.
    expect(classifyDenial(nf, get('/api/v1/applications/:id', { id: SEL }))).toBeNull();
    expect(classifyDenial(nf, http('/api/v1/documents/:id', { id: SEL }))).toBeNull();
  });
});

describe('classifyDenial - not recorded', () => {
  it.each([
    [
      'UNAUTHORIZED',
      new AppError(ErrorCode.UNAUTHORIZED, { details: { reason: 'missing_token' } }),
    ],
    ['VALIDATION_ERROR', new AppError(ErrorCode.VALIDATION_ERROR)],
    ['TOO_MANY_REQUESTS', new AppError(ErrorCode.TOO_MANY_REQUESTS)],
    ['NOT_FOUND (RLS / scope empty result)', new AppError(ErrorCode.NOT_FOUND)],
    ['framework 404', new NotFoundException()],
    ['framework 403 without AppError', new HttpException('x', 429)],
    [
      'duplicate',
      new AppError(ErrorCode.CONFLICT, { details: { reason: 'sanction_order_exists' } }),
    ],
    ['concurrency', new AppError(ErrorCode.CONFLICT, { details: { reason: 'stage_changed' } })],
    [
      'config fault',
      new AppError(ErrorCode.CONFLICT, { details: { reason: 'no_selection_policy' } }),
    ],
    [
      'unrelated database error',
      Object.assign(new Error('duplicate key value'), { code: 'P2002' }),
    ],
    ['plain error', new Error('boom')],
  ])('%s', (_name, err) => {
    expect(classifyDenial(err, http('/api/v1/applications/:id', { id: SEL }))).toBeNull();
  });
});

describe('subjectOf', () => {
  it('names the resource before the first route parameter', () => {
    expect(subjectOf(http('/api/v1/sanction-orders/:id/pdf', { id: 'x1' }))).toEqual({
      type: 'sanction_order',
      id: 'x1',
    });
    expect(subjectOf(http('/api/v1/grievances/:id/resolve', { id: 'g1' }))).toEqual({
      type: 'grievance',
      id: 'g1',
    });
    expect(subjectOf(http('/api/v1/applications/queue'))).toEqual({ type: null, id: null });
    expect(subjectOf({ kind: 'http', method: 'GET', route: null, params: {} })).toEqual({
      type: null,
      id: null,
    });
  });
});

describe('redactDenialDetails (Phase 3 redaction, reused)', () => {
  it('replaces sensitive keys and sensitive-path text with REDACTED_VALUE, at any depth', () => {
    // No current denial carries these; a future one might.
    const out = redactDenialDetails({
      reason: 'guard_rejected',
      family_income_annual: 180000,
      nested: { bank_account: 'SBIN0001234:3001770', list: [{ caste_cert_number: 'JH-ST-1' }] },
      rule: 'applicant.family_income_annual <= params.ceiling',
      harmless: 'applicant.category in params.allowed_categories',
    });
    expect(out).toEqual({
      reason: 'guard_rejected',
      family_income_annual: REDACTED_VALUE,
      nested: { bank_account: REDACTED_VALUE, list: [{ caste_cert_number: REDACTED_VALUE }] },
      rule: REDACTED_VALUE,
      harmless: 'applicant.category in params.allowed_categories',
    });
    expect(JSON.stringify(out)).not.toMatch(/180000|SBIN|JH-ST-1/);
  });

  it('is applied by classifyDenial before anything is returned for persisting', () => {
    const d = classifyDenial(
      new AppError(ErrorCode.FORBIDDEN, {
        details: { reason: 'role_not_permitted', income: 99000 },
      }),
      http('/x'),
    );
    expect(d!.details.income).toEqual(REDACTED_VALUE);
  });
});
