// Phase 13C proof 7: no PII (or reason text) in logs, analytics, other users' notices or saved responses.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const keys = ['H1', 'H2', 'E1', 'S1', 'BA1', 'BA2', 'BA3'];
const people = { H1: 'Phulmani Kisku', H2: 'Salomi Marandi', E1: 'Rohit Lakra', S1: 'Sumitra Murmu', BA1: 'Anita Tudu', BA2: 'Birsa Soren', BA3: 'Chandmuni Hansda' };
// Identifiers registered by c-setup.mjs: every caste certificate / bank account
// starts with these prefixes (the exact values are encrypted at rest); H2's phone.
const values = {
  names: Object.values(people),
  identifiers: ['JH-ST-2026-13C', 'SBIN0004455:13C0', '9876543013'],
  reason: ['LEAKCHECK-9D3F', 'Balram Toppo'],
};
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const allValues = [...values.names, ...values.identifiers, ...values.reason];
const needles = allValues.flatMap(forms);
const scan = (text) => [...new Set([...needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())), ...allValues.filter((v) => norm(text).includes(norm(v)))])];
console.log(`needles: ${allValues.length} values (${values.names.length} names, ${values.identifiers.length} identifiers, ${values.reason.length} reason markers) x raw/normalised/hex/base64 = ${needles.length}`);

// 1. analytics JSON + CSV, fresh
const views = ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction'];
let aBlob = '';
for (const who of ['admin.p11@example.org', 'auditor.jharkhand.p11@example.org', 'ino.ranchi.p11@example.org']) {
  const t = await login(who);
  for (const v of views) {
    const j = await call('GET', `/analytics/${v}?from=2026-01-01&to=2026-12-31`, undefined, t, { raw: true });
    const c = await fetch(`http://localhost:3000/api/v1/analytics/${v}/export.csv?from=2026-01-01&to=2026-12-31`, { headers: { Authorization: `Bearer ${t}` } });
    const csv = await c.text();
    if (j.status !== 200 || c.status !== 200) console.log(`   ${who} ${v}: json ${j.status} csv ${c.status}`);
    writeFileSync(`responses/p13c/analytics-${who.split('.')[0]}-${v}.json`, JSON.stringify(j, null, 1));
    aBlob += JSON.stringify(j.body) + '\n' + csv + '\n';
  }
}
console.log(`analytics: 18 JSON + 18 CSV (${aBlob.length} bytes) -> ${scan(aBlob).length ? 'HIT ' + scan(aBlob).join(',') : '0 hits'}`);

// 2. saved responses of the Phase 13C proofs
const files = readdirSync('responses/p13c');
const saved = files.map((f) => [f, scan(readFileSync(`responses/p13c/${f}`, 'utf8'))]).filter(([, h]) => h.length);
console.log(`saved responses: ${files.length} files -> ${saved.length ? saved.map(([f, h]) => `${f}: ${h.join(',')}`).join('; ') : '0 hits'}`);

// 3. logs of every service
for (const svc of ['api', 'ml', 'postgres', 'redis', 'minio', 'mailpit']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  const L = logs.split('\n');
  const h = scan(logs);
  const ctl = svc === 'api' ? ` [window control: ${L.filter((l) => l.includes('itemised deficiency issued')).length} 'itemised deficiency issued', ${L.filter((l) => l.includes('deficiency recheck')).length} 'deficiency recheck', ${L.filter((l) => l.includes('MOCK SMS')).length} 'MOCK SMS' lines]` : '';
  console.log(`logs ${svc.padEnd(9)} ${String(L.length).padStart(6)} lines -> ${h.length ? 'HIT ' + h.join(',') : '0 hits'}${ctl}`);
}

// 4. notices: no PII in any notification body; no other application's number in a deficiency notice
const notif = psql(`SELECT string_agg(subject||' '||body, E'\\n') FROM notifications;`);
console.log(`notifications (all ${psql('SELECT count(*) FROM notifications;')} rows, every template) -> ${scan(notif).length ? 'HIT ' + scan(notif).join(',') : '0 hits'}`);
const cross = psql(`SELECT count(*) FROM notifications n JOIN applications other ON other.id <> n.application_id WHERE n.template_key = 'DEFICIENCY_NOTICE' AND position(other.application_no IN n.subject || n.body) > 0;`);
console.log(`deficiency notices (${psql(`SELECT count(*) FROM notifications WHERE template_key='DEFICIENCY_NOTICE';`)}) naming ANOTHER application's number: ${cross}`);
const recips = psql(`SELECT count(*) FROM notifications n JOIN applications a ON a.id = n.application_id JOIN applicants p ON p.id = a.applicant_id WHERE n.template_key = 'DEFICIENCY_NOTICE' AND n.recipient_account_id <> p.user_id;`);
console.log(`deficiency notices delivered to someone other than the application's applicant: ${recips}`);

// 5. Mailpit (delivered emails)
const list = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=500').then((r) => r.json());
let mail = '';
for (const m of list.messages) mail += (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`).then((r) => r.json())).Text + '\n' + m.Subject + '\n';
console.log(`mailpit: ${list.messages.length} emails -> ${scan(mail).length ? 'HIT ' + scan(mail).join(',') : '0 hits'}`);

// 6. tables: where the values are stored (expected: by design)
const rels = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
const arr = `ARRAY[${needles.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]`;
const hitRels = [];
for (const t of rels) {
  const c = psql(`SELECT count(*) FROM "${t}" x WHERE row_to_json(x)::text ILIKE ANY(${arr});`);
  if (c !== '0') hitRels.push(`${t}=${c}`);
}
console.log(`tables (${rels.length}) with rows containing a needle: ${hitRels.join(', ') || 'none'}`);
const reasonArr = `ARRAY['%LEAKCHECK-9D3F%','%Balram Toppo%']`;
console.log('   reason marker only in: ' + psql(`SELECT string_agg(t||'='||n, ', ') FROM (SELECT 'decision_records.remarks' t, count(*) n FROM decision_records WHERE remarks ILIKE ANY(${reasonArr}) UNION ALL SELECT 'deficiency_items.officer_reason', count(*) FROM deficiency_items WHERE officer_reason ILIKE ANY(${reasonArr}) UNION ALL SELECT 'audit_logs('||string_agg(DISTINCT table_name, '/')||')', count(*) FROM audit_logs x WHERE row_to_json(x)::text ILIKE ANY(${reasonArr}) UNION ALL SELECT 'notifications', count(*) FROM notifications x WHERE row_to_json(x)::text ILIKE ANY(${reasonArr})) s;`));
console.log('   names only in: ' + psql(`SELECT string_agg(t||'='||n, ', ') FROM (SELECT 'applicants' t, count(*) n FROM applicants x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${values.names.map((n) => `'%${n.split(' ')[0]}%'`).join(',')}]) UNION ALL SELECT 'document_extractions.extracted_data', count(*) FROM document_extractions x WHERE extracted_data::text ILIKE ANY(ARRAY[${values.names.map((n) => `'%${n}%'`).join(',')}]) UNION ALL SELECT 'deficiency_items', count(*) FROM deficiency_items x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${values.names.map((n) => `'%${n}%'`).join(',')}]) UNION ALL SELECT 'notifications', count(*) FROM notifications x WHERE row_to_json(x)::text ILIKE ANY(ARRAY[${values.names.map((n) => `'%${n}%'`).join(',')}])) s;`));

// 7. positive controls
console.log('positive controls (the same scanner finds what is there):');
console.log(`   'Phulmani' in applicants (plaintext first_name, by design): ${psql(`SELECT count(*) FROM applicants WHERE first_name = 'Phulmani';`)} row`);
console.log(`   reason marker in decision_records.remarks: ${psql(`SELECT count(*) FROM decision_records WHERE remarks LIKE '%LEAKCHECK-9D3F%';`)}`);
console.log(`   scanner on the base64 of the marker: ${scan('zz ' + Buffer.from('LEAKCHECK-9D3F').toString('base64') + ' zz').length} hit(s); on the hex of 'Rohit Lakra': ${scan(Buffer.from('Rohit Lakra').toString('hex')).length}; on 'ROHIT-LAKRA': ${scan('ROHIT-LAKRA').length}`);
