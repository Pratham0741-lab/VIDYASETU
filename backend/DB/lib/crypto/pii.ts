import * as crypto from 'crypto';

/**
 * ============================================================================
 * Application-Layer PII Encryption Utility (AES-256-GCM)
 * ============================================================================
 *
 * Provides cryptographic protection for sensitive applicant PII at the application
 * layer before persisting to PostgreSQL (mapping to @db.ByteA in Prisma).
 *
 * Wire & Storage Format:
 * [ IV (12 bytes) ] [ AuthTag (16 bytes) ] [ Ciphertext (N bytes) ]
 *
 * Benefits over DB-side pgcrypto:
 * 1. Zero plaintext exposure in PostgreSQL WAL logs, query logs, or DB memory dumps.
 * 2. Key separation: DB administrators cannot decrypt PII without application secrets.
 * 3. Native integration with Prisma Client via $extends extension.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended by NIST SP 800-38D for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag

function getEncryptionKey(): Buffer {
  const envKey = process.env.PII_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'PII_ENCRYPTION_KEY environment variable is missing. ' +
        'Generate a 32-byte base64-encoded key with "npx tsx scripts/generate-pii-key.ts" and set it in your .env file.'
    );
  }

  const keyBuffer = Buffer.from(envKey, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error(
      `PII_ENCRYPTION_KEY must be a 32-byte base64 string for AES-256 (received ${keyBuffer.length} bytes after decoding).`
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a plaintext string into a binary Buffer containing IV + AuthTag + Ciphertext.
 */
export function encryptPII(plaintext: string): Buffer {
  if (plaintext === null || plaintext === undefined) {
    throw new Error('Cannot encrypt null or undefined plaintext.');
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: [IV (12B)] + [AuthTag (16B)] + [Ciphertext (NB)]
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts a binary Buffer (containing IV + AuthTag + Ciphertext) back into a plaintext string.
 */
export function decryptPII(ciphertextBuffer: Buffer | Uint8Array): string {
  if (!ciphertextBuffer || ciphertextBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(
      `Invalid ciphertext buffer: expected at least ${IV_LENGTH + AUTH_TAG_LENGTH} bytes for GCM header.`
    );
  }

  const buffer = Buffer.isBuffer(ciphertextBuffer) ? ciphertextBuffer : Buffer.from(ciphertextBuffer);
  const key = getEncryptionKey();

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
