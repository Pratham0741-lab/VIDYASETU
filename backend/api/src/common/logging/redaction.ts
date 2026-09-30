/**
 * Phase 17 (Part A): personal data never reaches the application logs.
 *
 * Every object logged through pino passes redactForLog (formatters.log):
 *   * a value under a sensitive key - at any depth, key compared case- and
 *     separator-insensitively - becomes "[REDACTED]";
 *   * an Error becomes { type, name, code, message, stack, meta, cause } with
 *     its message and stack scrubbed (a Prisma error's message repeats the
 *     query and its values: only its first line is kept), and meta redacted;
 *   * free text keeps its shape but e-mail addresses and runs of 6+ digits
 *     (phone, account, Aadhaar, certificate numbers) are masked.
 * Class instances other than Errors (the raw request / response) are left to
 * their serializers, which log request bodies only as field names and sizes.
 */
export const REDACTED = '[REDACTED]';

const KEYS = [
  // identity
  'first_name',
  'last_name',
  'full_name',
  'applicant_name',
  'holder_name',
  'father_name',
  'mother_name',
  'guardian_name',
  'officer_name',
  'email',
  'phone',
  'mobile',
  'dob',
  'date_of_birth',
  'address',
  'to',
  'recipient_address',
  'to_last4',
  // money and identifiers
  'income',
  'annual_income',
  'family_income_annual',
  'bank_account',
  'account_number',
  'ifsc',
  'caste_cert_number',
  'certificate_number',
  'aadhaar',
  'aadhaar_number',
  'uid',
  'uid_hmac',
  'match_hmac',
  // secrets
  'password',
  'new_password',
  'password_hash',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  // free text written by people, and document / notice content
  'reason',
  'remarks',
  'notes',
  'review_notes',
  'confirmation_reason',
  'override_reason',
  'decision_remarks',
  'endorsement_remarks',
  'description',
  'progress_report',
  'student_response',
  'resolution_note',
  'body',
  'text',
  'subject',
  'corrections',
  'declared',
  'extracted_data',
  'sensitive_values',
  'raw_text',
  'content',
  'applicant',
] as const;

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
export const SENSITIVE_LOG_KEYS: ReadonlySet<string> = new Set(KEYS.map(norm));
export const isSensitiveLogKey = (k: string) => SENSITIVE_LOG_KEYS.has(norm(k));

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS = /\d(?:[\s-]?\d){5,}/g;

/**
 * A log MESSAGE (the string argument): a Prisma invocation error quoted as
 * the message keeps only its first line; everything else is scrubText'ed.
 */
export function scrubMessage(s: string): string {
  const t = s.trim();
  if (/Invalid `prisma\./.test(t) || /invocation:/.test(t)) {
    return scrubText(t.split('\n').find((l) => l.trim().length > 0) ?? '');
  }
  return scrubText(s);
}

/** Masks e-mail addresses and digit runs of 6 or more in free text. */
export function scrubText(s: string): string {
  return s.replace(EMAIL, '[email]').replace(LONG_DIGITS, '[digits]');
}

function isPlain(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

function errorForLog(e: Error, depth: number): Record<string, unknown> {
  const anyErr = e as Error & { code?: unknown; meta?: unknown; cause?: unknown };
  const prisma = e.name.startsWith('PrismaClient');
  // Prisma messages quote the whole invocation (with values) after the first line.
  const firstLine = (s: string) =>
    s
      .trim()
      .split('\n')
      .find((l) => l.trim().length > 0) ?? '';
  const message = scrubText(prisma ? firstLine(e.message) : e.message);
  const stack = (e.stack ?? '')
    .split('\n')
    .filter((l) => /^\s+at /.test(l))
    .slice(0, 12)
    .join('\n');
  return {
    type: e.constructor?.name ?? 'Error',
    name: e.name,
    ...(anyErr.code !== undefined ? { code: redactForLog(anyErr.code, depth + 1) } : {}),
    message,
    ...(stack ? { stack } : {}),
    ...(anyErr.meta !== undefined ? { meta: redactForLog(anyErr.meta, depth + 1) } : {}),
    ...(anyErr.cause !== undefined ? { cause: redactForLog(anyErr.cause, depth + 1) } : {}),
  };
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 10) return '[DEPTH]';
  if (typeof value === 'string') return scrubText(value);
  if (value instanceof Error) return errorForLog(value, depth);
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1));
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        isSensitiveLogKey(k) && v !== null && v !== undefined
          ? REDACTED
          : redactForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** A request body as field names and sizes only (never values). */
export function bodyShape(body: unknown): Record<string, unknown> | undefined {
  if (!isPlain(body)) return undefined;
  const fields = Object.entries(body)
    .slice(0, 50)
    .map(([k, v]) => ({
      name: k,
      type: Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v,
      size:
        typeof v === 'string'
          ? v.length
          : Array.isArray(v)
            ? v.length
            : isPlain(v)
              ? Object.keys(v).length
              : undefined,
    }));
  return { fields };
}

/** A URL as its path and the NAMES of its query parameters (values dropped). */
export function urlShape(url: string | undefined): string | undefined {
  if (!url) return url;
  const [path, query] = url.split('?', 2);
  if (!query) return path;
  const names = [
    ...new Set(query.split('&').map((p) => decodeURIComponent(p.split('=')[0] ?? ''))),
  ];
  return `${path}?${names.map((n) => `${n}=…`).join('&')}`;
}
