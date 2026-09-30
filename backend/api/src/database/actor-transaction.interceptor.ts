import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import type { Actor } from '../auth/actor';
import { ActorTransactionRunner } from './actor-transaction.runner';

type RequestWithActor = Request & { actor?: Actor };

/**
 * Global interceptor that wraps every authenticated request in one actor
 * transaction (see ActorTransactionRunner).
 *
 * Why an interceptor: it runs after the auth and roles guards, so rejected
 * requests never open a transaction, and it wraps the whole handler
 * (pipes + handler + its async completion), so the transaction commits only
 * after the handler finishes and rolls back if it throws. Middleware runs
 * before guards and cannot see route metadata; a guard cannot wrap execution.
 *
 * Public routes (health, login, register, refresh, logout) have no actor, so
 * no transaction is opened for them.
 */
@Injectable()
export class ActorTransactionInterceptor implements NestInterceptor {
  constructor(private readonly runner: ActorTransactionRunner) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = req.actor;
    if (!actor) return next.handle();

    const requestIp = req.ip ?? req.socket?.remoteAddress ?? null;
    return from(
      this.runner.run(actor, requestIp, () =>
        lastValueFrom(next.handle(), { defaultValue: undefined }),
      ),
    );
  }
}
