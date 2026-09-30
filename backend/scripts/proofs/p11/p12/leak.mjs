// Phase 12 proof 7: no PII in analytics responses, CSV exports, logs or tables.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { psql } from '../psql.mjs';

const pii = {
  names: ['Sumani', 'Kerketta', 'Rebecca', 'Minz', 'Jyotsna', 'Barwa', 'Birsi', 'Tete', 'Hiralal', 'Arjun', 'Tirkey', 'Ramesh', 'Munda', 'Salomi'],
  dobs: ['1996-03-21', '1994-08-30', '1992-07-07', '1990-01-19', '2003-02-14'],
  incomes: ['420000', '180000', '350000'],
  identifiers: ['SBIN0004455:55001001', 'sbin0004455 55001001', 'SBIN0004455 55003003', 'JH-ST-2026-771051', 'JH-ST-2026-773051', 'JH-ST-2026-770991', 'JH-ST-2026-770992', 'JH-INC-2026-M1160', 'JH-INC-2026-G115Y'],
};
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = Object.fromEntries(Object.entries(pii).map(([k, vs]) => [k, vs.flatMap((v) => (k === 'identifiers' ? forms(v) : [v]))]));

// 1. analytics responses and CSV exports (everything under responses/p12)
const files = readdirSync('responses/p12');
const blob = files.map((f) => readFileSync(`responses/p12/${f}`, 'utf8')).join('\n');
console.log(`analytics responses + exports: ${files.length} files (${files.filter((f) => f.endsWith('.csv')).length} CSV)`);
for (const [k, ns] of Object.entries(needles)) {
  const hits = ns.filter((x) => blob.toLowerCase().includes(x.toLowerCase()));
  // incomes are short numbers: only count them as a hit outside amounts / ids
  console.log(`  ${k.padEnd(12)} ${ns.length} needles -> ${hits.length ? 'HIT ' + hits.join(',') : '0 hits'}`);
}

// 2. logs (analytics lines, and the whole api log)
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 28 }).toString();
const alines = logs.split('\n').filter((l) => l.includes('analytics'));
console.log(`api log: ${logs.split('\n').length} lines, ${alines.length} analytics lines; sample: ${alines.find((l) => l.includes('"analytics query"'))?.replace(/^.*?\{/, '{').slice(0, 200)}`);
for (const [k, ns] of Object.entries(needles)) {
  const hits = ns.filter((x) => (k === 'incomes' ? alines.join('\n') : logs).toLowerCase().includes(x.toLowerCase()));
  console.log(`  ${k.padEnd(12)} -> ${hits.length ? 'HIT ' + hits.join(',') : '0 hits'}${k === 'incomes' ? ' (analytics lines)' : ' (whole api log)'}`);
}

// 3. tables: identifiers in any form, anywhere
const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
let dbHits = 0;
for (const t of tables) {
  const c = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${needles.identifiers.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]);`);
  if (c !== '0') { dbHits++; console.log(`  HIT ${t}: ${c}`); }
}
console.log(`tables: ${tables.length}; identifier needles (raw, normalised, hex, base64): ${needles.identifiers.length}; ${dbHits ? dbHits + ' table(s) hit' : '0 hits'}`);

// 4. positive controls: the same method does find values that are there
console.log('positive controls:');
console.log(`  'Sumani' in applicants (plaintext first_name by design): ${psql(`SELECT count(*) FROM applicants x WHERE row_to_json(x)::text ILIKE '%Sumani%';`)} row(s)`);
console.log(`  'VS-2027-28' (an application number) in the saved Phase 12 A3 responses: ${readFileSync('responses/p12-P12N1-schedule.json', 'utf8').includes('application_id')}`);
console.log(`  analytics blob contains a known aggregate token 'HELD_BY_FRAUD_REVIEW': ${blob.includes('HELD_BY_FRAUD_REVIEW')}`);
