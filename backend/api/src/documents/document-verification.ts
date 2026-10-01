import { deriveFormSchema } from '../schemes/form-schema';
import { readSchemeConfig } from '../schemes/scheme-config';
import type { CanonicalDocumentType } from './document-types';

/**
 * Per-document-type verification: OCR extracts, these rules decide. Pure (no
 * I/O), unit-tested in document-verification.spec.ts. Every comparison is
 * fuzzy: case, spacing, titles, initials, OCR noise, Devanagari digits and
 * date formats.
 *
 * A check is mandatory (its value must be read for the document to verify)
 * or conditional (checked only when read: a missing name, partial date or
 * certificate number never downgrades a document). Any check that reads a
 * clear value and fails flags the document for the officer, with the compared
 * values; it never rejects anything.
 */

export type CheckStatus = 'PASS' | 'FAIL' | 'NOT_READ' | 'UNAVAILABLE' | 'SKIPPED';

export interface RuleCheck {
  /** Rule code; the portals word it (doc.check.<rule>.<status>). */
  rule: string;
  /** The extracted field it reads. */
  field: string;
  /** Must be read for the document to verify. */
  mandatory: boolean;
  status: CheckStatus;
  /** What the document says (normalised), or null when not read. */
  extracted: string | number | null;
  /** What it was compared with (application value or scheme limit). */
  expected: string | number | null;
}

/** VERIFIED: every mandatory rule passed. FLAGGED: a rule failed on a clear value. UNREAD: a mandatory value is missing. */
export type VerificationResult = 'VERIFIED' | 'FLAGGED' | 'UNREAD';

export interface Verification {
  document_type: CanonicalDocumentType;
  result: VerificationResult;
  checks: RuleCheck[];
}

/** What the document is compared against: the application and the scheme. */
export interface VerificationContext {
  applicant_name: string | null;
  category: string | null;
  /** The income the applicant entered (annual, rupees). */
  entered_income: number | null;
  /** The marks the applicant entered: a percentage or raw marks. */
  entered_percentage: number | null;
  entered_marks: number | null;
  institution_name: string | null;
  institution_code: string | null;
  /** The application's academic year, e.g. "2024-25". */
  academic_year: string | null;
  /** Scheme limits (scheme config, never hardcoded). */
  income_ceiling: number | null;
  min_percentage: number | null;
  /** How long an income certificate stays valid (scheme config, default 12). */
  income_validity_months: number;
  now: Date;
}

export const NAME_MATCH_THRESHOLD = 0.8;
export const ENTERED_INCOME_TOLERANCE = 0.1;
export const MARKS_TOLERANCE = 2;
export const BONAFIDE_VALIDITY_MONTHS = 12;
const DEFAULT_INCOME_VALIDITY_MONTHS = 12;

// ---------------------------------------------------------------- parsing

const DEVANAGARI_DIGITS = /[०-९]/g;

/** Devanagari digits (०-९) to ASCII. */
export function asciiDigits(text: string): string {
  return text.replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966));
}

/** OCR letters read in place of digits, inside a token that is mostly digits. */
function repairDigits(token: string): string {
  // A grouped amount starting with a real digit ("1,8O,OOO") is all digits.
  const grouped = /^\d[\dOoQlI|SsBZ]*(?:[,.][\dOoQlI|SsBZ]+)+$/.test(token);
  const digits = grouped ? token.length : (token.match(/\d/g) ?? []).length;
  const letters = (token.match(/[OoQlI|SsBZ]/g) ?? []).length;
  if (digits === 0 || digits < letters) return token;
  return token
    .replace(/[OoQ]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');
}

/** An amount: 240000, "2,40,000", "Rs. 2,40,000/-", "₹ २४००००", "2.4 lakh". Null when not a number. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = asciiDigits(value).trim();
  const lakh = /(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs|लाख)/i.exec(text);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const cleaned = repairDigits(text.replace(/^(?:rs\.?|inr|₹)\s*/i, '').replace(/\/-$/, ''))
    .replace(/[,\s]/g, '')
    .replace(/\.$/, '');
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A percentage or score: 78.5, "78.5%", "७८.५". */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = /-?\d+(?:\.\d+)?/.exec(repairDigits(asciiDigits(value)).replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function validDate(y: number, m: number, d: number): Date | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date
    : null;
}

/**
 * A full date: 2024-04-12, 12/04/2024, 12-04-24, 12.04.2024, "12 April 2024",
 * "12-Apr-2024", Devanagari digits. Day first (Indian documents). A partial
 * date ("04/2024", "2024") is null: not a date that can be checked.
 */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const text = repairDigits(
    asciiDigits(value)
      .trim()
      .replace(/\s*([/.-])\s*/g, '$1'),
  );
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) return validDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return month ? validDate(+m[3], month, +m[1]) : null;
  }
  return null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

// ---------------------------------------------------------------- text matching

const TITLES = new Set([
  'mr',
  'mrs',
  'ms',
  'miss',
  'shri',
  'shree',
  'sri',
  'smt',
  'kumari',
  'km',
  'dr',
  'prof',
  'master',
  'kum',
]);

function normaliseText(text: string): string {
  return asciiDigits(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\p{Script=Devanagari}]+/gu, ' ')
    .trim();
}

function nameTokens(name: string): string[] {
  return (
    normaliseText(name)
      .split(' ')
      .filter((t) => t && !TITLES.has(t))
      // OCR digits inside a name: "R4hul" -> "rahul" is not knowable; "0" -> "o", "1" -> "l".
      .map((t) => t.replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's'))
  );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(
        Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity of two strings (1 - normalised edit distance). */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

function tokenScore(a: string, b: string): number {
  // An initial ("R." / "R") matches any word with that first letter.
  if ((a.length === 1 || b.length === 1) && a[0] === b[0]) return 1;
  return similarity(a, b);
}

/**
 * 0..1 match of two person names, tolerant of case, spacing, titles, initials,
 * word order, a missing middle name and OCR noise. Each word of the shorter
 * name is matched to its best word in the other; joined spellings
 * ("Ramkumar" / "Ram Kumar") are compared as a whole too.
 */
export function nameMatch(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let at = -1;
    long.forEach((u, i) => {
      if (used.has(i)) return;
      const s = tokenScore(t, u);
      if (s > best) [best, at] = [s, i];
    });
    if (at >= 0) used.add(at);
    total += best;
  }
  const perWord = total / short.length;
  // A name of one word against three only proves so much.
  const coverage = short.length === 1 && long.length > 2 ? 0.9 : 1;
  const joined = similarity(ta.join(''), tb.join(''));
  return Math.max(perWord * coverage, joined);
}

const INSTITUTION_FILLER = new Set(['the', 'of', 'and', 'for', 'in', 'at', '&']);

/**
 * Does the institution on the document match the application's? Its code
 * appears in the text, or the application's name words are (fuzzily) found
 * in the document's name.
 */
export function institutionMatch(
  extracted: string,
  name: string | null,
  code: string | null,
): boolean {
  const text = normaliseText(extracted);
  if (code) {
    const c = normaliseText(code).replace(/\s/g, '');
    if (c.length >= 3 && text.replace(/\s/g, '').includes(c)) return true;
  }
  if (!name) return false;
  const want = normaliseText(name)
    .split(' ')
    .filter((t) => t && !INSTITUTION_FILLER.has(t));
  const have = text.split(' ').filter((t) => t && !INSTITUTION_FILLER.has(t));
  if (want.length === 0 || have.length === 0) return false;
  const found = want.filter((w) => have.some((h) => similarity(w, h) >= 0.8)).length;
  return (
    found / want.length >= NAME_MATCH_THRESHOLD || similarity(want.join(''), have.join('')) >= 0.85
  );
}

/** Category as a code: "Scheduled Tribe", "S.T.", "अनुसूचित जनजाति" -> ST. */
export function normaliseCategory(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = normaliseText(value).replace(/\s/g, '');
  if (!t) return null;
  if (/pvtg|particularlyvulnerable/.test(t)) return 'PVTG';
  if (/^st(others?)?$|scheduledtribe|sheduledtribe|tribe|जनजाति/.test(t)) return 'ST';
  if (/^sc$|scheduledcaste|sheduledcaste|अनुसूचितजाति/.test(t)) return 'SC';
  if (/^obc$|otherbackward|पिछड/.test(t)) return 'OBC';
  if (/^ews$|economicallyweaker/.test(t)) return 'EWS';
  if (/^(gen|general|ur|unreserved)$/.test(t)) return 'GENERAL';
  return t.toUpperCase();
}

function categoriesMatch(document: string, application: string): boolean {
  // A PVTG applicant is a Scheduled Tribe member: an ST certificate is theirs.
  if (document === application) return true;
  return (
    (document === 'ST' && application === 'PVTG') || (document === 'PVTG' && application === 'ST')
  );
}

/** "2024-25", "2024-2025", "2024 - 25", "२०२४-२५" -> start year 2024. */
export function academicYearStart(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /(20\d{2})\s*[-/–]\s*(\d{2,4})/.exec(asciiDigits(value));
  if (m) return Number(m[1]);
  const single = /\b(20\d{2})\b/.exec(asciiDigits(value));
  return single ? Number(single[1]) : null;
}

/** The academic year (July-June) a date falls in, by start year. */
function currentAcademicStart(now: Date): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

// ---------------------------------------------------------------- checks

function check(
  rule: string,
  field: string,
  mandatory: boolean,
  status: CheckStatus,
  extracted: string | number | null,
  expected: string | number | null,
): RuleCheck {
  return { rule, field, mandatory, status, extracted, expected };
}

/** Name: conditional (a missing name never blocks), >= 80% fuzzy match. */
function nameCheck(
  field: string,
  fields: Readonly<Record<string, unknown>>,
  ctx: VerificationContext,
): RuleCheck {
  const read = text(fields[field]);
  if (!read) return check('name_match', field, false, 'NOT_READ', null, ctx.applicant_name);
  if (!ctx.applicant_name) return check('name_match', field, false, 'UNAVAILABLE', read, null);
  const score = nameMatch(read, ctx.applicant_name);
  return check(
    'name_match',
    field,
    false,
    score >= NAME_MATCH_THRESHOLD ? 'PASS' : 'FAIL',
    read,
    ctx.applicant_name,
  );
}

/** Certificate number: optional, recorded for the officer, never decides. */
function certificateNumber(field: string, fields: Readonly<Record<string, unknown>>): RuleCheck {
  const read = text(fields[field]);
  return check(
    'certificate_number',
    field,
    false,
    read ? 'PASS' : 'NOT_READ',
    read ? 'read' : null,
    null,
  );
}

function income(fields: Readonly<Record<string, unknown>>, ctx: VerificationContext): RuleCheck[] {
  const raw = fields.family_income_annual;
  const amount = parseAmount(raw);
  const checks: RuleCheck[] = [];
  if (amount === null) {
    checks.push(check('income_read', 'family_income_annual', true, 'NOT_READ', text(raw), null));
  } else {
    checks.push(
      ctx.income_ceiling === null
        ? check('income_ceiling', 'family_income_annual', true, 'SKIPPED', amount, null)
        : check(
            'income_ceiling',
            'family_income_annual',
            true,
            amount <= ctx.income_ceiling ? 'PASS' : 'FAIL',
            amount,
            ctx.income_ceiling,
          ),
    );
    if (ctx.entered_income === null) {
      checks.push(check('income_entered', 'family_income_annual', true, 'SKIPPED', amount, null));
    } else {
      // Within 10% of the entered income in BOTH directions: a certificate far
      // below what was entered is as suspect as one far above it.
      const ok =
        Math.abs(amount - ctx.entered_income) <=
        ENTERED_INCOME_TOLERANCE * Math.max(ctx.entered_income, 1);
      checks.push(
        check(
          'income_entered',
          'family_income_annual',
          true,
          ok ? 'PASS' : 'FAIL',
          amount,
          ctx.entered_income,
        ),
      );
    }
  }
  const issued = parseDate(fields.issued_date);
  if (!issued) {
    checks.push(
      check(
        'income_validity',
        'issued_date',
        false,
        'NOT_READ',
        text(fields.issued_date),
        ctx.income_validity_months,
      ),
    );
  } else {
    const from = monthsBefore(ctx.now, ctx.income_validity_months);
    const ok = issued >= from && issued <= ctx.now;
    checks.push(
      check(
        'income_validity',
        'issued_date',
        false,
        ok ? 'PASS' : 'FAIL',
        isoDate(issued),
        ctx.income_validity_months,
      ),
    );
  }
  checks.push(nameCheck('applicant_name', fields, ctx));
  checks.push(certificateNumber('certificate_number', fields));
  return checks;
}

function caste(fields: Readonly<Record<string, unknown>>, ctx: VerificationContext): RuleCheck[] {
  const read = normaliseCategory(fields.category);
  const expected = normaliseCategory(ctx.category);
  const checks: RuleCheck[] = [];
  if (!read) checks.push(check('category_match', 'category', true, 'NOT_READ', null, expected));
  else if (!expected)
    checks.push(check('category_match', 'category', true, 'UNAVAILABLE', read, null));
  else
    checks.push(
      check(
        'category_match',
        'category',
        true,
        categoriesMatch(read, expected) ? 'PASS' : 'FAIL',
        read,
        expected,
      ),
    );
  checks.push(nameCheck('applicant_name', fields, ctx));
  const issued = parseDate(fields.issued_date);
  checks.push(
    issued
      ? check(
          'issue_not_future',
          'issued_date',
          false,
          issued <= ctx.now ? 'PASS' : 'FAIL',
          isoDate(issued),
          isoDate(ctx.now),
        )
      : check('issue_not_future', 'issued_date', false, 'NOT_READ', text(fields.issued_date), null),
  );
  checks.push(certificateNumber('caste_cert_number', fields));
  return checks;
}

function marksheet(
  fields: Readonly<Record<string, unknown>>,
  ctx: VerificationContext,
): RuleCheck[] {
  const checks: RuleCheck[] = [nameCheck('candidate_name', fields, ctx)];
  const obtained = parseNumber(fields.marks_obtained);
  const total = parseNumber(fields.total_marks);
  let percentage = parseNumber(fields.percentage);
  if ((percentage === null || percentage > 100) && obtained !== null && total) {
    percentage = Math.round((obtained / total) * 10000) / 100;
  }
  if (percentage !== null && (percentage < 0 || percentage > 100)) percentage = null;
  if (percentage === null) {
    checks.push(check('marks_read', 'percentage', true, 'NOT_READ', text(fields.percentage), null));
    return checks;
  }
  checks.push(
    ctx.min_percentage === null
      ? check('marks_minimum', 'percentage', true, 'SKIPPED', percentage, null)
      : check(
          'marks_minimum',
          'percentage',
          true,
          percentage >= ctx.min_percentage ? 'PASS' : 'FAIL',
          percentage,
          ctx.min_percentage,
        ),
  );
  if (ctx.entered_percentage !== null) {
    const ok = Math.abs(percentage - ctx.entered_percentage) <= MARKS_TOLERANCE;
    checks.push(
      check(
        'marks_entered',
        'percentage',
        true,
        ok ? 'PASS' : 'FAIL',
        percentage,
        ctx.entered_percentage,
      ),
    );
  } else if (ctx.entered_marks !== null && obtained !== null) {
    const ok = Math.abs(obtained - ctx.entered_marks) <= MARKS_TOLERANCE;
    checks.push(
      check(
        'marks_entered',
        'marks_obtained',
        true,
        ok ? 'PASS' : 'FAIL',
        obtained,
        ctx.entered_marks,
      ),
    );
  } else {
    checks.push(check('marks_entered', 'percentage', true, 'SKIPPED', percentage, null));
  }
  return checks;
}

function bonafide(
  fields: Readonly<Record<string, unknown>>,
  ctx: VerificationContext,
): RuleCheck[] {
  const checks: RuleCheck[] = [nameCheck('student_name', fields, ctx)];
  const institution = text(fields.institution_name);
  const expectedInstitution = ctx.institution_name ?? ctx.institution_code;
  if (!institution)
    checks.push(
      check('institution_match', 'institution_name', true, 'NOT_READ', null, expectedInstitution),
    );
  else if (!expectedInstitution)
    checks.push(
      check('institution_match', 'institution_name', true, 'UNAVAILABLE', institution, null),
    );
  else {
    const ok = institutionMatch(institution, ctx.institution_name, ctx.institution_code);
    checks.push(
      check(
        'institution_match',
        'institution_name',
        true,
        ok ? 'PASS' : 'FAIL',
        institution,
        expectedInstitution,
      ),
    );
  }
  const year = academicYearStart(fields.academic_year);
  const wantYear = academicYearStart(ctx.academic_year) ?? currentAcademicStart(ctx.now);
  checks.push(
    year === null
      ? check(
          'academic_year_current',
          'academic_year',
          false,
          'NOT_READ',
          text(fields.academic_year),
          wantYear,
        )
      : check(
          'academic_year_current',
          'academic_year',
          false,
          year === wantYear ? 'PASS' : 'FAIL',
          year,
          wantYear,
        ),
  );
  const issued = parseDate(fields.issued_date);
  if (!issued) {
    checks.push(
      check(
        'bonafide_recent',
        'issued_date',
        false,
        'NOT_READ',
        text(fields.issued_date),
        BONAFIDE_VALIDITY_MONTHS,
      ),
    );
  } else {
    const ok = issued >= monthsBefore(ctx.now, BONAFIDE_VALIDITY_MONTHS) && issued <= ctx.now;
    checks.push(
      check(
        'bonafide_recent',
        'issued_date',
        false,
        ok ? 'PASS' : 'FAIL',
        isoDate(issued),
        BONAFIDE_VALIDITY_MONTHS,
      ),
    );
  }
  return checks;
}

const RULES: Partial<
  Record<
    CanonicalDocumentType,
    (f: Readonly<Record<string, unknown>>, c: VerificationContext) => RuleCheck[]
  >
> = {
  INCOME_CERTIFICATE: income,
  CASTE_CERTIFICATE: caste,
  MARKSHEET: marksheet,
  BONAFIDE: bonafide,
};

/** Document types verified by rules (others keep the confidence-based review). */
export function hasVerificationRules(
  type: CanonicalDocumentType | null,
): type is CanonicalDocumentType {
  return type !== null && RULES[type] !== undefined;
}

/** The verdict of one document's extracted values. Null: no rules for this type. */
export function verifyDocument(
  type: CanonicalDocumentType | null,
  fields: Readonly<Record<string, unknown>>,
  ctx: VerificationContext,
): Verification | null {
  if (!hasVerificationRules(type)) return null;
  const checks = RULES[type]!(fields, ctx);
  const result: VerificationResult = checks.some((c) => c.status === 'FAIL')
    ? 'FLAGGED'
    : checks.some((c) => c.mandatory && (c.status === 'NOT_READ' || c.status === 'UNAVAILABLE'))
      ? 'UNREAD'
      : 'VERIFIED';
  return { document_type: type, result, checks };
}

// ---------------------------------------------------------------- scheme limits

/** The income ceiling the scheme's rules compare family_income_annual with (lowest, if several). */
function lowestLimit(config: unknown, keyPattern: RegExp): number | null {
  const fields = deriveFormSchema(config).fields.filter((f) => keyPattern.test(f.key));
  const values = fields.flatMap((f) => f.limits.map((l) => l.value));
  return values.length > 0 ? Math.min(...values) : null;
}

function highestLimit(config: unknown, keyPattern: RegExp): number | null {
  const fields = deriveFormSchema(config).fields.filter((f) => keyPattern.test(f.key));
  const values = fields.flatMap((f) => f.limits.map((l) => l.value));
  return values.length > 0 ? Math.max(...values) : null;
}

/** Scheme limits from the scheme version's config (rules and their params). */
export function schemeLimits(
  config: unknown,
): Pick<VerificationContext, 'income_ceiling' | 'min_percentage' | 'income_validity_months'> {
  let validity = DEFAULT_INCOME_VALIDITY_MONTHS;
  try {
    for (const rule of readSchemeConfig(config).rules) {
      for (const [k, v] of Object.entries(rule.params ?? {})) {
        if (
          /income.*validity.*months|certificate_validity_months/i.test(k) &&
          typeof v === 'number' &&
          v > 0
        ) {
          validity = v;
        }
      }
    }
  } catch {
    // An unreadable config has no limits to apply.
  }
  return {
    income_ceiling: lowestLimit(config, /^family_income_annual$/),
    // A minimum on a percentage-like field (e.g. previous_percentage >= params.min_percentage).
    min_percentage: highestLimit(config, /(percent|percentage|marks)/i),
    income_validity_months: validity,
  };
}

/** The applicant's entered marks, from declared answers: a percentage key first, then raw marks. */
export function enteredMarks(declared: unknown): {
  percentage: number | null;
  marks: number | null;
} {
  const out = { percentage: null as number | null, marks: null as number | null };
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return out;
  for (const [k, v] of Object.entries(declared as Record<string, unknown>)) {
    const n = parseNumber(v);
    if (n === null) continue;
    if (out.percentage === null && /percent|percentage|cgpa_percent/i.test(k)) out.percentage = n;
    else if (out.marks === null && /marks/i.test(k)) out.marks = n;
  }
  return out;
}
