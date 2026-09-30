// Phase 13D proof 8: no PII in logs, analytics, saved responses or notification bodies
// beyond what is intentionally sent to its owner.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const values = {
  names: ['Mangal Oraon', 'Sunil Bara', 'Budhu Minz', 'Sarita Kujur', 'Jyoti Tirkey'],
  identifiers: ['JH-ST-2026-13D', 'JH-ST-2026-13L', 'SBIN0004455:13D0', 'SBIN0004455:13L0', 'INC-JH-2024-13D01', 'INC-JH-2026-13D02', 'INC-JH-2024-13D03', 'INC-JH-2026-13D04'],
  phones: ['9876543101', '9876543102', '9876543201'],
};
const all = Object.values(values).flat();
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = all.flatMap(forms);
const scan = (text) => [...new Set([...needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())), ...all.filter((v) => norm(text).includes(norm(v)))])];
console.log(`needles: ${all.length} values (${values.names.length} names, ${values.identifiers.length} identifiers, ${values.phones.length} phones) x raw/normalised/hex/base64 = ${needles.length}`);

// 1. analytics (fresh)
let aBlob = '';
for (const who of ['admin.p11@example.org', 'auditor.jharkhand.p11@example.org', 'ino.ranchi.p11@example.org']) {
  const t = await login(who);
  for (const v of ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction']) {
    const j = await call('GET', `/analytics/${v}?from=2026-01-01&to=2026-12-31`, undefined, t, { raw: true });
    const c = await fetch(`http://localhost:3000/api/v1/analytics/${v}/export.csv?from=2026-01-01&to=2026-12-31`, { headers: { Authorization: `Bearer ${t}` } });
    writeFileSync(`responses/p13d/analytics-${who.split('.')[0]}-${v}.json`, JSON.stringify(j, null, 1));
    aBlob += JSON.stringify(j.body) + (await c.text());
  }
}
console.log(`analytics: 18 JSON + 18 CSV (${aBlob.length} bytes) -> ${scan(aBlob).length ? 'HIT ' + scan(aBlob).join(',') : '0 hits'}`);

// 2. saved responses (JSON and the crop PNGs, as bytes)
const files = readdirSync('responses/p13d');
const hits = files.map((f) => [f, scan(readFileSync(`responses/p13d/${f}`).toString('latin1'))]).filter(([, h]) => h.length);
console.log(`saved responses: ${files.length} files (${files.filter((f) => f.endsWith('.png')).length} PNG crops) -> ${hits.length ? hits.map(([f, h]) => `${f}: ${h.join(',')}`).join('; ') : '0 hits'}`);

// 3. logs
for (const svc of ['api', 'ml', 'postgres', 'redis', 'minio', 'mailpit']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  const L = logs.split('\n');
  const ctl = svc === 'api' ? ` [window: ${L.filter((l) => l.includes('applicant profile updated')).length} 'applicant profile updated', ${L.filter((l) => l.includes('deficiency crop served')).length} 'deficiency crop served', ${L.filter((l) => l.includes('notification language fallback')).length} 'language fallback' lines]` : '';
  const h = scan(logs);
  console.log(`logs ${svc.padEnd(9)} ${String(L.length).padStart(6)} lines -> ${h.length ? 'HIT ' + h.join(',') : '0 hits'}${ctl}`);
}
const profileLine = execFileSync('docker', ['compose', 'logs', '--no-color', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29 }).toString().split('\n').find((l) => l.includes('applicant profile updated'));
console.log(`  sample profile log line: ${profileLine?.replace(/^.*?\{/, '{').replace(/"time":"[^"]*",/, '')}`);

// 4. notification bodies and subjects (every row)
const bodies = psql(`SELECT string_agg(subject||' '||body, E'\\n') FROM notifications;`);
console.log(`notification subjects + bodies (${psql('SELECT count(*) FROM notifications;')} rows) -> ${scan(bodies).length ? 'HIT ' + scan(bodies).join(',') : '0 hits'}`);
console.log('  phones in notifications only as the owner\'s own SMS address: ' + psql(`SELECT count(*)||' rows, all SMS to the owner: '||coalesce(bool_and(n.channel='SMS' AND n.recipient_account_id=p.user_id AND n.recipient_address=p.phone), true) FROM notifications n LEFT JOIN applicants p ON p.user_id = n.recipient_account_id WHERE n.recipient_address IN ('${values.phones.join("','")}');`));
console.log('  crop links in notices point at the notice\'s own application: ' + psql(`SELECT count(*)||' notices with a crop link; pointing elsewhere: '||count(*) FILTER (WHERE position(application_id::text IN body) = 0) FROM notifications WHERE body LIKE '%/deficiencies/items/%/crop%';`));

// 5. mailpit
const list = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=800').then((r) => r.json());
let mail = '';
for (const m of list.messages) mail += (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`).then((r) => r.json())).Text + '\n' + m.Subject + '\n';
console.log(`mailpit: ${list.messages.length} emails -> ${scan(mail).length ? 'HIT ' + scan(mail).join(',') : '0 hits'}`);

// 6. tables (where the values are stored, by design)
const rels = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
const arr = `ARRAY[${needles.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]`;
const t = [];
for (const r of rels) { const c = psql(`SELECT count(*) FROM "${r}" x WHERE row_to_json(x)::text ILIKE ANY(${arr});`); if (c !== '0') t.push(`${r}=${c}`); }
console.log(`tables (${rels.length}) with a needle: ${t.join(', ') || 'none'}`);
console.log('  applicant_profile_changes rows hold field names only: ' + psql(`SELECT string_agg(DISTINCT array_to_string(changed_fields, '+'), ', ') FROM applicant_profile_changes;`));

// 7. positive controls
console.log('positive controls:');
console.log(`  'Sarita' in applicants.first_name (plaintext by design): ${psql(`SELECT count(*) FROM applicants WHERE first_name='Sarita';`)}`);
console.log(`  LG1's current phone in applicants.phone (by design): ${psql(`SELECT count(*) FROM applicants WHERE phone='9876543102';`)}`);
console.log(`  'Mangal Oraon' read by real OCR into document_extractions.extracted_data (Phase 7 design): ${psql(`SELECT count(*) FROM document_extractions WHERE extracted_data::text LIKE '%Mangal Oraon%';`)}`);
console.log(`  scanner on base64 of a phone: ${scan(Buffer.from('9876543101').toString('base64')).length}; on hex of 'Budhu Minz': ${scan(Buffer.from('Budhu Minz').toString('hex')).length}; on 'SARITA-KUJUR': ${scan('SARITA-KUJUR').length}`);
