/**
 * The application roles (eight since Phase 13B: COMMITTEE and AUDITOR).
 *
 * Officer roles are the rows of the `roles` table (names from the Role model
 * and seeded by scripts/seed-roles.ts). APPLICANT is implicit: an account
 * with an applicants row and no officers row. It is never stored in `roles`.
 */
export const AppRole = {
  APPLICANT: 'APPLICANT',
  SUPER_ADMIN: 'SUPER_ADMIN',
  MINISTRY_OFFICER: 'MINISTRY_OFFICER',
  STATE_NODAL_OFFICER: 'STATE_NODAL_OFFICER',
  DISTRICT_NODAL_OFFICER: 'DISTRICT_NODAL_OFFICER',
  INSTITUTE_NODAL_OFFICER: 'INSTITUTE_NODAL_OFFICER',
  /** Selection committee member: reads provisional lists, score breakdowns and objections in its scope. */
  COMMITTEE: 'COMMITTEE',
  /** Read-only oversight: audit verification, analytics, applications and flags in its scope. Never writes. */
  AUDITOR: 'AUDITOR',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];

export const ALL_ROLES: readonly AppRole[] = Object.values(AppRole);

/** Roles stored in the `roles` table (everything except APPLICANT). */
export const OFFICER_ROLES: readonly AppRole[] = ALL_ROLES.filter((r) => r !== AppRole.APPLICANT);

/** Officer roles that review applications (SUPER_ADMIN administers, it does not review). */
export const REVIEWER_ROLES: readonly AppRole[] = [
  AppRole.MINISTRY_OFFICER,
  AppRole.STATE_NODAL_OFFICER,
  AppRole.DISTRICT_NODAL_OFFICER,
  AppRole.INSTITUTE_NODAL_OFFICER,
];

/**
 * Roles POST /admin/officers may provision. SUPER_ADMIN is deliberately
 * excluded: it is only created by scripts/create-super-admin.ts.
 */
export const PROVISIONABLE_ROLES: readonly AppRole[] = [
  ...REVIEWER_ROLES,
  AppRole.COMMITTEE,
  AppRole.AUDITOR,
];

/** Every role except AUDITOR: for routes that change state but are open to all users. */
export const ALL_WRITING_ROLES: readonly AppRole[] = ALL_ROLES.filter((r) => r !== AppRole.AUDITOR);

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (ALL_ROLES as readonly string[]).includes(value);
}
