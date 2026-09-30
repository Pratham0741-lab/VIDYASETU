import { Prisma } from '@prisma/client';
import { RequestContext } from '../common/context/request-context';
import {
  APPLICATION_SCOPED_MODELS,
  applicationScopeFor,
  SCOPED_OPERATIONS,
  withScope,
} from './jurisdiction-scope';

/**
 * Applies the caller's jurisdiction to every read/update/delete on
 * Application and its child models, for every query made through
 * PrismaService or a transaction client derived from it. Services cannot
 * forget it: there is no call site to remember.
 *
 * The actor comes from RequestContext, which only holds one inside an actor
 * transaction. Without an actor no filter is added here and the RLS policies
 * (which then see no app.actor_id) return nothing.
 *
 * Limits: creates are not filtered here (the RLS WITH CHECK on the same
 * policies governs inserts), and relations read through `include`/`select`
 * from an unscoped model are not filtered by Prisma query extensions. RLS
 * covers both at the database level.
 */
export const jurisdictionScopeExtension = Prisma.defineExtension({
  name: 'jurisdictionScope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const toModelScope = APPLICATION_SCOPED_MODELS[model];
        if (toModelScope && SCOPED_OPERATIONS.has(operation)) {
          const scope = applicationScopeFor(RequestContext.actor());
          if (scope) {
            const scopedArgs = args as { where?: Record<string, unknown> };
            scopedArgs.where = withScope(scopedArgs.where, toModelScope(scope));
          }
        }
        return query(args);
      },
    },
  },
});
