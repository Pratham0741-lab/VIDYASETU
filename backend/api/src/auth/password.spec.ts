import { hashPassword, passwordPolicyViolation, verifyPassword } from './password';
import { generateRefreshToken, hashRefreshToken } from './refresh-tokens';

describe('password policy', () => {
  it.each([
    ['short1', 'too_short'],
    ['a'.repeat(129) + '1', 'too_long'],
    ['123456789012', 'missing_letter'],
    ['abcdefghijkl', 'missing_digit'],
  ])('rejects %p (%s)', (password, reason) => {
    expect(passwordPolicyViolation(password)).toBe(reason);
  });

  it('accepts a 12+ character password with a letter and a digit', () => {
    expect(passwordPolicyViolation('correct horse 7 battery')).toBeNull();
  });
});

describe('argon2id hashing', () => {
  it('produces an argon2id hash that verifies only the original password', async () => {
    const hash = await hashPassword('Tribal-Scholar-2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'Tribal-Scholar-2026')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'tribal-scholar-2026')).resolves.toBe(false);
    await expect(verifyPassword('not-a-hash', 'x')).resolves.toBe(false);
  });
});

describe('refresh tokens', () => {
  it('are 256-bit random values stored only as a SHA-256 hash', () => {
    const token = generateRefreshToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});
