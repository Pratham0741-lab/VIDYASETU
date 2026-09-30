import { PrismaClient } from '@prisma/client';

/**
 * Sets the password of the `app_user` runtime role from POSTGRES_APP_PASSWORD.
 *
 * Run by the db-migrate compose service right after `prisma migrate deploy`
 * (migration 20260926030000 creates app_user without a password, because
 * migration SQL cannot read environment variables). Must connect as the
 * migration-owner role (DATABASE_URL). Idempotent: safe to re-run.
 */

// Must be URL-safe: the api embeds it in DATABASE_URL without encoding.
const URL_SAFE = /^[A-Za-z0-9._~-]{12,128}$/;

async function main(): Promise<void> {
  const password = process.env.POSTGRES_APP_PASSWORD;
  if (!password) {
    console.error('POSTGRES_APP_PASSWORD is not set; cannot set the app_user password.');
    process.exit(1);
  }
  if (!URL_SAFE.test(password)) {
    console.error(
      'POSTGRES_APP_PASSWORD must be 12-128 URL-safe characters (letters, digits, . _ ~ -).',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // ALTER ROLE cannot take bind parameters; let PostgreSQL quote the
    // literal with format(%L) so the value can never break out of the string.
    const rows = await prisma.$queryRaw<{ stmt: string }[]>`
      SELECT format('ALTER ROLE app_user WITH LOGIN PASSWORD %L', ${password}::text) AS stmt`;
    await prisma.$executeRawUnsafe(rows[0].stmt);
    console.log('app_user password set from POSTGRES_APP_PASSWORD.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Failed to set app_user password:', err instanceof Error ? err.message : err);
  process.exit(1);
});
