import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { requestIdOf } from '../common/middleware/request-id.middleware';
import { actorCoversApplication, FraudDetectionService } from './fraud-detection.service';

/**
 * Forward actions a HIGH fraud flag holds (route pattern -> what :id names).
 * Only forward moves: reject and mark-defective stay available, so an officer
 * can always act on a confirmed fraud.
 */
export const HELD_ROUTES: Readonly<Record<string, 'application' | 'disbursement'>> = {
  'POST /api/v1/applications/:id/verify': 'application',
  'POST /api/v1/disbursements/:id/initiate': 'disbursement',
};

/**
 * Global guard (after JwtAuthGuard and RolesGuard): on a held route it re-runs
 * detection for the application - so a flag can never be missed because an
 * at-most-once event was lost - and refuses FRAUD_REVIEW_PENDING (409) while
 * a HIGH flag is OPEN, NEEDS_MORE_INFO or CONFIRMED. Phase 4's engine and
 * Phase 9's disbursement code are untouched: the guard stands in front of them.
 *
 * Out of the caller's jurisdiction, it does nothing and lets the handler
 * answer 404 as usual (no flag existence leaks). If detection itself fails,
 * the action fails closed (the error propagates) rather than proceeding unchecked.
 */
@Injectable()
export class FraudHoldGuard implements CanActivate {
  constructor(private readonly fraud: FraudDetectionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const route = (req as { route?: { path?: unknown } }).route?.path;
    if (typeof route !== 'string') return true;
    const kind = HELD_ROUTES[`${req.method} ${req.baseUrl ?? ''}${route}`];
    const id = req.params?.id;
    if (!kind || !req.actor || typeof id !== 'string') return true;
    // Runs before the route's ParseUUIDPipe: a malformed id is the pipe's 400, not ours.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;

    const requestId = requestIdOf(req);
    const app = await this.fraud.facts(
      kind === 'application' ? { applicationId: id } : { disbursementId: id },
      requestId,
    );
    if (!app || !actorCoversApplication(req.actor, app)) return true;

    await this.fraud.runForApplication(app.application_id, requestId);
    const holding = await this.fraud.holdingFlags(app.application_id, requestId);
    if (holding.length > 0) {
      throw new AppError(ErrorCode.FRAUD_REVIEW_PENDING, {
        details: {
          reason: 'fraud_review_pending',
          application_id: app.application_id,
          flag_ids: holding.map((f) => f.id),
          flag_types: [...new Set(holding.map((f) => f.flag_type))],
          release:
            'an officer marks each HIGH flag FALSE_POSITIVE (POST /api/v1/fraud-flags/:id/disposition)',
        },
      });
    }
    return true;
  }
}
