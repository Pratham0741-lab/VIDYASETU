/**
 * THE single source of truth for which applicant.* rule paths are sensitive.
 * Both the persisted-trace redactor and the persisted-explanation renderer
 * (src/schemes/redaction.ts) read only from here.
 *
 * Classification rule: a profile field is sensitive when its value comes
 * from an Applicant column encrypted at rest (a `Bytes` column handled by
 * src/lib/crypto/pii-extension.ts: caste_cert_number, income, bank_account).
 * Each encrypted column maps to the profile keys that can carry its value:
 * the key EligibilityService derives from it, plus the column name itself in
 * case a rule or a caller-declared field uses it directly.
 *
 * Deliberately NOT sensitive under this rule: `age`, which is derived from
 * `dob`, a plain (unencrypted) Date column; and category, degree, tenure,
 * scores and similar non-encrypted attributes.
 *
 * src/schemes/redaction.spec.ts checks this map covers every Bytes column of Applicant,
 * so adding an encrypted column without classifying it fails the tests.
 */
export const ENCRYPTED_COLUMN_PROFILE_KEYS = {
  income: ['family_income_annual', 'income'],
  caste_cert_number: ['caste_cert_number'],
  bank_account: ['bank_account'],
} as const satisfies Record<string, readonly string[]>;

export const SENSITIVE_PROFILE_KEYS: ReadonlySet<string> = new Set(
  Object.values(ENCRYPTED_COLUMN_PROFILE_KEYS).flat(),
);

// A dotted applicant path inside any source text: a plain path, or one
// embedded in a rendered sub-expression such as "applicant.x / params.n".
const APPLICANT_PATH = /\bapplicant\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * True when the source text references a sensitive applicant field anywhere,
 * so values DERIVED from it (arithmetic, nested paths) are covered too.
 */
export function referencesSensitiveField(sourceText: string): boolean {
  for (const match of sourceText.matchAll(APPLICANT_PATH)) {
    if (SENSITIVE_PROFILE_KEYS.has(match[1])) return true;
  }
  return false;
}

/** The sensitive applicant.* paths a source text references (for the storage report). */
export function sensitivePathsIn(sourceText: string): string[] {
  const found = new Set<string>();
  for (const match of sourceText.matchAll(APPLICANT_PATH)) {
    if (SENSITIVE_PROFILE_KEYS.has(match[1])) found.add(`applicant.${match[1]}`);
  }
  return [...found];
}
