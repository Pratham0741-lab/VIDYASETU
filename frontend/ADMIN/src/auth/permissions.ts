/**
 * Role-based navigation and actions: the one table the portal uses.
 *
 * Each entry mirrors the @Roles(...) of the backend route it depends on
 * (backend/api/src, read only). The backend stays the authority: it answers
 * 403 for a role that may not act (and 409 when the application or list is
 * in the wrong state), and the UI shows that message. This table only hides
 * what a role can never use.
 *
 *   module     routes it needs                                     roles
 *   scrutiny   GET /applications/queue, verify, reject, ...        MINISTRY, SNO, DNO, INO
 *   fraud      GET /applications + fraud-flags (jurisdiction scan),  MINISTRY, SNO, DNO, INO, AUDITOR (read)
 *              queue?fraud=HIGH, fraud-checks, disposition,        MINISTRY, SNO, DNO, INO
 *              GET /analytics/fraud
 *   selection  GET /selection-lists (+ :id)                        COMMITTEE, MINISTRY, SNO, DNO, INO, AUDITOR
 *   audit      GET /audit/verify                                   SUPER_ADMIN, AUDITOR
 *              GET /authorization-denials, /document-access        MINISTRY, SUPER_ADMIN, SNO, DNO, AUDITOR
 *   analytics  GET /analytics/funnel|sla|verification-quality      MINISTRY, SNO, DNO, INO, SUPER_ADMIN, AUDITOR
 *              GET /analytics/fairness                             the same plus COMMITTEE
 *   studio     GET /admin/schemes (+ version, diff)                MINISTRY, SUPER_ADMIN, AUDITOR (read)
 *              create, draft, edit, validate, preview, publish,    MINISTRY, SUPER_ADMIN
 *              retire
 *
 * APPLICANT never gets into the portal (AuthProvider refuses it).
 */
import type { AppRole } from '../api/responses';

export type ModuleId = 'scrutiny' | 'fraud' | 'selection' | 'audit' | 'analytics' | 'studio';
export type Permission =
  | 'module.scrutiny'
  | 'module.fraud'
  | 'module.selection'
  | 'module.audit'
  | 'module.analytics'
  | 'module.studio'
  | 'scrutiny.act'
  | 'fraud.act'
  | 'selection.committee'
  | 'selection.ministry'
  | 'audit.verify'
  | 'audit.logs'
  | 'studio.author'
  | 'studio.publish'
  | 'analytics.core'
  | 'analytics.fairness';

const REVIEWERS: AppRole[] = ['MINISTRY_OFFICER', 'STATE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'INSTITUTE_NODAL_OFFICER'];
const LOG_READERS: AppRole[] = ['MINISTRY_OFFICER', 'SUPER_ADMIN', 'STATE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'AUDITOR'];
const AUDIT_VERIFIERS: AppRole[] = ['SUPER_ADMIN', 'AUDITOR'];
// backend/api/src/analytics/analytics.controller.ts ANALYTICS_ROLES
const ANALYTICS: AppRole[] = [...REVIEWERS, 'SUPER_ADMIN', 'AUDITOR'];
// backend/api/src/fairness/fairness.controller.ts FAIRNESS_ROLES
const FAIRNESS: AppRole[] = [...ANALYTICS, 'COMMITTEE'];
// backend SCHEME_AUTHOR_ROLES and SCHEME_PUBLISHER_ROLES (both default SUPER_ADMIN,MINISTRY_OFFICER)
const STUDIO_AUTHORS: AppRole[] = ['MINISTRY_OFFICER', 'SUPER_ADMIN'];

export const PERMISSIONS: Record<Permission, readonly AppRole[]> = {
  'module.scrutiny': REVIEWERS,
  'module.fraud': [...REVIEWERS, 'AUDITOR'], // AUDITOR: read-only (GET /applications + fraud-flags + analytics/fraud)
  'module.selection': ['COMMITTEE', ...REVIEWERS, 'AUDITOR'],
  'module.audit': [...new Set([...AUDIT_VERIFIERS, ...LOG_READERS])],
  'module.analytics': FAIRNESS,
  // Stage F3-A. Reads are open to every officer role; the Studio is shown to
  // authors and, read-only, to AUDITOR.
  'module.studio': [...STUDIO_AUTHORS, 'AUDITOR'],
  'studio.author': STUDIO_AUTHORS, // create, draft, edit, validate, preview
  'studio.publish': STUDIO_AUTHORS, // publish, retire
  'scrutiny.act': REVIEWERS,
  'fraud.act': REVIEWERS,
  'selection.committee': ['COMMITTEE'], // approve, override, decide objection, close window early
  'selection.ministry': ['MINISTRY_OFFICER'], // publish provisional, close window, publish final
  'audit.verify': AUDIT_VERIFIERS,
  'audit.logs': LOG_READERS,
  'analytics.core': ANALYTICS,
  'analytics.fairness': FAIRNESS,
};

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  return !!role && PERMISSIONS[permission].includes(role);
}

/** Modules in sidebar order; a module appears only for roles that hold its permission. */
export const MODULE_ORDER: readonly ModuleId[] = ['studio', 'scrutiny', 'fraud', 'selection', 'audit', 'analytics'];

export function modulesFor(role: AppRole | null | undefined): ModuleId[] {
  return MODULE_ORDER.filter((m) => can(role, `module.${m}` as Permission));
}
