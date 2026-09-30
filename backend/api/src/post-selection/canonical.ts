import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted (recursively), no whitespace, arrays in
 * order. Two equal documents always serialise to the same string, so the
 * SHA-256 of it identifies the CONTENT of a sanction order - unlike the PDF
 * bytes, which embed a creation timestamp and differ on every render.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('canonicalJson: non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
