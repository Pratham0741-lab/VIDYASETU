import { PrismaClient } from '@prisma/client';
import { verifyAuditChain, VerifyReport } from '../src/audit/audit-chain';
import { prismaAuditSource } from '../src/audit/audit-source';

/**
 * Verifies the audit chain - the same code as GET /api/v1/audit/verify.
 * Prints the JSON report. Exit code: 0 verified, 1 verification failed,
 * 2 could not run.
 *
 *   docker compose run --rm db-migrate npx tsx scripts/verify-audit-chain.ts
 *   (any database: DATABASE_URL=... npx tsx scripts/verify-audit-chain.ts)
 *
 * Read-only: one READ ONLY transaction.
 */
function describe(chain: string, b: VerifyReport['first_break'], legacyMatches: boolean): string {
  if (b)
    return `${chain}: ${b.kind} at seq ${b.seq ?? '-'} (id ${b.record_id ?? '-'}): ${b.detail}${b.fields ? ` [fields: ${b.fields.join(', ')}]` : ''}`;
  return legacyMatches ? `${chain}: ok` : `${chain}: legacy rows do not match the checkpoint`;
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  try {
    const report = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return verifyAuditChain(prismaAuditSource(tx));
      },
      { timeout: 600_000, maxWait: 10_000 },
    );
    console.log(JSON.stringify(report, null, 2));
    console.error(
      report.ok
        ? `AUDIT CHAIN VERIFIED: ${report.chain.rows} chain rows (seq ${report.chain.first_seq}-${report.chain.last_seq}); ${report.legacy.rows} legacy rows match the checkpoint. DENIALS CHAIN VERIFIED: ${report.denials.chain.rows} chain rows; ${report.denials.legacy.rows} legacy denial rows match their checkpoint`
        : `VERIFICATION FAILED: ${describe('audit_logs', report.first_break, report.legacy.matches_checkpoint)}; ${describe('authorization_denials', report.denials.first_break, report.denials.legacy.matches_checkpoint)}`,
    );
    return report.ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('audit verification could not run:', err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
