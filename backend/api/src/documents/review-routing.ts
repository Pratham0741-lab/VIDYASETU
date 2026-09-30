import { SENSITIVE_PROFILE_KEYS } from '../schemes/sensitive-fields';

/**
 * Pure decisions of the document pipeline (no I/O), unit-tested in
 * review-routing.spec.ts.
 */

export type FieldReview = 'AUTO_ACCEPTED' | 'NEEDS_REVIEW' | 'OFFICER_CONFIRMED';
export type ReviewStatus = FieldReview;

/** Marker stored in extracted_data in place of a sensitive value. */
export const SENSITIVE_MARKER = { redacted: true, encrypted: true } as const;

/** Per-document-type threshold from config, falling back to "default". */
export function thresholdFor(thresholds: Readonly<Record<string, number>>, slot: string): number {
  return Object.prototype.hasOwnProperty.call(thresholds, slot)
    ? thresholds[slot]
    : thresholds.default;
}

export interface Routing {
  field_review: Record<string, FieldReview>;
  review_status: ReviewStatus;
  /** Why the document as a whole needs review (empty when auto-accepted). */
  reasons: string[];
  lowest_confidence: number | null;
}

/**
 * Field confidence >= threshold -> AUTO_ACCEPTED, else NEEDS_REVIEW. The
 * document needs review if any field does, or if classification did not
 * confidently confirm the slot it was uploaded for.
 */
export function routeByConfidence(
  fieldConfidence: Readonly<Record<string, number>>,
  threshold: number,
  classification: { type: string; confidence: number },
  /** The slot's canonical document type (document-types.ts); null = none. */
  expectedType: string | null,
): Routing {
  const field_review: Record<string, FieldReview> = {};
  const reasons: string[] = [];
  for (const key of Object.keys(fieldConfidence).sort()) {
    const ok = fieldConfidence[key] >= threshold;
    field_review[key] = ok ? 'AUTO_ACCEPTED' : 'NEEDS_REVIEW';
    if (!ok) reasons.push(`field ${key} confidence below ${threshold}`);
  }
  if (expectedType === null) {
    reasons.push(
      'the uploaded slot has no canonical document type, so classification cannot confirm it',
    );
  } else if (classification.type !== expectedType) {
    reasons.push('classified document type differs from the uploaded slot');
  } else if (classification.confidence < threshold) {
    reasons.push(`classification confidence below ${threshold}`);
  }
  const values = Object.values(fieldConfidence);
  return {
    field_review,
    review_status: reasons.length === 0 ? 'AUTO_ACCEPTED' : 'NEEDS_REVIEW',
    reasons,
    lowest_confidence: values.length === 0 ? null : Math.min(...values),
  };
}

/**
 * Extracted fields encrypted at rest in addition to the Phase 3 list: a
 * document identifier that is not an Applicant column (so not a profile key)
 * but must not sit as text in extracted_data or its audit copy (Phase 11.5,
 * M10). Exact-match lookup goes through Phase 11's keyed pii_match_index.
 */
export const SENSITIVE_EXTRACTION_ONLY_KEYS: ReadonlySet<string> = new Set(['certificate_number']);

/** Is an extracted field sensitive? The Phase 3 list plus the extraction-only keys. */
export function isSensitiveField(key: string): boolean {
  return SENSITIVE_PROFILE_KEYS.has(key) || SENSITIVE_EXTRACTION_ONLY_KEYS.has(key);
}

/** Splits extracted values into storable-as-text and to-be-encrypted. */
export function splitSensitive(values: Readonly<Record<string, unknown>>): {
  stored: Record<string, unknown>;
  sensitive: Record<string, unknown>;
} {
  const stored: Record<string, unknown> = {};
  const sensitive: Record<string, unknown> = {};
  for (const key of Object.keys(values).sort()) {
    if (isSensitiveField(key)) {
      stored[key] = SENSITIVE_MARKER;
      sensitive[key] = values[key];
    } else {
      stored[key] = values[key];
    }
  }
  return { stored, sensitive };
}

function normaliseText(v: string): string {
  return v.toLowerCase().replace(/\s+/g, ' ').trim();
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, '').trim())) {
    return Number(v.replace(/,/g, '').trim());
  }
  return null;
}

/** Nothing was read: no value, or a value read at zero confidence. */
function notRead(value: unknown, confidence: number | undefined): boolean {
  return value === null || value === undefined || confidence === 0;
}

/**
 * Do an extracted value and the value an eligibility evaluation used
 * disagree? A field the extractor could not find - null, or its own
 * confidence 0 (the real ml service returns every field of the document
 * type, null when not read) - is never a disagreement: nothing was read.
 * Numbers: relative difference > tolerance. Otherwise: normalised text
 * inequality.
 */
export function disagrees(
  extracted: unknown,
  used: unknown,
  tolerance: number,
  fieldConfidence?: number,
): boolean {
  if (notRead(extracted, fieldConfidence)) return false;
  const a = asNumber(extracted);
  const b = asNumber(used);
  if (a !== null && b !== null) {
    const scale = Math.max(Math.abs(b), 1);
    return Math.abs(a - b) / scale > tolerance;
  }
  return normaliseText(String(extracted)) !== normaliseText(String(used));
}

export type ConsistencyStatus = 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN';

/**
 * Consistency result -> flag. Any check below the minimum confidence makes
 * the whole result UNCERTAIN (not a clean fail); otherwise any false check
 * is INCONSISTENT.
 */
export function consistencyStatus(
  value: Readonly<Record<string, boolean>>,
  confidence: Readonly<Record<string, number>>,
  minConfidence: number,
): ConsistencyStatus {
  const keys = Object.keys(value);
  // No checks at all (nothing comparable) is "cannot tell", never CONSISTENT
  // (Array.every on an empty list is vacuously true).
  if (keys.length === 0) return 'UNCERTAIN';
  if (keys.some((k) => (confidence[k] ?? 0) < minConfidence)) return 'UNCERTAIN';
  return keys.every((k) => value[k]) ? 'CONSISTENT' : 'INCONSISTENT';
}

/** A Buffer as the ArrayBuffer-backed Uint8Array Prisma's Bytes columns expect. */
export function bytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buffer);
}
