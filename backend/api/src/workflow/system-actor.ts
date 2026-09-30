import { Injectable } from '@nestjs/common';
import { RequestContext } from '../common/context/request-context';
import { DbContext } from '../database/db-context';
import { SYSTEM } from './vidyasetu-workflow';

/**
 * Runs part of an actor transaction as the SYSTEM actor.
 *
 * Built on the Phase 2 mechanism, not a replacement for it: the same
 * transaction-local settings, set with the same set_config(..., true), on
 * the request's own transaction. For the duration of `work`:
 *   app.actor_id   = ''        (read back as NULL everywhere)
 *   app.actor_role = 'SYSTEM'
 * then the request's actor is restored. Every row written meanwhile is
 * attributed the way Phase 1/2 already attribute actorless writes: the audit
 * trigger records actor_user_id NULL and actor_type NULL ("no actor: system")
 * and actor_role 'SYSTEM'; rule_evaluations defaults give
 * evaluated_by_account_id NULL and evaluated_by_role 'SYSTEM'.
 * app.request_ip is left as is: the request that caused the decision.
 *
 * If `work` throws, the actor is not restored, but the error aborts the whole
 * transaction, which discards the settings anyway.
 */
@Injectable()
export class SystemActor {
  constructor(private readonly db: DbContext) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    const actor = RequestContext.actor();
    if (!this.db.inActorTransaction || !actor) {
      throw new Error('SystemActor.run requires an actor transaction');
    }
    const client = this.db.client;
    await client.$queryRaw`SELECT
      set_config('app.actor_id', '', true),
      set_config('app.actor_role', ${SYSTEM}, true)`;
    const result = await work();
    await client.$queryRaw`SELECT
      set_config('app.actor_id', ${actor.accountId}, true),
      set_config('app.actor_role', ${actor.role}, true)`;
    return result;
  }
}
