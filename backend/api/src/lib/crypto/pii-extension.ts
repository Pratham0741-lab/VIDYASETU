import { Prisma } from '@prisma/client';
import { encryptPII, decryptPII } from './pii';

/**
 * ============================================================================
 * Prisma Client Extension for Transparent PII Encryption / Decryption
 * ============================================================================
 *
 * Intercepts Prisma queries on the `Applicant` model to:
 * 1. Encrypt `caste_cert_number`, `income`, and `bank_account` from plaintext
 *    strings into AES-256-GCM binary buffers on writes (create, update, upsert).
 * 2. Decrypt binary buffers back into plaintext strings on reads (findUnique,
 *    findFirst, findMany).
 *
 * Usage:
 * ```ts
 * import { PrismaClient } from '@prisma/client';
 * import { piiEncryptionExtension } from './lib/crypto/pii-extension';
 *
 * const prisma = new PrismaClient().$extends(piiEncryptionExtension);
 *
 * // Create with plaintext string fields:
 * const applicant = await prisma.applicant.create({
 *   data: {
 *     first_name: 'Birsa',
 *     last_name: 'Munda',
 *     category: 'ST',
 *     domicile_state: 'Jharkhand',
 *     caste_cert_number: 'ST-JH-2024-998877',
 *     income: '185000.00',
 *     bank_account: 'SBIN0001234:98765432101',
 *   },
 * });
 *
 * // Find returns plaintext strings transparently:
 * const found = await prisma.applicant.findUnique({ where: { id: applicant.id } });
 * console.log(found?.caste_cert_number); // 'ST-JH-2024-998877'
 * ```
 */

const ENCRYPTED_PII_FIELDS = ['caste_cert_number', 'income', 'bank_account'] as const;

/**
 * Transforms string inputs for sensitive fields into encrypted binary buffers.
 */
function encryptApplicantPayload<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const transformed: Record<string, any> = { ...data };

  for (const field of ENCRYPTED_PII_FIELDS) {
    if (field in transformed && typeof transformed[field] === 'string') {
      transformed[field] = encryptPII(transformed[field]);
    }
  }

  return transformed as T;
}

/**
 * Decrypts encrypted binary buffers back into plaintext strings for application consumption.
 */
function decryptApplicantRecord<T extends Record<string, any> | null>(record: T): any {
  if (!record) {
    return record;
  }

  if (Array.isArray(record)) {
    return record.map(decryptApplicantRecord);
  }

  const transformed: Record<string, any> = { ...record };

  for (const field of ENCRYPTED_PII_FIELDS) {
    const val = transformed[field];
    if (val && (Buffer.isBuffer(val) || val instanceof Uint8Array)) {
      try {
        transformed[field] = decryptPII(val);
      } catch (err) {
        // If decryption fails (e.g. legacy/mock data), retain raw representation
        console.warn(`[PII Decryption Warning] Failed to decrypt field "${field}":`, (err as Error).message);
      }
    }
  }

  return transformed;
}

/**
 * Reusable Prisma Client Extension definition.
 */
export const piiEncryptionExtension = Prisma.defineExtension({
  name: 'piiEncryptionExtension',
  query: {
    applicant: {
      async create({ args, query }) {
        args.data = encryptApplicantPayload(args.data as any);
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
      async update({ args, query }) {
        args.data = encryptApplicantPayload(args.data as any);
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
      async upsert({ args, query }) {
        args.create = encryptApplicantPayload(args.create as any);
        args.update = encryptApplicantPayload(args.update as any);
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
      async findFirst({ args, query }) {
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
      async findMany({ args, query }) {
        const result = await query(args);
        return decryptApplicantRecord(result);
      },
    },
  },
});
