import { Injectable } from '@nestjs/common';
import type { Actor } from '../auth/actor';
import { RequestContext } from '../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';

/** Upper bound for waiting on a pooled connection to start the transaction. */
export const ACTOR_TX_MAX_WAIT_MS = 5_000;
/** Upper bound for a whole authenticated request's database work. */
export const ACTOR_TX_TIMEOUT_MS = 15_000;

/**
 * Runs one authenticated request's database work inside a single Prisma
 * interactive transaction on one pooled connection:
 *
 *   1. set_config('app.actor_id' / 'app.actor_role' / 'app.request_ip', v, true)
 *      is the first statement. The third argument `true` makes each setting
 *      transaction-local, exactly like SET LOCAL, but unlike SET LOCAL it
 *      accepts bind parameters, so no value is ever interpolated into SQL.
 *   2. The transaction client and the actor are stored in RequestContext
 *      (AsyncLocalStorage) for the rest of the request, so every
 *      DbContext.client call in the handler's async call tree uses this same
 *      connection, where the settings are visible.
 *   3. Commit or rollback ends the transaction and PostgreSQL discards the
 *      settings, so the connection returns to the pool without an identity.
 */
@Injectable()
export class ActorTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(actor: Actor, requestIp: string | null, work: () => Promise<T>): Promise<T> {
    const parent = RequestContext.current();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.actor_id', ${actor.accountId}, true),
          set_config('app.actor_role', ${actor.role}, true),
          set_config('app.request_ip', ${requestIp ?? ''}, true)`;

        return RequestContext.run(
          { requestId: parent?.requestId ?? '', ...parent, actor, db: tx },
          work,
        );
      },
      { maxWait: ACTOR_TX_MAX_WAIT_MS, timeout: ACTOR_TX_TIMEOUT_MS },
    );
  }
}
