import { Injectable, UseGuards, applyDecorators } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

/**
 * Phase 17 (F1): per-account rate limits on the expensive or bulk routes -
 * exports, uploads, bulk actions and list / filter ("search") endpoints.
 * Counted per authenticated account (the global auth guard has already set
 * req.actor), else per client IP, and per route. Uses the one throttler the
 * auth module registers ('auth'), with these limits per route; in-memory, like
 * the login limit (see AuthModule for the multi-instance caveat).
 */
export const RATE_LIMITS = {
  /** Analytics / fairness CSV, XLSX and PDF exports. */
  EXPORT: { limit: 20, ttl: 60_000 },
  /** An applicant's own data export. */
  DATA_EXPORT: { limit: 5, ttl: 60_000 },
  /** Document uploads. */
  UPLOAD: { limit: 30, ttl: 60_000 },
  /** Bulk queue actions. */
  BULK: { limit: 10, ttl: 60_000 },
  /** Application lists and the review queue (filters). */
  SEARCH: { limit: 60, ttl: 60_000 },
  /** Phase 17.2: a stored document's bytes (GET /documents/:id/file). */
  FILE: { limit: 60, ttl: 60_000 },
  /** Phase 17.2: portal detail reads (application history, list objections). */
  READ: { limit: 120, ttl: 60_000 },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

@Injectable()
export class ActorThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const actor = req.actor as { accountId?: string } | undefined;
    const ip = typeof req.ip === 'string' ? req.ip : 'unknown';
    return Promise.resolve(actor?.accountId ? `account:${actor.accountId}` : `ip:${ip}`);
  }
}

/** Applies the named per-account limit to one route (429 TOO_MANY_REQUESTS beyond it). */
export const RateLimit = (kind: RateLimitKind) =>
  applyDecorators(UseGuards(ActorThrottlerGuard), Throttle({ auth: RATE_LIMITS[kind] }));
