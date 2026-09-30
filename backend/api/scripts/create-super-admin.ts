import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordPolicyViolation } from '../src/auth/password';

/**
 * Bootstraps the first SUPER_ADMIN (account + national-scope officer).
 * There is deliberately no API for this: POST /api/v1/admin/officers
 * requires an existing SUPER_ADMIN and cannot create another one.
 *
 * Run once, through the db-migrate image (owner connection):
 *   docker compose run --rm -e BOOTSTRAP_ADMIN_EMAIL=... \
 *     -e BOOTSTRAP_ADMIN_PASSWORD=... -e BOOTSTRAP_ADMIN_NAME=... \
 *     db-migrate npx tsx scripts/create-super-admin.ts
 * Refuses to touch an email that already has an account.
 */
async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'System Administrator';

  if (!email || !password) {
    console.error('Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');
    process.exit(1);
  }
  const violation = passwordPolicyViolation(password);
  if (violation) {
    console.error(`BOOTSTRAP_ADMIN_PASSWORD rejected by the password policy: ${violation}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const role = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
    if (!role) {
      console.error('Role SUPER_ADMIN is missing: run scripts/seed-roles.ts first.');
      process.exit(1);
    }
    if (await prisma.account.findUnique({ where: { email } })) {
      console.error(`An account for ${email} already exists; nothing changed.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const officer = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({ data: { email, password_hash: passwordHash } });
      return tx.officer.create({
        data: { user_id: account.id, email, name, role_id: role.id },
      });
    });
    console.log(
      `SUPER_ADMIN created: account ${officer.user_id}, officer ${officer.id} (${email}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
