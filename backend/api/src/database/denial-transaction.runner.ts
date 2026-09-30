import { Injectable } from '@nestjs/common';
import { RequestContext } from '../common/context/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ACTOR_TX_MAX_WAIT_MS, ACTOR_TX_TIMEOUT_MS } from './actor-transaction.runner';

/** Who the denial is attributed to: the refused actor, the SYSTEM actor, or nobody. */
export type DenialIdentity =
  | { kind: 'actor'; accountId: string; role: string }
  | { kind: 'system'; role: string }
  | { kind: 'none' };

/**
 * A fresh transaction for recording an authorization denial - independent of
 * the refused request's own transaction, which has rolled back (or, for a
 * guard rejection, was never opened).
 *
 * A sibling of Phase 2's ActorTransactionRunner and Phase 7's
 * SystemTransactionRunner (the same transaction-local
 * set_config('app.actor_id' / 'app.actor_role' / 'app.request_ip', v, true)
 * first statement, the same RequestContext hand-off), not a change to them.
 * Separate on purpose: a refused request must never open the request's actor
 * transaction (the RBAC matrix asserts exactly that); this one only records
 * the refusal, through record_authorization_denial().
 */
@Injectable()
export class DenialTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    identity: DenialIdentity,
    requestIp: string | null,
    requestId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const actorId = identity.kind === 'actor' ? identity.accountId : '';
    const role = identity.kind === 'none' ? '' : identity.role;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.actor_id', ${actorId}, true),
          set_config('app.actor_role', ${role}, true),
          set_config('app.request_ip', ${requestIp ?? ''}, true)`;
        return RequestContext.run({ requestId, db: tx }, work);
      },
      { maxWait: ACTOR_TX_MAX_WAIT_MS, timeout: ACTOR_TX_TIMEOUT_MS },
    );
  }
}
