import { Injectable } from '@nestjs/common';
import { RequestContext } from '../common/context/request-context';
import { ACTOR_TX_MAX_WAIT_MS, ACTOR_TX_TIMEOUT_MS } from './actor-transaction.runner';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM } from '../workflow/vidyasetu-workflow';

/**
 * A transaction for work that no HTTP request owns (the document pipeline
 * worker), attributed to the SYSTEM actor exactly as Phase 4's gate is:
 * app.actor_id empty, app.actor_role 'SYSTEM', so the unchanged audit
 * trigger records actor_user_id NULL, actor_type NULL, actor_role 'SYSTEM'.
 *
 * A sibling of Phase 2's ActorTransactionRunner (same set_config(..., true)
 * settings, same RequestContext hand-off so DbContext.client is this
 * transaction), not a change to it. With no actor, RLS-protected tables
 * return nothing and reject writes: SYSTEM work only touches unprotected
 * tables, plus applications through document_system_flag_application().
 */
@Injectable()
export class SystemTransactionRunner {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(requestId: string, work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT
          set_config('app.actor_id', '', true),
          set_config('app.actor_role', ${SYSTEM}, true),
          set_config('app.request_ip', '', true)`;
        return RequestContext.run({ requestId, db: tx }, work);
      },
      { maxWait: ACTOR_TX_MAX_WAIT_MS, timeout: ACTOR_TX_TIMEOUT_MS },
    );
  }
}
