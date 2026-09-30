import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login, state } from './lib.mjs';
import { psql } from './psql.mjs';
const ino = await login('ino.ranchi.p11@example.org');
for (const k of ['G1', 'G2', 'D1']) writeFileSync(`responses/b3-flags-${k}.json`, JSON.stringify(await call('GET', `/applications/${state.P[k].applicationId}/fraud-flags`, undefined, ino, { raw: true }), null, 1));
const forms = (v) => { const n = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); return [v, n, Buffer.from(v).toString('hex'), Buffer.from(n).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(n).toString('base64').replace(/=+$/, '')]; };
const groups = {
  'NEW writes (after fix)': ['JH-INC-2026-G115Y', 'JH-INC-2026-G115Z'],
  'PRE-FIX values (backfilled)': ['JH-INC-2026-D1X01', 'JH-INC-2026-D3Y01'],
};
const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api', 'ml', 'db-migrate'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 28 }).toString();
const files = readdirSync('responses'); const blob = files.map((f) => readFileSync('responses/' + f, 'utf8')).join('\n');
for (const [g, vals] of Object.entries(groups)) {
  const needles = vals.flatMap(forms);
  console.log(`=== ${g}: ${vals.length} values x ${forms('x').length} forms = ${needles.length} needles (raw, normalised, hex x2, base64 x2)`);
  let any = false;
  for (const t of tables) {
    const hits = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${needles.map((n) => `'%${n}%'`).join(',')}]);`);
    if (hits !== '0') { any = true; console.log(`  HIT ${t}: ${hits} row(s)` + (t === 'audit_logs' ? ' -> ' + psql(`SELECT string_agg(table_name||'/'||action||' at '||to_char(created_at,'HH24:MI:SS'), '; ') FROM audit_logs x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${needles.map((n) => `'%${n}%'`).join(',')}]);`) : '')); }
  }
  if (!any) console.log(`  DB: 0 hits in ${tables.length} tables`);
  const lh = needles.filter((n) => logs.toLowerCase().includes(n.toLowerCase()));
  const rh = needles.filter((n) => blob.toLowerCase().includes(n.toLowerCase()));
  console.log(`  logs (api+ml+db-migrate, ${logs.split('\n').length} lines): ${lh.length ? 'HIT ' + lh.join(',') : '0 hits'}; saved responses (${files.length} files): ${rh.length ? 'HIT ' + rh.join(',') : '0 hits'}`);
}
console.log('=== positive controls');
console.log(`  pre-fix INSERT audit rows still holding 'JH-INC-2026-D1X01' (append-only history): ${psql(`SELECT count(*) FROM audit_logs x WHERE action='INSERT' AND row_to_json(x)::text LIKE '%JH-INC-2026-D1X01%';`)}`);
console.log(`  a caste certificate the search must NOT find in extractions but the method can find in text: 'Kavya' in applicants rows=${psql(`SELECT count(*) FROM applicants x WHERE row_to_json(x)::text ILIKE '%Kavya%';`)}`);
console.log(`  document_extractions with certificate_number as text: ${psql(`SELECT count(*) FROM document_extractions WHERE jsonb_typeof(extracted_data->'certificate_number')='string';`)} of ${psql('SELECT count(*) FROM document_extractions;')}`);
