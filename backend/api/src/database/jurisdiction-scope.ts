import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';

type Where = Record<string, unknown>;

/**
 * The application-layer mirror of the RLS policies on applications:
 *   - applicant: only applications whose applicant row belongs to them;
 *   - officer with jurisdiction_state NULL: national scope, no filter;
 *   - officer with a state and NULL district: that state;
 *   - officer with state and district: that state AND district;
 *   - every officer additionally sees applications assigned to them.
 * Returns null when no application-layer filter applies (national officers,
 * or no actor - in which case RLS alone decides and fails closed).
 */
export function applicationScopeFor(actor: Actor | undefined): Prisma.ApplicationWhereInput | null {
  if (!actor) return null;

  if (actor.role === AppRole.APPLICANT) {
    return { applicant: { user_id: actor.accountId } };
  }

  if (actor.jurisdictionState === null) return null;

  const territorial: Prisma.ApplicationWhereInput =
    actor.jurisdictionDistrict === null
      ? { jurisdiction_state: actor.jurisdictionState }
      : {
          jurisdiction_state: actor.jurisdictionState,
          jurisdiction_district: actor.jurisdictionDistrict,
        };

  return actor.officerId
    ? { OR: [territorial, { assigned_officer_id: actor.officerId }] }
    : territorial;
}

/**
 * Every model whose rows belong to an application, with how to reach the
 * owning application from it. Keys are Prisma model names.
 */
export const APPLICATION_SCOPED_MODELS: Readonly<
  Record<string, (scope: Prisma.ApplicationWhereInput) => Where>
> = {
  Application: (scope) => scope,
  Document: (scope) => ({ application: scope }),
  DocumentExtraction: (scope) => ({ document: { application: scope } }),
  DecisionRecord: (scope) => ({ application: scope }),
  Deficiency: (scope) => ({ application: scope }),
  WorkflowTransition: (scope) => ({ application: scope }),
  Score: (scope) => ({ application: scope }),
  Selection: (scope) => ({ application: scope }),
  Disbursement: (scope) => ({ application: scope }),
  Renewal: (scope) => ({ parent_application: scope }),
  // Phase 9: application-owned rows (RLS policies of the same shape).
  SanctionOrder: (scope) => ({ application: scope }),
  Grievance: (scope) => ({ application: scope }),
};

/** Operations that take a `where` the scope must be merged into. */
export const SCOPED_OPERATIONS: ReadonlySet<string> = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * AND-merges `scope` into `where` while keeping unique fields at the top
 * level, so it is valid for WhereUniqueInput (findUnique/update/delete) as
 * well as WhereInput.
 */
export function withScope(where: Where | undefined, scope: Where): Where {
  if (!where) return { AND: [scope] };
  const existing = where.AND;
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...where, AND: [...(and as unknown[]), scope] };
}
