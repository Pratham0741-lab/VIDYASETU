import { createHash, createHmac } from 'node:crypto';

export const MATCH_FIELDS = ['bank_account', 'caste_cert_number', 'certificate_number'] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

/** Current FRAUD_MATCH_KEY generation; stored with each index row. */
export const MATCH_KEY_VERSION = 1;

const DECIMAL_DIGIT = /\p{Nd}/u;

/**
 * A decimal digit of any script as its ASCII digit. Unicode encodes every
 * Nd digit in contiguous runs of ten, 0 to 9, so the value is the offset
 * from the start of its run (mod 10 for adjacent runs).
 */
function asciiDigit(ch: string): string {
  const cp = ch.codePointAt(0)!;
  if (cp >= 0x30 && cp <= 0x39) return ch;
  let start = cp;
  while (start > 0 && DECIMAL_DIGIT.test(String.fromCodePoint(start - 1))) start -= 1;
  return String((cp - start) % 10);
}

/**
 * The comparable form of an identifier (Phase 11.6, M11), the same for every
 * field: Unicode NFKC (fullwidth / compatibility forms to ASCII), decimal
 * digits of any script to ASCII, upper case, then every character that is
 * not a letter or a digit removed. So "SBIN0001234:30948291048",
 * "sbin0001234 30948291048", "SBIN0001234-30948291048" and
 * "SBIN000123430948291048" match; "JH-ST 2026/0452" matches "JHST20260452".
 *
 * Leading zeros are kept (two accounts can differ only by one). Letters of
 * other scripts are kept, not dropped, so a look-alike letter is a miss,
 * never a false match. Bank accounts lose their ":" safely: an IFSC is
 * always 11 characters, so IFSC + account splits one way only. Certificate
 * numbers that differ only in where their separators fall do collide - an
 * accepted risk (KNOWN_LIMITATIONS M17): a match only routes to review.
 */
export function normalizeIdentifier(_field: MatchField, value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Nd}/gu, asciiDigit)
    .toUpperCase()
    .replace(/[^\p{L}\p{Nd}]/gu, '');
}

/** Shortest normalised value that may produce a match, per field. */
export const MIN_MATCH_LENGTH: Readonly<Record<MatchField, number>> = {
  bank_account: 9, // Indian account numbers are 9-18 digits
  caste_cert_number: 6,
  certificate_number: 6,
};
/** Fewer digits than this is a placeholder ("NOT AVAILABLE", "NIL"), not an identifier. */
export const MIN_MATCH_DIGITS = 4;
const IFSC_ONLY = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** The normalised value, or null when it is too weak to match on. */
export function matchableValue(field: MatchField, value: string): string | null {
  const normalized = normalizeIdentifier(field, value);
  if (normalized.length < MIN_MATCH_LENGTH[field]) return null;
  if ((normalized.match(/[0-9]/g) ?? []).length < MIN_MATCH_DIGITS) return null;
  if (field === 'bank_account' && IFSC_ONLY.test(normalized)) return null; // branch, no account
  return normalized;
}

/**
 * Keyed hash used to find equal identifiers without comparing (or storing)
 * plaintext: HMAC-SHA256(FRAUD_MATCH_KEY, field || 0x00 || normalised value).
 * The field is part of the input, so equal values in different fields never
 * collide. Keyed, not a plain hash: account and certificate numbers are
 * low-entropy and a plain hash could be brute-forced back to the value.
 */
export function matchHmac(key: Buffer, field: MatchField, value: string): string | null {
  const normalized = matchableValue(field, value);
  if (normalized === null) return null; // too weak to be an identifier
  return createHmac('sha256', key).update(`${field}\u0000${normalized}`, 'utf8').digest('hex');
}

/** Stable key for "one flag per finding": the same evidence never makes a second row. */
export function dedupKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}
