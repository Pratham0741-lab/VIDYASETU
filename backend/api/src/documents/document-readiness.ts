import { CANONICAL_DOCUMENT_TYPES, canonicalTypeForSlot, isOptionalSlot } from './document-types';
import type { RuleCheck, Verification } from './document-verification';

/**
 * Pure decisions (no I/O) behind the applicant's per-row document status and
 * the "all documents in" step (DocumentsService.complete), unit-tested in
 * document-readiness.spec.ts. Built only from what the pipeline already
 * stored; nothing is re-scored here.
 */

/**
 * OCR is best-effort and never holds an application. For document types with
 * verification rules (document-verification.ts) the rules decide; for the
 * others, field confidence does:
 * - VERIFIED: every mandatory rule passed (or every field read confidently).
 * - RECEIVED_FLAGGED: received; a rule failed on a clearly read value (income
 *   above the ceiling, another category, marks below the minimum): an officer
 *   reviews it, with the compared values. Never a rejection.
 * - RECEIVED_REVIEW: received; a value could not be read (or read with low
 *   confidence), an officer verifies it (the values that were read are shown).
 * - RECEIVED_MANUAL: received; nothing could be read, an officer checks it by hand.
 * - NEEDS_ATTENTION: only a file unusable as a file (blank, corrupt, unreadable
 *   PDF): the one case the applicant is asked to upload again.
 */
export type SlotOutcome =
  | 'MISSING'
  | 'SCANNING'
  | 'VERIFIED'
  | 'RECEIVED_FLAGGED'
  | 'RECEIVED_REVIEW'
  | 'RECEIVED_MANUAL'
  | 'NEEDS_ATTENTION';

/** Outcomes an officer settles; the application moves on with them. */
export const OFFICER_CHECK_OUTCOMES: ReadonlySet<SlotOutcome> = new Set([
  'RECEIVED_FLAGGED',
  'RECEIVED_REVIEW',
  'RECEIVED_MANUAL',
]);

/** Why a document is not verified. Codes only: the portal words them (i18n). */
export type AttentionReason =
  | { code: 'quality'; issues: string[] }
  | { code: 'unreadable' }
  | { code: 'not_read' }
  | { code: 'missing_fields'; fields: string[] }
  | { code: 'wrong_type'; detected: string | null }
  | { code: 'type_uncertain' }
  | { code: 'manual_check' }
  | { code: 'low_confidence'; fields: string[] }
  | { code: 'profile_mismatch'; fields: string[] }
  | {
      code: 'rule_failed';
      rule: string;
      field: string;
      extracted: string | number | null;
      expected: string | number | null;
    };

/** The parts of a document view (DocumentsService.view) the decision reads. */
export interface DocumentViewLike {
  state: string;
  quality: { issues: string[]; warnings?: string[] } | null;
  extraction: {
    status: string;
    classification: {
      type: string | null;
      confidence: number | null;
      matches_slot: boolean | null;
    };
    review_status: string | null;
    review_threshold: number | null;
    fields: Array<{ name: string; value?: unknown; review: string | null }>;
    eligibility_mismatches: unknown;
    processed_at: string;
  } | null;
}

export interface SlotResult {
  outcome: SlotOutcome;
  reasons: AttentionReason[];
  /** Fields an officer must check (not read, or read with low confidence). */
  review_fields?: string[];
  /** Rule results with the compared values (rule-verified document types only). */
  checks?: RuleCheck[];
  /** Failed rules, for the officer's scrutiny ("income_ceiling", "category_match"). */
  flags?: string[];
}

/** The rule verdict -> the row's outcome. Officer confirmation settles it. */
function fromVerification(
  ext: NonNullable<DocumentViewLike['extraction']>,
  verification: Verification,
): SlotResult {
  const checks = verification.checks;
  if (ext.review_status === 'OFFICER_CONFIRMED' || verification.result === 'VERIFIED') {
    return { outcome: 'VERIFIED', reasons: [], checks };
  }
  if (verification.result === 'FLAGGED') {
    const failed = checks.filter((c) => c.status === 'FAIL');
    return {
      outcome: 'RECEIVED_FLAGGED',
      reasons: failed.map((c) => ({
        code: 'rule_failed' as const,
        rule: c.rule,
        field: c.field,
        extracted: c.extracted,
        expected: c.expected,
      })),
      review_fields: [...new Set(failed.map((c) => c.field))].sort(),
      checks,
      flags: failed.map((c) => c.rule),
    };
  }
  const unread = checks.filter(
    (c) => c.mandatory && (c.status === 'NOT_READ' || c.status === 'UNAVAILABLE'),
  );
  const nothingRead = ext.fields.length > 0 && ext.fields.every((f) => !isRead(f.value));
  const fields = [...new Set(unread.map((c) => c.field))].sort();
  return {
    outcome: nothingRead ? 'RECEIVED_MANUAL' : 'RECEIVED_REVIEW',
    reasons: nothingRead ? [{ code: 'not_read' }] : [{ code: 'missing_fields', fields }],
    review_fields: nothingRead ? ext.fields.map((f) => f.name) : fields,
    checks,
  };
}

/** The ml service returns every field of the type, null when it read nothing. */
function isRead(value: unknown): boolean {
  return value !== null && value !== '';
}

function mismatchFields(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((m) => (m && typeof m === 'object' ? (m as { field?: unknown }).field : undefined))
        .filter((f): f is string => typeof f === 'string')
    : [];
}

/**
 * Stages an officer reaches only by verifying the application onward from the
 * institute (VIDYASETU_WORKFLOW): the documents have been accepted by then.
 */
const OFFICER_ACCEPTED_STAGES: ReadonlySet<string> = new Set([
  'DNO_VERIFIED',
  'SNO_VERIFIED',
  'MINISTRY_APPROVED',
  'DISBURSED',
]);

export function officerAccepted(stage: string): boolean {
  return OFFICER_ACCEPTED_STAGES.has(stage);
}

/**
 * The result shown on one checklist row, from the slot's latest document (null: none).
 * accepted: the application has been verified onward by an officer, which settles
 * what the automatic check left to an officer (not an unusable file).
 * verification: the document type's rule verdict (document-verification.ts);
 * null for types without rules, which keep the confidence-based review.
 */
export function slotResult(
  slot: string,
  doc: DocumentViewLike | null,
  accepted = false,
  verification: Verification | null = null,
): SlotResult {
  if (!doc) return { outcome: 'MISSING', reasons: [] };
  // Only a file that cannot be read as a file (blank page, corrupt, unusable
  // PDF) reaches QUALITY_REJECTED; blur, crop and low resolution never do.
  if (doc.state === 'QUALITY_REJECTED') {
    return {
      outcome: 'NEEDS_ATTENTION',
      reasons: [{ code: 'unreadable' }, { code: 'quality', issues: doc.quality?.issues ?? [] }],
    };
  }
  // The pipeline gave up (ml unavailable after retries): the file is stored,
  // an officer reads it.
  if (doc.state === 'FAILED') {
    return { outcome: accepted ? 'VERIFIED' : 'RECEIVED_MANUAL', reasons: [{ code: 'not_read' }] };
  }
  const ext = doc.extraction;
  if (!ext || ext.status !== 'COMPLETED') return { outcome: 'SCANNING', reasons: [] };
  if (accepted) {
    return verification
      ? { outcome: 'VERIFIED', reasons: [], checks: verification.checks }
      : { outcome: 'VERIFIED', reasons: [] };
  }
  // OCR extracts; the document type's rules decide.
  if (verification) return fromVerification(ext, verification);

  const read = ext.fields.filter((f) => isRead(f.value));
  if (ext.fields.length > 0 && read.length === 0) {
    return {
      outcome: 'RECEIVED_MANUAL',
      reasons: [{ code: 'not_read' }],
      review_fields: ext.fields.map((f) => f.name),
    };
  }

  const reasons: AttentionReason[] = [];
  const reviewFields: string[] = [];
  // An officer's confirmation settles the extraction itself.
  if (ext.review_status === 'NEEDS_REVIEW') {
    const threshold = ext.review_threshold ?? 1;
    const detected = ext.classification.type;
    if (canonicalTypeForSlot(slot) === null) reasons.push({ code: 'manual_check' });
    else if (
      ext.classification.matches_slot === false &&
      detected !== null &&
      (CANONICAL_DOCUMENT_TYPES as readonly string[]).includes(detected)
    ) {
      reasons.push({ code: 'wrong_type', detected });
    } else if (ext.classification.matches_slot === false) {
      reasons.push({ code: 'type_uncertain' });
    } else if ((ext.classification.confidence ?? 0) < threshold) {
      reasons.push({ code: 'type_uncertain' });
    }
    const missing = ext.fields.filter((f) => !isRead(f.value)).map((f) => f.name);
    const low = ext.fields
      .filter((f) => isRead(f.value) && f.review === 'NEEDS_REVIEW')
      .map((f) => f.name);
    if (missing.length > 0) reasons.push({ code: 'missing_fields', fields: missing });
    if (low.length > 0) reasons.push({ code: 'low_confidence', fields: low });
    reviewFields.push(...missing, ...low);
    if (reasons.length === 0) reasons.push({ code: 'manual_check' });
  }
  const mismatched = mismatchFields(ext.eligibility_mismatches);
  if (mismatched.length > 0) {
    reasons.push({ code: 'profile_mismatch', fields: mismatched });
    reviewFields.push(...mismatched.filter((f) => !reviewFields.includes(f)));
  }
  if (reasons.length === 0) return { outcome: 'VERIFIED', reasons };
  return { outcome: 'RECEIVED_REVIEW', reasons, review_fields: reviewFields.sort() };
}

/** How long to wait for the consistency check after the last extraction before giving up on it. */
export const CONSISTENCY_WAIT_MS = 2 * 60 * 1000;

export interface Readiness {
  /** Checklist slots that must have a document ("(if applicable)" ones may stay empty). */
  required_slots: string[];
  /** Required slots with no document yet, and any slot still being scanned. */
  pending_slots: string[];
  /** Slots whose file is unusable as a file: the only ones the applicant is asked to upload again. */
  attention_slots: string[];
  /** Slots received but not verified: an officer checks them; they never hold the application. */
  officer_review_slots: string[];
  /** Per officer-review slot, the fields to check (flagged for the scrutiny stage). */
  review_fields: Record<string, string[]>;
  /** Per flagged slot, the rules that failed on a clearly read value (for the INO). */
  flags: Record<string, string[]>;
  /** Cross-document check (names / dates of birth), when it has run. */
  consistency: string | null;
  /** Waiting for the cross-document check that the last scan started. */
  consistency_pending: boolean;
  /** Nothing left to upload or scan: the application can move on. */
  ready: boolean;
  /** ready, and every document verified and consistent with the others. */
  verified: boolean;
}

/**
 * The application-level summary. The pipeline runs the cross-document check
 * once every checklist slot has a completed extraction; if that is the case,
 * readiness waits for its result (bounded by CONSISTENCY_WAIT_MS, so a failed
 * check never holds an application forever).
 */
export function readiness(
  checklist: string[],
  results: Readonly<Record<string, SlotResult>>,
  latestProcessedAt: Readonly<Record<string, string | null>>,
  consistency: { status: string | null; checked_at: Date | null },
  now: Date,
): Readiness {
  const required = checklist.filter((s) => !isOptionalSlot(s));
  const pending = checklist.filter((s) => {
    const o = results[s]?.outcome ?? 'MISSING';
    return o === 'SCANNING' || (o === 'MISSING' && required.includes(s));
  });
  const attention = checklist.filter((s) => results[s]?.outcome === 'NEEDS_ATTENTION');
  const officerReview = checklist.filter((s) => {
    const o = results[s]?.outcome;
    return o !== undefined && OFFICER_CHECK_OUTCOMES.has(o);
  });
  const reviewFields: Record<string, string[]> = {};
  const flags: Record<string, string[]> = {};
  for (const s of officerReview) {
    reviewFields[s] = results[s]?.review_fields ?? [];
    if (results[s]?.flags?.length) flags[s] = results[s].flags!;
  }

  const processed = checklist.map((s) => latestProcessedAt[s] ?? null);
  let consistencyPending = false;
  if (processed.every((p) => p !== null)) {
    const last = Math.max(...processed.map((p) => Date.parse(p)));
    const checked = consistency.checked_at?.getTime() ?? 0;
    consistencyPending = checked < last && now.getTime() - last < CONSISTENCY_WAIT_MS;
  }
  const disagree = consistency.status === 'INCONSISTENT' || consistency.status === 'UNCERTAIN';
  const ready = pending.length === 0 && !consistencyPending;
  return {
    required_slots: required,
    pending_slots: pending,
    attention_slots: attention,
    officer_review_slots: officerReview,
    review_fields: reviewFields,
    flags,
    consistency: consistency.status,
    consistency_pending: consistencyPending,
    ready,
    verified: ready && attention.length === 0 && officerReview.length === 0 && !disagree,
  };
}
