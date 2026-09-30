import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { psql } from './psql.mjs';
const raw = ['SBIN0004455:77012345', '77012345', '77020001', '77030001', '77040001', 'JH-ST-2026-555001', 'JHST2026555001', 'jh st 2026 555001', '555001', 'JH-ST-2026-9000'];
const enc = raw.slice(0, 2).flatMap((v) => [Buffer.from(v).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, '')]);
const needles = [...raw, ...enc];
const pii = ['Arjun', 'Tirkey', 'Meena', 'Hembrom', 'Sunita', 'Hansda', 'Pooja', 'Minj', 'Kavya', 'Oraon', '2003-02-14', '2004-03-12', '180000'];
const esc = (s) => s.replace(/'/g, "''").replace(/[%_]/g, (c) => String.fromCharCode(92) + c);
const arr = (xs) => `ARRAY[${xs.map((x) => `'%${esc(x)}%'`).join(',')}]`;
const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
console.log(`=== DB: ${tables.length} tables, row_to_json(row)::text ILIKE any of ${needles.length} identifier needles (raw, normalised, hex, base64) ===`);
for (const t of tables) {
  const hits = psql(`SELECT n, count(*) FROM "${t}" x, unnest(${arr(needles)}) n WHERE row_to_json(x)::text ILIKE n GROUP BY n ORDER BY n;`);
  if (hits) console.log(`  HIT ${t}: ${hits.replace(/\n/g, '; ')}`);
}
console.log('  (tables with no hit are not listed)');
console.log(`\n=== fraud_flags + pii_match_index + audit_logs rows for those tables: PII needles (names, DOBs, income) ===`);
for (const [t, where] of [['fraud_flags', 'true'], ['pii_match_index', 'true'], ['audit_logs', `table_name IN ('fraud_flags','pii_match_index')`]]) {
  const total = psql(`SELECT count(*) FROM "${t}" x WHERE ${where};`);
  const hits = psql(`SELECT count(*) FROM "${t}" x WHERE ${where} AND row_to_json(x)::text ILIKE ANY(${arr([...pii, ...needles])});`);
  console.log(`  ${t.padEnd(16)} rows=${total} rows containing any needle=${hits}`);
}
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api', 'ml'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 28 }).toString();
console.log(`\n=== api + ml logs: ${logs.split('\n').length} lines ===`);
for (const n of [...needles, ...pii]) { const c = logs.split('\n').filter((l) => l.toLowerCase().includes(n.toLowerCase())).length; if (c) console.log(`  HIT ${n}: ${c} lines`); }
console.log(`  fraud log lines: ${logs.split('\n').filter((l) => l.includes('fraud detection')).length}; sample: ${logs.split('\n').filter((l) => l.includes('"fraud detection run"')).at(-1)?.replace(/^.*?\{/, '{').slice(0, 260)}`);
const files = readdirSync('responses');
const blob = files.map((f) => readFileSync('responses/' + f, 'utf8')).join('\n');
console.log(`\n=== ${files.length} saved API responses (flags, disposition, queue, 409 bodies) ===`);
let any = false; for (const n of [...needles, ...pii]) if (blob.toLowerCase().includes(n.toLowerCase())) { any = true; console.log(`  HIT ${n}`); }
if (!any) console.log('  no needle found');
console.log('\n=== positive control (search must be able to hit) ===');
const ctl = 'JH-INC-2026-D1X01';
for (const t of tables) { const c = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE '%${ctl}%';`); if (c !== '0') console.log(`  control '${ctl}' (OCR certificate_number, plaintext in extracted_data by Phase 7 design): ${t} rows=${c}`); }
console.log(`  control in fraud_flags: ${psql(`SELECT count(*) FROM fraud_flags x WHERE row_to_json(x)::text ILIKE '%${ctl}%';`)}; in logs: ${logs.includes(ctl)}; in responses: ${blob.includes(ctl)}`);
console.log(`  control 'Arjun' (applicant first name): accounts/applicants rows=${psql(`SELECT (SELECT count(*) FROM applicants x WHERE row_to_json(x)::text ILIKE '%Arjun%') || '/' || (SELECT count(*) FROM accounts x WHERE row_to_json(x)::text ILIKE '%arjun%');`)}`);
