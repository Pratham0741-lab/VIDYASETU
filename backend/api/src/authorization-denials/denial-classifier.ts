import { AppError } from '../common/errors/app-error';
import { DOCUMENT_ACCESS_ROUTES } from '../documents/document-access-routes';
import { ErrorCode } from '../common/errors/error-code.enum';
import { REDACTED_VALUE } from '../schemes/redaction';
import { referencesSensitiveField, SENSITIVE_PROFILE_KEYS } from '../schemes/sensitive-fields';

/**
 * Which refusals are recorded in authorization_denials, decided from the
 * error alone - never by the code that threw it. Adding a new guard or a new
 * FORBIDDEN refusal anywhere is covered automatically.
 *
 * Recorded:
 *   - every FORBIDDEN AppError (an authenticated actor refused: RolesGuard,
 *     the workflow engine's principal check, missing officer / applicant
 *     profile, and any future FORBIDDEN);
 *   - the enumerated CONFLICT policy refusals of consequential actions
 *     (Phase 4 engine stage / guard rejections, Phase 9 objection window,
 *     post-selection and document lifecycle actions attempted out of order);
 *   - a forward action held by a HIGH fraud flag (FRAUD_REVIEW_PENDING, Phase 11);
 *   - a failed SYSTEM-actor guard in workflow_system_transition() or
 *     document_system_flag_application() (a PostgreSQL RAISE, however it
 *     surfaces - raw driver error or wrapped in an AppError);
 *   - Phase 17 (M32): a write refused by the database because the actor is
 *     the read-only AUDITOR (refuse_auditor_writes(), same detection);
 *   - Phase 17 (Part E): a NOT_FOUND on a document view / download / crop
 *     route (DOCUMENT_ACCESS_ROUTES) - DOCUMENT_NOT_ACCESSIBLE. The caller
 *     still sees only 404; everywhere else NOT_FOUND stays unrecorded.
 * Not recorded: authentication failures (UNAUTHORIZED), validation errors,
 * rate limiting, NOT_FOUND (incl. RLS / jurisdiction-scope empty results,
 * deliberately indistinguishable from nonexistent), duplicate / concurrency
 * conflicts, configuration faults and 5xx.
 */

/** FORBIDDEN details.reason -> denial_reason. Unlisted FORBIDDEN reasons -> FORBIDDEN. */
const FORBIDDEN_REASONS: Readonly<Record<string, string>> = {
  role_not_permitted: 'WRONG_ROLE', // RolesGuard
  no_role_policy: 'NO_ROLE_POLICY', // RolesGuard (route without @Roles: fails closed)
  principal_not_permitted: 'WRONG_ROLE', // Phase 4 engine
  no_officer_profile: 'NO_OFFICER_PROFILE',
  no_applicant_profile: 'NO_APPLICANT_PROFILE',
};

/** CONFLICT details.reason values that are refused consequential actions. */
const CONFLICT_REASONS: Readonly<Record<string, string>> = {
  // Phase 4 workflow engine
  transition_not_allowed: 'WRONG_STAGE',
  terminal_state: 'WRONG_STAGE',
  guard_rejected: 'GUARD_REJECTED',
  no_return_target: 'NO_RETURN_TARGET',
  // Phase 9 selection confirmation
  objection_window_open: 'OBJECTION_WINDOW_OPEN',
  // Post-selection / document lifecycle: the action attempted out of order
  not_provisional: 'WRONG_STAGE',
  selection_not_confirmed: 'WRONG_STAGE',
  no_sanction_order: 'WRONG_STAGE',
  not_pending: 'WRONG_STAGE',
  not_processing: 'WRONG_STAGE',
  no_confirmed_selection: 'WRONG_STAGE',
  not_endorsed: 'WRONG_STAGE',
  continuation_not_passed: 'WRONG_STAGE',
  scheme_not_renewable: 'WRONG_STAGE',
  grievance_status: 'WRONG_STAGE',
  not_a_non_selection: 'WRONG_STAGE',
  not_awaiting_review: 'WRONG_STAGE',
  application_closed: 'WRONG_STAGE',
};

/**
 * The SECURITY DEFINER functions guarded to the SYSTEM actor (Phases 4 and 7).
 * Their RAISE texts are fixed by applied migrations, which never change.
 */
export const SYSTEM_GUARDED_FUNCTIONS = [
  'workflow_system_transition',
  'document_system_flag_application',
] as const;
const SYSTEM_GUARD =
  /\b(workflow_system_transition|document_system_flag_application) may only run as the SYSTEM actor\b/;

export interface DenialDescriptor {
  action_attempted: string;
  subject_type: string | null;
  subject_id: string | null;
  denial_reason: string;
  /** Redacted before it leaves this module. */
  details: Record<string, unknown>;
}

/** Where the refusal happened: an HTTP route or a background job. */
export type DenialOrigin =
  | {
      kind: 'http';
      method: string;
      /** Route pattern, e.g. /api/v1/selections/:id/confirm (never the raw URL). */
      route: string | null;
      params: Readonly<Record<string, string>>;
    }
  | {
      kind: 'job';
      queue: string;
      jobId: string | null;
      attempt: number | null;
      subjectType: string | null;
      subjectId: string | null;
    };

export function classifyDenial(exception: unknown, origin: DenialOrigin): DenialDescriptor | null {
  const readOnly = auditorWriteRefusal(exception);
  if (readOnly) {
    return build(origin, actionOf(origin), subjectOf(origin), 'AUDITOR_READ_ONLY', {
      table: readOnly,
      guard: 'the AUDITOR role is read-only in the database',
    });
  }

  const guardFn = systemGuardFunction(exception);
  if (guardFn) {
    const subject = subjectOf(origin);
    return build(origin, `db.${guardFn}`, subject, 'SYSTEM_ACTOR_GUARD_FAILED', {
      function: guardFn,
      guard: 'app.actor_role must be SYSTEM with no app.actor_id',
    });
  }

  if (!(exception instanceof AppError)) return null;
  const details = isRecord(exception.details) ? exception.details : {};
  const reason = typeof details.reason === 'string' ? details.reason : null;

  let code: string | null = null;
  if (exception.code === ErrorCode.FRAUD_REVIEW_PENDING) {
    code = 'FRAUD_REVIEW_PENDING'; // Phase 11: a forward action held by a HIGH fraud flag
  } else if (exception.code === ErrorCode.FORBIDDEN) {
    code = (reason && FORBIDDEN_REASONS[reason]) ?? 'FORBIDDEN';
  } else if (exception.code === ErrorCode.CONFLICT && reason && CONFLICT_REASONS[reason]) {
    code = CONFLICT_REASONS[reason];
  } else if (
    exception.code === ErrorCode.NOT_FOUND &&
    origin.kind === 'http' &&
    DOCUMENT_ACCESS_ROUTES.has(`${origin.method} ${origin.route}`)
  ) {
    code = 'DOCUMENT_NOT_ACCESSIBLE';
  }
  if (!code) return null;

  return build(origin, actionOf(origin), subjectOf(origin), code, {
    error_code: exception.code,
    ...details,
  });
}

function build(
  origin: DenialOrigin,
  action: string,
  subject: { type: string | null; id: string | null },
  denialReason: string,
  details: Record<string, unknown>,
): DenialDescriptor {
  const where =
    origin.kind === 'http'
      ? { origin: 'http', method: origin.method, route: origin.route, params: { ...origin.params } }
      : { origin: 'job', queue: origin.queue, job_id: origin.jobId, attempt: origin.attempt };
  return {
    action_attempted: action,
    subject_type: subject.type,
    subject_id: subject.id,
    denial_reason: denialReason,
    details: redactDenialDetails({ ...details, ...where }) as Record<string, unknown>,
  };
}

function actionOf(origin: DenialOrigin): string {
  return origin.kind === 'http'
    ? `${origin.method} ${origin.route ?? '(unmatched route)'}`
    : `job.${origin.queue}`;
}

/**
 * The subject of an HTTP action: the resource named just before the route's
 * first path parameter (/applications/:id/verify -> application, :id);
 * /sanction-orders/:id -> sanction_order. No parameter -> no subject.
 */
export function subjectOf(origin: DenialOrigin): { type: string | null; id: string | null } {
  if (origin.kind === 'job') return { type: origin.subjectType, id: origin.subjectId };
  if (!origin.route) return { type: null, id: null };
  const segments = origin.route.split('/').filter(Boolean);
  const at = segments.findIndex((s) => s.startsWith(':'));
  if (at < 1) return { type: null, id: null };
  const id = origin.params[segments[at].slice(1)] ?? null;
  const resource = segments[at - 1].toLowerCase().replace(/-/g, '_');
  const type = resource.endsWith('ies')
    ? `${resource.slice(0, -3)}y`
    : resource.endsWith('s')
      ? resource.slice(0, -1)
      : resource;
  return { type: /^[a-z][a-z0-9_]{0,39}$/.test(type) ? type : null, id };
}

/** Name of the SYSTEM-guarded function whose guard raised, anywhere in the error / cause chain. */
export function systemGuardFunction(exception: unknown): string | null {
  let current: unknown = exception;
  for (let depth = 0; depth < 6 && current; depth++) {
    for (const text of textsOf(current)) {
      const m = SYSTEM_GUARD.exec(text);
      if (m) return m[1];
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

const AUDITOR_READ_ONLY = /\bAUDITOR_READ_ONLY: the AUDITOR role cannot [A-Z]+ ([a-z_][a-z0-9_]*)/;

/** The table named by a refuse_auditor_writes() RAISE, anywhere in the error / cause chain. */
export function auditorWriteRefusal(exception: unknown): string | null {
  let current: unknown = exception;
  for (let depth = 0; depth < 6 && current; depth++) {
    for (const text of textsOf(current)) {
      const m = AUDITOR_READ_ONLY.exec(text);
      if (m) return m[1];
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function textsOf(err: unknown): string[] {
  if (typeof err === 'string') return [err];
  if (!isRecord(err)) return [];
  const out: string[] = [];
  if (typeof err.message === 'string') out.push(err.message);
  const meta = err.meta;
  if (isRecord(meta) && typeof meta.message === 'string') out.push(meta.message);
  return out;
}

/**
 * Phase 3's redaction, applied to denial details before they are persisted:
 * a value under any SENSITIVE_PROFILE_KEYS key, and any text referencing a
 * sensitive applicant.* path, becomes REDACTED_VALUE ({ redacted: true }) -
 * the same key list and the same substitution rule_evaluations use.
 */
export function redactDenialDetails(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED_VALUE;
  if (typeof value === 'string') {
    return referencesSensitiveField(value) ? REDACTED_VALUE : value;
  }
  if (Array.isArray(value)) return value.map((v) => redactDenialDetails(v, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_PROFILE_KEYS.has(k) ? REDACTED_VALUE : redactDenialDetails(v, depth + 1);
    }
    return out;
  }
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
