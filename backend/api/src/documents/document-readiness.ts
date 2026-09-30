import { CANONICAL_DOCUMENT_TYPES, canonicalTypeForSlot, isOptionalSlot } from './document-types';

/**
 * Pure decisions (no I/O) behind the applicant's per-row document status and
 * the "all documents in" step (DocumentsService.complete), unit-tested in
 * document-readiness.spec.ts. Built only from what the pipeline already
 * stored; nothing is re-scored here.
 */

export type SlotOutcome = 'MISSING' | 'SCANNING' | 'VERIFIED' | 'NEEDS_ATTENTION';

/** Why a document needs attention. Codes only: the portal words them (i18n). */
export type AttentionReason =
  | { code: 'quality'; issues: string[] }
  | { code: 'unreadable' }
  | { code: 'wrong_type'; detected: string | null }
  | { code: 'type_uncertain' }
  | { code: 'manual_check' }
  | { code: 'low_confidence'; fields: string[] }
  | { code: 'profile_mismatch'; fields: string[] };

/** The parts of a document view (DocumentsService.view) the decision reads. */
export interface DocumentViewLike {
  state: string;
  quality: { issues: string[] } | null;
  extraction: {
    status: string;
    classification: {
      type: string | null;
      confidence: number | null;
      matches_slot: boolean | null;
    };
    review_status: string | null;
    review_threshold: number | null;
    fields: Array<{ name: string; review: string | null }>;
    eligibility_mismatches: unknown;
    processed_at: string;
  } | null;
}

export interface SlotResult {
  outcome: SlotOutcome;
  reasons: AttentionReason[];
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
 */
export function slotResult(
  slot: string,
  doc: DocumentViewLike | null,
  accepted = false,
): SlotResult {
  if (!doc) return { outcome: 'MISSING', reasons: [] };
  if (doc.state === 'QUALITY_REJECTED') {
    return {
      outcome: 'NEEDS_ATTENTION',
      reasons: [{ code: 'quality', issues: doc.quality?.issues ?? [] }],
    };
  }
  if (doc.state === 'FAILED')
    return { outcome: 'NEEDS_ATTENTION', reasons: [{ code: 'unreadable' }] };
  const ext = doc.extraction;
  if (!ext || ext.status !== 'COMPLETED') return { outcome: 'SCANNING', reasons: [] };
  if (accepted) return { outcome: 'VERIFIED', reasons: [] };

  const reasons: AttentionReason[] = [];
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
    const low = ext.fields.filter((f) => f.review === 'NEEDS_REVIEW').map((f) => f.name);
    if (low.length > 0) reasons.push({ code: 'low_confidence', fields: low });
    if (reasons.length === 0) reasons.push({ code: 'manual_check' });
  }
  const mismatched = mismatchFields(ext.eligibility_mismatches);
  if (mismatched.length > 0) reasons.push({ code: 'profile_mismatch', fields: mismatched });
  return { outcome: reasons.length > 0 ? 'NEEDS_ATTENTION' : 'VERIFIED', reasons };
}

/** How long to wait for the consistency check after the last extraction before giving up on it. */
export const CONSISTENCY_WAIT_MS = 2 * 60 * 1000;

export interface Readiness {
  /** Checklist slots that must have a document ("(if applicable)" ones may stay empty). */
  required_slots: string[];
  /** Required slots with no document yet, and any slot still being scanned. */
  pending_slots: string[];
  attention_slots: string[];
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
    consistency: consistency.status,
    consistency_pending: consistencyPending,
    ready,
    verified: ready && attention.length === 0 && !disagree,
  };
}
