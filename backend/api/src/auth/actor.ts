import type { AppRole } from './roles';

/**
 * The authenticated caller, derived from a verified access token.
 * accountId is what the database knows as the acting user id: it is written
 * to app.actor_id, which the RLS policies compare with officers.user_id /
 * applicants.user_id and the audit trigger stores as actor_user_id.
 */
export interface Actor {
  accountId: string;
  role: AppRole;
  /** officers.id for officer roles, else null. */
  officerId: string | null;
  /** null for officers with national scope (and for applicants). */
  jurisdictionState: string | null;
  jurisdictionDistrict: string | null;
}

/** Access-token claims (snake_case on the wire). */
export interface AccessTokenClaims {
  sub: string;
  role: AppRole;
  officer_id: string | null;
  jurisdiction_state: string | null;
  jurisdiction_district: string | null;
}

export function actorFromClaims(claims: AccessTokenClaims): Actor {
  return {
    accountId: claims.sub,
    role: claims.role,
    officerId: claims.officer_id,
    jurisdictionState: claims.jurisdiction_state,
    jurisdictionDistrict: claims.jurisdiction_district,
  };
}
