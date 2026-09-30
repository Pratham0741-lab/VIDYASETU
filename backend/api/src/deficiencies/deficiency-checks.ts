import type { Prisma } from '@prisma/client';
import { CanonicalDocumentType, SLOT_DOCUMENT_TYPE } from '../documents/document-types';
import { ITEMISED_DEFICIENCY_CODE } from '../notifications/notification-intents';

/**
 * Phase 13C: the document checks a deficiency item comes from, what each
 * check depends on, and how an item is re-checked. Pure: no I/O.
 *
 * Every item names one check (check_code). An item's check reads either its
 * own document slot (DOCUMENT_PRESENT, QUALITY_GATE, DOCUMENT_VALIDITY,
 * FIELD_CONFIDENCE) or every document (NAME_CONSISTENCY, DOB_CONSISTENCY -
 * the cross-document comparison). A recheck runs an item's check only if one
 * of the documents it depends on changed since the deficiency was raised;
 * everything else is reported as skipped. OFFICER items have no automatic
 * check: a replacement upload marks them RESUBMITTED for the officer.
 */
export const CHECK_CODES = [
  'DOCUMENT_PRESENT',
  'QUALITY_GATE',
  'DOCUMENT_VALIDITY',
  'NAME_CONSISTENCY',
  'DOB_CONSISTENCY',
  'FIELD_CONFIDENCE',
  'OFFICER',
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];
export type AutomaticCheck = Exclude<CheckCode, 'OFFICER'>;

/** Message keys (notice_templates rows, en + hi). */
export const PROBLEM = {
  DOCUMENT_MISSING: 'deficiency.problem.document_missing',
  IMAGE_UNREADABLE: 'deficiency.problem.image_unreadable',
  DOCUMENT_EXPIRED: 'deficiency.problem.document_expired',
  ISSUE_DATE_UNREADABLE: 'deficiency.problem.issue_date_unreadable',
  NAME_MISMATCH: 'deficiency.problem.name_mismatch',
  DOB_MISMATCH: 'deficiency.problem.dob_mismatch',
  FIELD_UNREADABLE: 'deficiency.problem.field_unreadable',
  WRONG_DOCUMENT: 'deficiency.problem.wrong_document',
  NOT_ATTESTED: 'deficiency.problem.not_attested',
} as const;
export const FIX_FOR: Readonly<Record<string, string>> = {
  [PROBLEM.DOCUMENT_MISSING]: 'deficiency.fix.upload_document',
  [PROBLEM.IMAGE_UNREADABLE]: 'deficiency.fix.rescan_clearly',
  [PROBLEM.DOCUMENT_EXPIRED]: 'deficiency.fix.upload_current_certificate',
  [PROBLEM.ISSUE_DATE_UNREADABLE]: 'deficiency.fix.show_issue_date',
  [PROBLEM.NAME_MISMATCH]: 'deficiency.fix.same_name_everywhere',
  [PROBLEM.DOB_MISMATCH]: 'deficiency.fix.same_dob_everywhere',
  [PROBLEM.FIELD_UNREADABLE]: 'deficiency.fix.rescan_clearly',
  [PROBLEM.WRONG_DOCUMENT]: 'deficiency.fix.upload_correct_document',
  [PROBLEM.NOT_ATTESTED]: 'deficiency.fix.get_attested',
};
/** Problems an officer may state on an OFFICER item (no automatic check). */
export const OFFICER_PROBLEMS: readonly string[] = [PROBLEM.WRONG_DOCUMENT, PROBLEM.NOT_ATTESTED];

/** The deficiencies row of an itemised deficiency (title/description are message keys). */
export const ITEMISED_DEFICIENCY = {
  code: ITEMISED_DEFICIENCY_CODE,
  title: 'deficiency.title.itemised',
  description: 'deficiency.description.itemised',
} as const;

/** Extracted issue-date keys: the ml service says issued_date, the api mock issue_date. */
const ISSUE_DATE_KEYS = ['issued_date', 'issue_date'] as const;

export interface SlotEvidence {
  slot: string;
  document_type: CanonicalDocumentType | null;
  /** The latest document for the slot, or null. */
  document: {
    id: string;
    created_at: Date;
    quality_usable: boolean | null;
  } | null;
  /** The latest extraction of that document, or null (not yet run). */
  extraction: {
    status: string; // COMPLETED | FAILED
    field_review: Record<string, string>;
    /** Non-sensitive extracted values (sensitive ones are markers). */
    values: Record<string, unknown>;
    eligibility_mismatch_fields: string[];
    /** Phase 13D: where each field was read (null / absent: no box). */
    field_boxes?: Record<string, BoxRef | null>;
  } | null;
}

/** A field box as the ml service returns it (stored-image pixels). */
export interface BoxRef {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinate_space: string;
}

/** deficiency_items.crop_ref: the document and the box to crop. */
export interface CropRef extends BoxRef {
  document_id: string;
  field: string;
}

export interface ConsistencyEvidence {
  checked_at: Date | null;
  names_match: boolean | null;
  dob_match: boolean | null;
}

export interface CheckPolicy {
  /** Canonical type -> validity months (config.deficiencies.validityMonths). */
  validityMonths: Readonly<Record<string, number>>;
  now: Date;
}

export type Outcome = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_APPLICABLE';
export interface CheckResult {
  check: CheckCode;
  slot: string | null;
  field?: string;
  outcome: Outcome;
  /** For FAIL: the problem and its fix (message keys). */
  problem_code?: string;
  fix_code?: string;
  /** Machine-readable note, never a value. */
  note?: string;
}

const fail = (
  check: CheckCode,
  slot: string | null,
  problem: string,
  note?: string,
  field?: string,
): CheckResult => ({
  check,
  slot,
  ...(field ? { field } : {}),
  outcome: 'FAIL',
  problem_code: problem,
  fix_code: FIX_FOR[problem],
  ...(note ? { note } : {}),
});
const pass = (check: CheckCode, slot: string | null, field?: string): CheckResult => ({
  check,
  slot,
  ...(field ? { field } : {}),
  outcome: 'PASS',
});
const pending = (check: CheckCode, slot: string | null, note: string): CheckResult => ({
  check,
  slot,
  outcome: 'PENDING',
  note,
});

/** The issue date as a Date, or null (missing / unreadable / not a date). */
export function issueDate(values: Record<string, unknown>): Date | null {
  for (const key of ISSUE_DATE_KEYS) {
    const v = values[key];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(`${v}T00:00:00Z`);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/** date + months (calendar months, UTC). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Runs one slot check on the slot's latest document. */
export function runSlotCheck(
  check: Exclude<AutomaticCheck, 'NAME_CONSISTENCY' | 'DOB_CONSISTENCY'>,
  ev: SlotEvidence,
  policy: CheckPolicy,
  field?: string,
): CheckResult {
  const slot = ev.slot;
  if (!ev.document) return fail(check, slot, PROBLEM.DOCUMENT_MISSING, undefined, field);
  if (check === 'DOCUMENT_PRESENT') return pass(check, slot);
  if (ev.document.quality_usable === false) {
    return fail(check, slot, PROBLEM.IMAGE_UNREADABLE, undefined, field);
  }
  if (check === 'QUALITY_GATE') return pass(check, slot);

  if (check === 'DOCUMENT_VALIDITY') {
    const months = ev.document_type ? policy.validityMonths[ev.document_type] : undefined;
    if (months === undefined) {
      return { check, slot, outcome: 'NOT_APPLICABLE', note: 'no_validity_rule' };
    }
    if (!ev.extraction) return pending(check, slot, 'extraction_pending');
    if (ev.extraction.status !== 'COMPLETED')
      return fail(check, slot, PROBLEM.ISSUE_DATE_UNREADABLE);
    const issued = issueDate(ev.extraction.values);
    if (!issued) return fail(check, slot, PROBLEM.ISSUE_DATE_UNREADABLE);
    return addMonths(issued, months) < policy.now
      ? fail(check, slot, PROBLEM.DOCUMENT_EXPIRED, `validity_months_${months}`)
      : pass(check, slot);
  }

  // FIELD_CONFIDENCE: the officer-marked field must now read reliably.
  if (!field) throw new Error('FIELD_CONFIDENCE needs a field');
  if (!ev.extraction) return { ...pending(check, slot, 'extraction_pending'), field };
  if (
    ev.extraction.status !== 'COMPLETED' ||
    ev.extraction.field_review[field] === 'NEEDS_REVIEW'
  ) {
    return fail(check, slot, PROBLEM.FIELD_UNREADABLE, undefined, field);
  }
  return pass(check, slot, field);
}

/**
 * The cross-document name / date-of-birth comparison, read from the
 * application's latest consistency result. `since`: the result must be newer
 * than the latest changed document, or it is still PENDING.
 */
export function runConsistencyCheck(
  check: 'NAME_CONSISTENCY' | 'DOB_CONSISTENCY',
  c: ConsistencyEvidence,
  since: Date | null,
): CheckResult {
  if (!c.checked_at || (since && c.checked_at < since)) {
    return pending(check, null, 'consistency_pending');
  }
  const verdict = check === 'NAME_CONSISTENCY' ? c.names_match : c.dob_match;
  if (verdict === null) return pending(check, null, 'consistency_uncertain');
  if (verdict) return pass(check, null);
  return fail(
    check,
    null,
    check === 'NAME_CONSISTENCY' ? PROBLEM.NAME_MISMATCH : PROBLEM.DOB_MISMATCH,
  );
}

/** Consistency evidence from applications.document_consistency_details (mock / ml shape). */
export function consistencyEvidence(
  details: Prisma.JsonValue | null,
  checkedAt: Date | null,
): ConsistencyEvidence {
  const checks = (details as { checks?: Record<string, unknown> } | null)?.checks ?? {};
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return {
    checked_at: checkedAt,
    names_match: bool(checks.names_match),
    dob_match: bool(checks.dob_match),
  };
}

/**
 * Every automatic check that currently fails for the application: the
 * items a new deficiency is generated from. Slot checks per checklist slot;
 * the two consistency checks once.
 */
export function failedChecks(
  slots: SlotEvidence[],
  consistency: ConsistencyEvidence,
  policy: CheckPolicy,
): CheckResult[] {
  const out: CheckResult[] = [];
  for (const ev of slots) {
    // A slot the scheme marks "(if applicable)" is not required: its absence
    // is never an automatic item (an officer may still add one).
    if (!ev.document && isConditionalSlot(ev.slot)) continue;
    // One item per slot: the first failing check in pipeline order.
    for (const check of ['DOCUMENT_PRESENT', 'QUALITY_GATE', 'DOCUMENT_VALIDITY'] as const) {
      const r = runSlotCheck(check, ev, policy);
      if (r.outcome === 'FAIL') {
        out.push(r);
        break;
      }
    }
  }
  for (const check of ['NAME_CONSISTENCY', 'DOB_CONSISTENCY'] as const) {
    const r = runConsistencyCheck(check, consistency, null);
    if (r.outcome === 'FAIL') out.push(r);
  }
  return out;
}

/** Checklist text the scheme marks as conditional, e.g. "Disability certificate (if applicable)". */
export function isConditionalSlot(slot: string): boolean {
  return /\(if applicable\)/i.test(slot);
}

/**
 * Phase 13D: the region an item is about, when the page shows it - the
 * issue date for a validity item, the marked field for a field item. Other
 * checks (missing document, unreadable scan, cross-document) have no region.
 */
export function cropFor(
  check: string,
  ev: SlotEvidence | undefined,
  field?: string | null,
): CropRef | null {
  if (!ev?.document || !ev.extraction?.field_boxes) return null;
  const candidates =
    check === 'DOCUMENT_VALIDITY'
      ? [...ISSUE_DATE_KEYS]
      : check === 'FIELD_CONFIDENCE' && field
        ? [field]
        : [];
  for (const f of candidates) {
    const box = ev.extraction.field_boxes[f];
    if (box) return { document_id: ev.document.id, field: f, ...box };
  }
  return null;
}

/** What an item's check reads: its own slot, or every document. */
export function dependsOn(item: {
  check_code: string;
  document_slot: string | null;
}): { kind: 'slot'; slot: string } | { kind: 'all_documents' } | { kind: 'manual' } {
  if (item.check_code === 'OFFICER') return { kind: 'manual' };
  if (item.check_code === 'NAME_CONSISTENCY' || item.check_code === 'DOB_CONSISTENCY') {
    return { kind: 'all_documents' };
  }
  return { kind: 'slot', slot: item.document_slot ?? '' };
}

/** doc_refs key (scheme rules) -> canonical type, from the Phase 7 slot table. */
function docRefType(ref: string): CanonicalDocumentType | null {
  return Object.prototype.hasOwnProperty.call(SLOT_DOCUMENT_TYPE, ref)
    ? SLOT_DOCUMENT_TYPE[ref]
    : null;
}

/**
 * The scheme rules whose doc_refs name a document of this canonical type:
 * the eligibility criteria that depend on the document (the C1 dependency
 * map), e.g. INCOME_CERTIFICATE -> income_ceiling.
 */
export function rulesDependingOn(
  type: CanonicalDocumentType | null,
  config: Prisma.JsonValue,
): string[] {
  if (!type) return [];
  const rules = (config as { rules?: Array<{ id?: unknown; doc_refs?: unknown }> } | null)?.rules;
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(
      (r) =>
        Array.isArray(r.doc_refs) &&
        (r.doc_refs as unknown[]).some((d) => typeof d === 'string' && docRefType(d) === type),
    )
    .map((r) => String(r.id))
    .sort();
}

/** Days to fix an item: the scheme version's deficiency_policy.deadline_days, else the default. */
export function deadlineDays(config: Prisma.JsonValue, fallback: number): number {
  const d = (config as { deficiency_policy?: { deadline_days?: unknown } } | null)
    ?.deficiency_policy?.deadline_days;
  return typeof d === 'number' && Number.isInteger(d) && d > 0 && d <= 365 ? d : fallback;
}

/**
 * Phase 13D (M37): the certificate validity rules for one scheme version.
 * The configured default (DOCUMENT_VALIDITY_MONTHS) with the version's own
 * `deficiency_policy.document_validity_months` laid over it: a type listed
 * there uses the version's months; `null` removes the default rule for that
 * scheme; a type with no rule at all never expires (NOT_APPLICABLE).
 */
export function validityMonthsFor(
  config: Prisma.JsonValue,
  fallback: Readonly<Record<string, number>>,
): Record<string, number> {
  const own = (config as { deficiency_policy?: { document_validity_months?: unknown } } | null)
    ?.deficiency_policy?.document_validity_months;
  const out: Record<string, number> = { ...fallback };
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    for (const [type, months] of Object.entries(own as Record<string, unknown>)) {
      if (months === null) delete out[type];
      else if (
        typeof months === 'number' &&
        Number.isInteger(months) &&
        months >= 1 &&
        months <= 240
      ) {
        out[type] = months;
      }
    }
  }
  return out;
}

/** OVERDUE is computed when read: an unresolved item past its deadline. */
export function effectiveStatus(status: string, deadline: Date, now: Date): string {
  return (status === 'OPEN' || status === 'RESUBMITTED') && deadline < now ? 'OVERDUE' : status;
}
