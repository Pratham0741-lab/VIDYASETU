import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from '../../auth/actor';
import type { DbClient } from '../../database/db-client';

export interface RequestContextStore {
  requestId: string;
  /** Authenticated caller; set only inside an actor transaction. */
  actor?: Actor;
  /**
   * The request's interactive-transaction client, on which app.actor_id /
   * app.actor_role were set with set_config(..., true). Present for the whole
   * handler of an authenticated request; absent for public routes.
   */
  db?: DbClient;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Per-request context propagated through async calls, so code with no access
 * to the Request object (e.g. MlClientService, DbContext, the jurisdiction
 * query extension) can read the request ID, the actor and the transaction.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  current(): RequestContextStore | undefined {
    return storage.getStore();
  },

  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  actor(): Actor | undefined {
    return storage.getStore()?.actor;
  },

  db(): DbClient | undefined {
    return storage.getStore()?.db;
  },
};
