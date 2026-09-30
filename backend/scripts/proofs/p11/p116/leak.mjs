import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';
const ino = await login('ino.ranchi.p11@example.org');
for (const k of ['M11A', 'M11B', 'M11C', 'M11D', 'M11E', 'M11F', 'A2U']) writeFileSync(`responses/p116-flags-${k}.json`, JSON.stringify(await call('GET', `/applications/${state.P[k].applicationId}/fraud-flags`, undefined, ino, { raw: true }), null, 1));
const values = ['SBIN0004455:66007007', 'SBIN000445566007007', 'sbin0004455-６６００７００７', '66007007', 'JH-ST-2026-661001', 'jh/st/2026/661001', 'JHST2026661001', 'JH-INC-2026-M1160', 'jh inc 2026 m1160', 'JHINC2026M1160', 'SBIN000445588002002', 'SBIN0004455:88002002'];
const needles = [...new Set(values.flatMap((v) => [v, Buffer.from(v).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, '')]))];
const lit = (n) => `'%${n.replace(/'/g, "''")}%'`;
const tables = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
console.log(`needles: ${values.length} values x (raw, hex, base64) = ${needles.length}; tables: ${tables.length}`);
let hits = 0;
for (const t of tables) {
  const c = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${needles.map(lit).join(',')}]);`);
  if (c !== '0') { hits++; console.log(`  HIT ${t}: ${c}`); }
}
if (!hits) console.log('  DB: 0 hits');
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api', 'ml', 'db-migrate'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 28 }).toString().toLowerCase();
const files = readdirSync('responses'); const blob = files.map((f) => readFileSync('responses/' + f, 'utf8')).join('\n').toLowerCase();
const lh = needles.filter((n) => logs.includes(n.toLowerCase())), rh = needles.filter((n) => blob.includes(n.toLowerCase()));
console.log(`  logs (${logs.split('\n').length} lines): ${lh.length ? 'HIT ' + lh.join(',') : '0 hits'}; saved responses (${files.length} files): ${rh.length ? 'HIT ' + rh.join(',') : '0 hits'}`);
console.log('positive controls:');
console.log(`  pre-fix audit residual 'JH-INC-2026-D1X01' (M10, append-only): audit_logs rows=${psql(`SELECT count(*) FROM audit_logs x WHERE row_to_json(x)::text LIKE '%JH-INC-2026-D1X01%';`)}`);
console.log(`  a name the method must find: 'Hiralal' in applicants rows=${psql(`SELECT count(*) FROM applicants x WHERE row_to_json(x)::text ILIKE '%Hiralal%';`)}; in logs=${logs.includes('hiralal')}`);
console.log('flag evidence keys across all flags:', psql(`SELECT string_agg(DISTINCT k, ', ' ORDER BY k) FROM fraud_flags, jsonb_object_keys(evidence) k;`));
