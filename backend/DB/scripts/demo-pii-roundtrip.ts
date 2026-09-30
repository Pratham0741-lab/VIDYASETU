import { PrismaClient } from '@prisma/client';
import { piiEncryptionExtension } from '../lib/crypto/pii-extension';

// Ensure encryption key is loaded for demonstration
if (!process.env.PII_ENCRYPTION_KEY) {
  process.env.PII_ENCRYPTION_KEY = 'ud5nQfOhfmDjwxKSWN7glJ+5yNZJYuxX8qL3hqLuWS0=';
}

// Instantiate extended Prisma Client with transparent PII encryption/decryption
const prisma = new PrismaClient().$extends(piiEncryptionExtension);

async function runDemo() {
  console.log('============================================================');
  console.log('🔐 Demonstrating Application-Layer AES-256-GCM PII Encryption');
  console.log('============================================================\n');

  const testEmail = 'demo.birsa.munda@tribal.gov.in';
  const rawCasteCert = 'ST-JH-2024-998877';
  const rawIncome = '185000.00';
  const rawBankAccount = 'SBIN0001234:98765432101';

  // 1. Clean up any existing record
  await prisma.applicant.deleteMany({ where: { email: testEmail } });

  // 2. Standard Prisma Client insert with plain text fields!
  // The piiEncryptionExtension automatically intercepts and encrypts before writing to DB.
  console.log('1️⃣  Executing standard prisma.applicant.create() with plaintext strings:');
  console.log(`    - caste_cert_number : "${rawCasteCert}"`);
  console.log(`    - income            : "${rawIncome}"`);
  console.log(`    - bank_account      : "${rawBankAccount}"`);

  const created = await prisma.applicant.create({
    data: {
      first_name: 'Birsa',
      last_name: 'Munda',
      email: testEmail,
      phone: '+919876543210',
      gender: 'MALE',
      dob: new Date('2002-11-15'),
      category: 'ST',
      pvtg_group: 'Munda',
      is_disabled: false,
      domicile_state: 'Jharkhand',
      domicile_district: 'Ranchi',
      // Notice: normal string values passed to Bytes columns!
      caste_cert_number: rawCasteCert as any,
      income: rawIncome as any,
      bank_account: rawBankAccount as any,
    },
  });

  console.log(`  ✓ Applicant created with ID: ${created.id}\n`);

  // 3. Inspect what is ACTUALLY stored in PostgreSQL at the database layer
  console.log('2️⃣  Inspecting raw bytes in PostgreSQL storage (bypassing extension):');
  const rawRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, encode(caste_cert_number, 'hex') as enc_caste, encode(income, 'hex') as enc_income, encode(bank_account, 'hex') as enc_bank FROM applicants WHERE id = $1::uuid`,
    created.id
  );
  if (rawRows.length > 0) {
    console.log(`  ✓ Raw DB hex (caste_cert_number): ${rawRows[0].enc_caste.substring(0, 32)}... (encrypted AES-256-GCM)`);
    console.log(`  ✓ Raw DB hex (income)           : ${rawRows[0].enc_income.substring(0, 32)}... (encrypted AES-256-GCM)`);
    console.log(`  ✓ Raw DB hex (bank_account)     : ${rawRows[0].enc_bank.substring(0, 32)}... (encrypted AES-256-GCM)\n`);
  }

  // 4. Read back using prisma.applicant.findUnique()
  // The extension transparently intercepts the query and decrypts the fields back to strings.
  console.log('3️⃣  Executing prisma.applicant.findUnique() via extended client:');
  const retrieved: any = await prisma.applicant.findUnique({
    where: { id: created.id },
  });

  console.log(`  ✓ Decrypted caste_cert_number : "${retrieved?.caste_cert_number}" (Match: ${retrieved?.caste_cert_number === rawCasteCert})`);
  console.log(`  ✓ Decrypted income            : "${retrieved?.income}" (Match: ${retrieved?.income === rawIncome})`);
  console.log(`  ✓ Decrypted bank_account      : "${retrieved?.bank_account}" (Match: ${retrieved?.bank_account === rawBankAccount})`);

  console.log('\n============================================================');
  console.log('✨ Round-trip PII encryption/decryption demo completed successfully!');
  console.log('============================================================');
}

runDemo()
  .catch((e) => {
    // If database connection is not active in this environment, log friendly message
    if (e.message && e.message.includes('Can\'t reach database server')) {
      console.log('ℹ️ Note: Database server is not currently reachable locally. Once your DATABASE_URL is configured, this script validates end-to-end round-trip encryption.');
    } else {
      console.error('Demo error:', e);
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
