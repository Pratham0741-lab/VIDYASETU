// Phase 13B proof 5: override reasons are stored, never logged, never in analytics.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const API = 'http://localhost:3000/api/v1';
const values = ['LEAKCHECK-8R5W', 'LEAKCHECK-7Q4Z', 'Balram Toppo', '9876501234', 'lack the photograph page'];
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = values.flatMap(forms);
const hitsIn = (text) => needles.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
// normalised haystack too, so a value split by punctuation/case still matches
const scan = (text) => [...new Set([...hitsIn(text), ...values.filter((v) => norm(text).includes(norm(v)))])];
console.log(`needles: ${values.length} values x (raw, normalised, hex, base64 of both) = ${needles.length}`);

// 1. analytics: every JSON view and CSV export, fresh, as SUPER_ADMIN and AUDITOR
const views = ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction'];
let aBlob = '';
for (const who of ['admin.p11@example.org', 'auditor.jharkhand.p11@example.org']) {
  const t = await login(who);
  for (const v of views) {
    const j = await call('GET', `/analytics/${v}?from=2026-01-01&to=2026-12-31`, undefined, t, { raw: true });
    const c = await fetch(`${API}/analytics/${v}/export.csv?from=2026-01-01&to=2026-12-31`, { headers: { Authorization: `Bearer ${t}` } });
    const csv = await c.text();
    writeFileSync(`responses/p13b/analytics-${who.split('.')[0]}-${v}.json`, JSON.stringify(j, null, 1));
    writeFileSync(`responses/p13b/analytics-${who.split('.')[0]}-${v}.csv`, csv);
    if (j.status !== 200 || c.status !== 200) console.log(`  ${who} ${v}: json ${j.status} csv ${c.status}`);
    aBlob += JSON.stringify(j.body) + '\n' + csv + '\n';
  }
}
console.log(`analytics: ${views.length * 2} JSON + ${views.length * 2} CSV responses (${aBlob.length} bytes) -> ${scan(aBlob).length ? 'HIT ' + scan(aBlob).join(',') : '0 hits'}`);

// 2. saved responses of the Phase 13B proofs (actors' own API responses)
const files = readdirSync('responses/p13b').filter((f) => !f.startsWith('analytics-'));
const saved = files.map((f) => [f, scan(readFileSync(`responses/p13b/${f}`, 'utf8'))]).filter(([, h]) => h.length);
console.log(`saved proof responses: ${files.length} files -> ${saved.length ? saved.map(([f, h]) => `${f}: ${h.length} needle(s)`).join('; ') : '0 hits'}`);

// 3. logs of every compose service
for (const svc of ['api', 'ml', 'postgres', 'redis', 'minio', 'mailpit', 'db-migrate']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  const h = scan(logs);
  const L = logs.split('\n');
  if (svc === 'api') console.log(`  log window control: api log lines for POST /bulk-actions ${L.filter((l) => l.includes('bulk-actions')).length}, for /reject ${L.filter((l) => l.includes('/reject')).length}, bulk summary lines ${L.filter((l) => l.includes('bulk action')).length}`);
  console.log(`logs ${svc.padEnd(10)} ${String(logs.split('\n').length).padStart(7)} lines -> ${h.length ? 'HIT ' + h.join(',') : '0 hits'}`);
}

// 4. every table and materialised view, row text
const rels = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' UNION ALL SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY 1;`).split('\n');
const arr = `ARRAY[${needles.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]`;
const hitRels = [];
for (const t of rels) {
  const c = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE ANY(${arr});`);
  if (c !== '0') hitRels.push(`${t}=${c}`);
}
console.log(`tables + matviews: ${rels.length} -> rows containing a needle: ${hitRels.join(', ') || 'none'}`);
console.log('  audit rows by table: ' + psql(`SELECT string_agg(table_name||'='||n, ', ' ORDER BY table_name) FROM (SELECT table_name, count(*) n FROM audit_logs x WHERE row_to_json(x)::text ILIKE ANY(${arr}) GROUP BY 1) t;`));
console.log('  notifications by template: ' + psql(`SELECT coalesce(string_agg(k||'='||n, ', '), 'none') FROM (SELECT coalesce(row_to_json(x)->>'template_key', row_to_json(x)->>'type', '?') k, count(*) n FROM notifications x WHERE row_to_json(x)::text ILIKE ANY(${arr}) GROUP BY 1) t;`));

// 5. positive control: the same needles find the stored reasons
console.log('positive control (stored reasons found by the same search):');
console.log('  decision_records.remarks: ' + psql(`SELECT count(*) FROM decision_records WHERE remarks ILIKE ANY(ARRAY['%LEAKCHECK-7Q4Z%','%LEAKCHECK-8R5W%']);`));
console.log('  document_extractions.confirmation_reason: ' + psql(`SELECT count(*) FROM document_extractions WHERE confirmation_reason ILIKE ANY(ARRAY['%LEAKCHECK-7Q4Z%','%LEAKCHECK-8R5W%']);`));
console.log('  the scanner on a line holding the marker in base64: ' + scan(`x ${Buffer.from('LEAKCHECK-7Q4Z').toString('base64')} y`).length + ' hit(s); on the hex of "Balram Toppo": ' + scan(Buffer.from('Balram Toppo').toString('hex')).length + ' hit(s)');
