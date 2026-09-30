import { PrismaClient } from '@prisma/client';

/**
 * Seeds the five officer roles (reference data the api depends on).
 * Names come from the Role model's documented values; APPLICANT is implicit
 * and never stored here. Idempotent (upsert on the unique name), so the
 * db-migrate runner executes it on every run.
 */
const ROLES: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'SUPER_ADMIN', description: 'System administrator: provisions officers.' },
  { name: 'MINISTRY_OFFICER', description: 'Ministry of Tribal Affairs officer: national scope.' },
  { name: 'STATE_NODAL_OFFICER', description: 'State nodal officer: one state.' },
  { name: 'DISTRICT_NODAL_OFFICER', description: 'District nodal officer: one district.' },
  { name: 'INSTITUTE_NODAL_OFFICER', description: 'Institute nodal officer: one institution.' },
  {
    name: 'COMMITTEE',
    description: 'Selection committee member: reads selections and objections in its scope.',
  },
  {
    name: 'AUDITOR',
    description: 'Read-only auditor: audit verification, analytics, applications and flags.',
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const role of ROLES) {
      await prisma.role.upsert({
        where: { name: role.name },
        create: role,
        update: { description: role.description },
      });
    }
    const names = (await prisma.role.findMany({ orderBy: { name: 'asc' } })).map((r) => r.name);
    console.log(`Roles present (${names.length}): ${names.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('Role seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
