import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

const counts = {
  notifications: { eligible: 2, protected: 1, deleted: 0 },
  refresh_tokens: { eligible: 3, protected: 0, deleted: 0 },
  application_drafts: { eligible: 1, protected: 0, deleted: 0 },
};

function service(enabled = false) {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join('?'), values });
      return Promise.resolve([{ run_id: 'r1', policy: {}, counts }]);
    },
  };
  const config = {
    retention: {
      enabled,
      dryRun: true,
      intervalMs: 86_400_000,
      notificationsDays: 365,
      refreshTokensDays: 30,
      draftsDays: 180,
    },
  };
  const systemTx = { run: (_id: string, work: () => Promise<unknown>) => work() };
  const logs: unknown[] = [];
  const logger = { info: (o: unknown) => logs.push(o), warn: () => {}, error: () => {} };
  const svc = new RetentionService(
    config as never,
    {} as never,
    systemTx as never,
    { client } as never,
    logger as never,
  );
  return { svc, queries, logs };
}

describe('RetentionService (Phase 17, Part C)', () => {
  it('calls retention_apply as SYSTEM with the configured days, and logs counts only', async () => {
    const { svc, queries, logs } = service();
    const r = await svc.run('MANUAL', true, 'acc-1', new Date('2027-01-01T00:00:00Z'));
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('retention_apply(');
    expect(queries[0].values).toEqual([
      new Date('2027-01-01T00:00:00Z'),
      true,
      365,
      30,
      180,
      'MANUAL',
      'acc-1',
    ]);
    expect(r).toMatchObject({ retention_run_id: 'r1', dry_run: true, counts });
    expect(JSON.stringify(logs)).not.toMatch(/acc-1/);
  });

  it('schedules nothing when RETENTION_ENABLED is false (the default)', async () => {
    const { svc } = service(false);
    await svc.onApplicationBootstrap();
    expect((svc as unknown as { queue: unknown }).queue).toBeNull();
  });

  it('a manual run is a dry run unless dry_run is false', async () => {
    const calls: unknown[][] = [];
    const ctl = new RetentionController({
      run: (...a: unknown[]) => {
        calls.push(a);
        return Promise.resolve({});
      },
    } as never);
    const actor = { accountId: 'sa', role: AppRole.SUPER_ADMIN } as Actor;
    await ctl.run(actor, {});
    await ctl.run(actor, { dry_run: false });
    expect(calls).toEqual([
      ['MANUAL', true, 'sa'],
      ['MANUAL', false, 'sa'],
    ]);
  });
});
