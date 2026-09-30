import { ActorThrottlerGuard, RATE_LIMITS } from './rate-limit';

describe('per-account rate limits (Phase 17, F1)', () => {
  const guard = Object.create(ActorThrottlerGuard.prototype) as {
    getTracker(req: Record<string, unknown>): Promise<string>;
  };

  it('counts per authenticated account, else per client IP', async () => {
    await expect(guard.getTracker({ actor: { accountId: 'a1' }, ip: '10.0.0.1' })).resolves.toBe(
      'account:a1',
    );
    await expect(guard.getTracker({ ip: '10.0.0.1' })).resolves.toBe('ip:10.0.0.1');
  });

  it('has a limit for exports, data export, uploads, bulk, search, files and portal reads', () => {
    expect(Object.keys(RATE_LIMITS).sort()).toEqual([
      'BULK',
      'DATA_EXPORT',
      'EXPORT',
      'FILE',
      'READ',
      'SEARCH',
      'UPLOAD',
    ]);
    for (const l of Object.values(RATE_LIMITS)) {
      expect(l.limit).toBeGreaterThan(0);
      expect(l.ttl).toBe(60_000);
    }
  });
});
