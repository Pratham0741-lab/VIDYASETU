import { createHash, randomBytes } from 'node:crypto';

/**
 * Refresh tokens are opaque 256-bit random values, not JWTs: revocation is a
 * database lookup, and only their SHA-256 hash is stored (refresh_tokens.
 * token_hash). A plain hash (no salt/KDF) is sufficient because the input is
 * 256 bits of randomness, not a guessable secret.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
