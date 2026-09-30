import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordPolicyViolation } from '../src/auth/password';

/**
 * DEVELOPMENT ONLY (Phase 13B): one user per role added in 13B, so the
 * COMMITTEE and AUDITOR views can be tried locally. Same convention as
 * scripts/create-super-admin.ts: owner connection, password from the
 * environment, never printed. Refuses to run with NODE_ENV=production and
 * never touches an existing account.
 *
 *   docker compose run --rm -e DEV_ROLE_USER_PASSWORD=... db-migrate \
 *     npx tsx scripts/seed-dev-role-users.ts
 */
const USERS = [
  {
    email: 'committee.dev@example.org',
    name: 'Selection Committee (dev)',
    role: 'COMMITTEE',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
  },
  {
    email: 'auditor.dev@example.org',
    name: 'Auditor (dev)',
    role: 'AUDITOR',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: null,
  },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed development users with NODE_ENV=production.');
    process.exit(1);
  }
  const password = process.env.DEV_ROLE_USER_PASSWORD;
  if (!password) {
    console.error('Set DEV_ROLE_USER_PASSWORD.');
    process.exit(1);
  }
  const violation = passwordPolicyViolation(password);
  if (violation) {
    console.error(`DEV_ROLE_USER_PASSWORD rejected by the password policy: ${violation}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    for (const u of USERS) {
      const role = await prisma.role.findUnique({ where: { name: u.role } });
      if (!role) {
        console.error(`Role ${u.role} is missing: run scripts/seed-roles.ts first.`);
        process.exit(1);
      }
      if (await prisma.account.findUnique({ where: { email: u.email } })) {
        console.log(`${u.role}: ${u.email} already exists; unchanged.`);
        continue;
      }
      const passwordHash = await hashPassword(password);
      const officer = await prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: { email: u.email, password_hash: passwordHash },
        });
        return tx.officer.create({
          data: {
            user_id: account.id,
            email: u.email,
            name: u.name,
            role_id: role.id,
            jurisdiction_state: u.jurisdiction_state,
            jurisdiction_district: u.jurisdiction_district,
          },
        });
      });
      console.log(
        `${u.role}: created ${u.email} (officer ${officer.id}, ${u.jurisdiction_state}/${u.jurisdiction_district ?? '*'}).`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Development seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
