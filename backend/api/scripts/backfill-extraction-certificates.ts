import { Prisma, PrismaClient } from '@prisma/client';
import { decryptPII, encryptPII } from '../src/lib/crypto/pii';
import { bytes, isSensitiveField, SENSITIVE_MARKER } from '../src/documents/review-routing';

/**
 * Phase 11.5 (M10) one-off backfill: extractions written before
 * certificate_number joined the encrypted fields still hold it as text in
 * extracted_data. This moves each such value into the encrypted
 * sensitive_values and leaves Phase 7's marker in its place - exactly what
 * the pipeline now writes for new extractions.
 *
 * Audit: each UPDATE fires the existing audit trigger, which records the NEW
 * (redacted) row, attributed to the SYSTEM actor. The earlier INSERT audit
 * rows are append-only and hash-chained; they are not (and cannot safely be)
 * rewritten - see docs/KNOWN_LIMITATIONS.md, M10.
 *
 * Never prints a value. Counts only. Dry run unless --apply:
 *   docker compose run --rm db-migrate npx tsx scripts/backfill-extraction-certificates.ts [--apply]
 */
const MOVED_KEYS = ['certificate_number'].filter(isSensitiveField);

function isMarker(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'redacted' in v;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.documentExtraction.findMany({
      select: { id: true, extracted_data: true, sensitive_values: true },
      orderBy: { id: 'asc' },
    });
    const pending = rows.filter((r) => {
      const data = (r.extracted_data ?? {}) as Record<string, unknown>;
      return MOVED_KEYS.some((k) => k in data && data[k] !== null && !isMarker(data[k]));
    });
    console.log(
      `extractions: ${rows.length}; holding ${MOVED_KEYS.join(', ')} as text: ${pending.length}` +
        (apply ? '' : ' (dry run: pass --apply to encrypt them)'),
    );
    if (!apply || pending.length === 0) return;

    let updated = 0;
    await prisma.$transaction(async (tx) => {
      // The SYSTEM actor, as every pipeline extraction write (audit attribution).
      await tx.$executeRaw`SELECT set_config('app.actor_role', 'SYSTEM', true),
        set_config('app.actor_id', '', true)`;
      for (const r of pending) {
        const data = { ...(r.extracted_data as Record<string, unknown>) };
        const sensitive = r.sensitive_values
          ? (JSON.parse(decryptPII(r.sensitive_values)) as Record<string, unknown>)
          : {};
        for (const k of MOVED_KEYS) {
          if (!(k in data) || data[k] === null || isMarker(data[k])) continue;
          sensitive[k] = data[k];
          data[k] = SENSITIVE_MARKER;
        }
        await tx.documentExtraction.update({
          where: { id: r.id },
          data: {
            extracted_data: data as Prisma.InputJsonObject,
            sensitive_values: bytes(encryptPII(JSON.stringify(sensitive))),
          },
        });
        updated += 1;
      }
    });
    console.log(`encrypted: ${updated} extraction(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('backfill failed:', err instanceof Error ? err.message : 'unknown error');
  process.exit(1);
});
