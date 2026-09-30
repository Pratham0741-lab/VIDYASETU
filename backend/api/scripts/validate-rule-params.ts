import * as fs from 'fs';
import * as path from 'path';
import { ruleParamMismatches, RuleParamMismatch } from '../src/schemes/rule-params';

/**
 * validate:rules - every `params.<key>` a rule expression reads exists in
 * that rule's params.
 *
 *   npm run validate:rules            the seed file (scheme_versions_seed_v2.json)
 *   npm run validate:rules -- --db    the seed file AND every scheme version in
 *                                     the database, including versions authored
 *                                     through the API (Phase 14 loose ends,
 *                                     Part A). Needs DATABASE_URL.
 *
 * The check itself (src/schemes/rule-params.ts) is the one the scheme-authoring
 * API applies before a draft is saved or published.
 */

interface SchemeVersionSeedEntry {
  scheme_code: string;
  version_no: number;
  config: unknown;
}

interface Located extends RuleParamMismatch {
  source: string;
  scheme_code: string;
  version_no: number;
}

function resolveSeedFilePath(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'prisma/scheme_versions_seed_v2.json'),
    path.resolve(__dirname, '../prisma/scheme_versions_seed_v2.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(
    `[ERROR] Could not locate "scheme_versions_seed_v2.json". Attempted:\n` +
      candidatePaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
  );
}

function check(source: string, entries: SchemeVersionSeedEntry[]) {
  const mismatches: Located[] = [];
  let totalRules = 0;
  let totalTokens = 0;
  for (const entry of entries) {
    const r = ruleParamMismatches(entry.config);
    totalRules += r.rules;
    totalTokens += r.tokens;
    for (const m of r.mismatches) {
      mismatches.push({ ...m, source, scheme_code: entry.scheme_code, version_no: entry.version_no });
    }
  }
  return { mismatches, totalEntries: entries.length, totalRules, totalTokens };
}

export function validateRuleParams() {
  const raw = fs.readFileSync(resolveSeedFilePath(), 'utf-8');
  return check('seed', JSON.parse(raw) as SchemeVersionSeedEntry[]);
}

async function validateDatabase() {
  // Imported lazily: the seed-only mode needs no database client.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.schemeVersion.findMany({
      select: { version_no: true, status: true, config: true, scheme: { select: { code: true } } },
      orderBy: [{ scheme: { code: 'asc' } }, { version_no: 'asc' }],
    });
    const byStatus = rows.reduce<Record<string, number>>((t, r) => {
      t[r.status] = (t[r.status] ?? 0) + 1;
      return t;
    }, {});
    const result = check(
      'database',
      rows.map((r) => ({ scheme_code: r.scheme.code, version_no: r.version_no, config: r.config })),
    );
    return { ...result, byStatus, schemes: [...new Set(rows.map((r) => r.scheme.code))] };
  } finally {
    await prisma.$disconnect();
  }
}

function report(
  label: string,
  r: { mismatches: Located[]; totalEntries: number; totalRules: number; totalTokens: number },
) {
  console.log(`   [${label}]`);
  console.log(`   - Scheme versions checked     : ${r.totalEntries}`);
  console.log(`   - Total rules inspected       : ${r.totalRules}`);
  console.log(`   - Total params.* tokens verified: ${r.totalTokens}`);
  console.log(`   - Parameter mismatches found  : ${r.mismatches.length}\n`);
}

async function main() {
  const withDb = process.argv.includes('--db');
  console.log('============================================================');
  console.log(
    `🔍 Validating Rule Expression Parameters (scheme_versions_seed_v2.json${withDb ? ' + database' : ''})`
  );
  console.log('============================================================\n');

  const seed = validateRuleParams();
  const db = withDb ? await validateDatabase() : null;
  const mismatches = [...seed.mismatches, ...(db?.mismatches ?? [])];

  if (mismatches.length > 0) {
    console.error(`❌ Found ${mismatches.length} rule parameter mismatch(es):\n`);
    for (const m of mismatches) {
      console.error(
        `  • [${m.source}] Scheme: ${m.scheme_code} v${m.version_no} | Rule: "${m.rule_id}" | Missing param key: "${m.missing_key}"`
      );
      console.error(`    Expression: ${m.expr}\n`);
    }
    console.error('Validation failed: Some expressions reference parameters missing from their params object.');
    process.exit(1);
  }

  console.log(`✅ All rule expression parameters validated successfully!`);
  report('seed file', seed);
  if (db) {
    report(`database: ${db.schemes.length} schemes (${db.schemes.join(', ')}); versions by status ${JSON.stringify(db.byStatus)}`, db);
  }
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
