import * as crypto from 'crypto';

/**
 * ============================================================================
 * Cryptographic Key Generator for AES-256-GCM PII Encryption
 * ============================================================================
 * Run via: npx tsx scripts/generate-pii-key.ts
 */

function generateKey() {
  const keyBytes = crypto.randomBytes(32);
  const base64Key = keyBytes.toString('base64');

  console.log('============================================================');
  console.log('🔑 AES-256 PII Encryption Key Generated');
  console.log('============================================================\n');
  console.log(`PII_ENCRYPTION_KEY=${base64Key}\n`);
  console.log('Instructions:');
  console.log('1. Copy the line above into your .env file or production secrets manager.');
  console.log('2. NEVER commit this key to version control.');
  console.log('3. Use distinct keys for local development, staging, and production.');
  console.log('============================================================');
}

generateKey();
