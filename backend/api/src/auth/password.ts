import * as argon2 from 'argon2';

/**
 * Password policy (NIST SP 800-63B style: length over composition rules):
 *   - 12 to 128 characters (the upper bound caps hashing cost per request);
 *   - at least one letter and at least one digit;
 *   - not made of a single repeated character.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_LETTER = /[A-Za-z]/;
export const PASSWORD_DIGIT = /\d/;

/** Returns a machine-readable reason when the password violates the policy. */
export function passwordPolicyViolation(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (!PASSWORD_LETTER.test(password)) return 'missing_letter';
  if (!PASSWORD_DIGIT.test(password)) return 'missing_digit';
  if (new Set(password).size === 1) return 'single_repeated_character';
  return null;
}

/** argon2id with the library defaults (m=64 MiB, t=3, p=4). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same argon2 cost when the account does not exist, so login
 * response time does not reveal which emails are registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-1');
  await verifyPassword(await dummyHash, password);
  return false;
}
