import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import type { DbContext } from '../database/db-context';
import { AnalyticsService, LIVE_SELECTION_STATUSES } from './analytics.service';
import { toCsv } from './csv';
import { maskCount, SECONDARY_SUPPRESSED, SUPPRESSED, suppressRows } from './suppression';

const actor = (role: AppRole): Actor =>
  ({ accountId: 'a', role, officerId: 'o', jurisdictionState: null }) as unknown as Actor;

function service() {
  const calls: string[] = [];
  const sqlText = (q: unknown) =>
    Array.isArray(q) ? q.join('?') : ((q as { strings?: string[] }).strings ?? []).join('?');
  const client = {
    $executeRaw: jest.fn((q: unknown) => {
      calls.push(sqlText(q).trim());
      return Promise.resolve(0);
    }),
    $queryRaw: jest.fn((q: unknown) => {
      const text = sqlText(q).trim();
      calls.push(text);
      if (text.includes('transaction_read_only')) return Promise.resolve([{ ro: 'on' }]);
      return Promise.resolve([{ submitted: 0 }]);
    }),
  };
  const logger = { info: jest.fn() };
  const svc = new AnalyticsService({ client } as unknown as DbContext, logger as never);
  return { svc, calls, logger };
}

describe('small-count suppression (threshold 5)', () => {
  it('masks 1-4, keeps 0 and >= 5', () => {
    expect([0, 1, 4, 5, 12].map(maskCount)).toEqual([0, SUPPRESSED, SUPPRESSED, 5, 12]);
  });

  it('masks a whole row below the threshold, amounts included', () => {
    const [row] = suppressRows([{ applications: 3, held: 0, rejected: 2, paid: 111000 }], {
      applicantKey: 'applications',
      countKeys: ['applications', 'held', 'rejected'],
      amountKeys: ['paid'],
    });
    expect(row).toEqual({
      applications: SUPPRESSED,
      held: 0,
      rejected: SUPPRESSED,
      paid: SECONDARY_SUPPRESSED,
    });
  });

  it('adds a secondary mask so one masked cell cannot be derived from the total', () => {
    const rows = suppressRows(
      [
        { st: 'A', applications: 20, rejected: 2 },
        { st: 'A', applications: 30, rejected: 7 },
        { st: 'A', applications: 40, rejected: 9 },
      ],
      { applicantKey: 'applications', countKeys: ['rejected'], groupKey: (r) => String(r.st) },
    );
    expect(rows.map((r) => r.rejected)).toEqual([SUPPRESSED, SECONDARY_SUPPRESSED, 9]);
  });
});

describe('CSV export', () => {
  it('quotes, neutralises formulas and emits only the listed columns', () => {
    const out = toCsv(['a', 'b'], [{ a: 'x,"y"', b: '=HYPERLINK("z")', secret: 'never' }]);
    expect(out).toBe('a,b\r\n"x,""y""","\'=HYPERLINK(""z"")"\r\n');
    expect(out).not.toContain('never');
    expect(toCsv(['n'], [{ n: -5 }, { n: SUPPRESSED }])).toBe('n\r\n-5\r\n<5\r\n');
  });
});

describe('definitions reused, not re-derived', () => {
  it("live selection statuses equal Phase 6's LIVE_STATUSES", () => {
    const src = readFileSync(join(__dirname, '../selection/selection.service.ts'), 'utf8');
    const m = src.match(/const LIVE_STATUSES = (\[[^\]]*\]);/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1].replace(/'/g, '"'))).toEqual(LIVE_SELECTION_STATUSES);
  });
});

describe('AnalyticsService request bounds', () => {
  const q = { from: '2026-04-01', to: '2027-04-01' };

  it('switches the transaction to READ ONLY before any read', async () => {
    const { svc, calls } = service();
    const r = await svc.funnel(actor(AppRole.STATE_NODAL_OFFICER), q);
    expect(calls[0]).toBe('SET TRANSACTION READ ONLY');
    expect(r.meta.read_only_transaction).toBe(true);
    expect(r.meta.fixtures).toBe('excluded');
  });

  it('requires a bounded window', async () => {
    const { svc } = service();
    const a = actor(AppRole.MINISTRY_OFFICER);
    await expect(svc.funnel(a, { from: '2026-04-01', to: '2026-04-01' })).rejects.toThrow(AppError);
    await expect(svc.funnel(a, { from: '2025-01-01', to: '2026-04-01' })).rejects.toThrow(AppError);
  });

  it('includes fixtures only for SUPER_ADMIN', async () => {
    const { svc } = service();
    const withFixtures = { ...q, include_fixtures: 'true' as const };
    await expect(svc.funnel(actor(AppRole.MINISTRY_OFFICER), withFixtures)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const r = await svc.funnel(actor(AppRole.SUPER_ADMIN), withFixtures);
    expect(r.meta.fixtures).toBe('included');
  });

  it('logs query parameters only', async () => {
    const { svc, logger } = service();
    await svc.funnel(actor(AppRole.MINISTRY_OFFICER), { ...q, scheme: 'NFST' });
    expect(logger.info).toHaveBeenCalledWith(
      { view: 'funnel', from: q.from, to: q.to, scheme: 'NFST', fixtures: false },
      'analytics query',
    );
  });
});
