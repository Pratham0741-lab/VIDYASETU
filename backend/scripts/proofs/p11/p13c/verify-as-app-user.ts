// Phase 13C A3 (scratch only): the api's verifier path - app_user, an AUDITOR
// actor, denials via audit_verifier_denial_rows() - against DATABASE_URL.
import { PrismaClient } from '@prisma/client';
import { verifyAuditChain } from '../src/audit/audit-chain';
import { prismaAuditSource } from '../src/audit/audit-source';

const mode = (process.argv[2] ?? 'verifier-function') as 'table' | 'verifier-function';
const prisma = new PrismaClient();
prisma
  .$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
    await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
    await tx.$queryRawUnsafe(
      `SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email = 'auditor.jharkhand.p11@example.org'), true), set_config('app.actor_role', 'AUDITOR', true)`,
    );
    const who = await tx.$queryRawUnsafe<Array<{ u: string }>>(`SELECT current_user AS u`);
    const r = await verifyAuditChain(prismaAuditSource(tx, { denials: mode }));
    const b = r.denials.first_break;
    console.log(
      `   [${who[0].u}, AUDITOR Jharkhand, denials via ${mode}] ok=${r.ok} audit_break=${r.first_break?.kind ?? null} | denials ok=${r.denials.ok} legacy ${r.denials.legacy.rows}/${r.denials.legacy.checkpoint_rows} match=${r.denials.legacy.matches_checkpoint} chain=${r.denials.chain.rows} break=${b ? `${b.kind} at seq ${b.seq} ${b.fields ? '[' + b.fields.join(',') + ']' : ''}` : null}`,
    );
  }, { timeout: 600_000 })
  .finally(() => prisma.$disconnect());
