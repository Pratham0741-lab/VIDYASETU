// Phase 13E proof 7: no PII in logs, analytics, fairness output, other users' notices or
// saved responses; a committee reason is the positive control (stored, sent only to its owner).
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const REASON = 'attested research score was verified with the university';
const values = {
  names: ['Karma Oraon', 'Somra Toppo', 'Rupa Kerketta', 'Mithun Ekka', 'Pushpa Lakra', 'Etwa Oraon', 'Sukhmani Tirkey', 'Dukhni Soren', 'Birsa Kujur', 'Lalita Minz', 'Chotu Oraon', 'Hiramani Tete'],
  identifiers: ['JH-ST-2026-13S', 'JH-ST-2026-13M', 'JH-ST-2026-13F', 'SBIN0004455:13S0', 'SBIN0004455:13M0', 'SBIN0004455:13F0', 'INC-JH-2024-13E01'],
  reason: [REASON],
};
const all = Object.values(values).flat();
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = all.flatMap(forms);
const scan = (text) => [...new Set([...needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())), ...all.filter((v) => norm(text).includes(norm(v)))])];
const show = (h) => (h.length ? 'HIT ' + h.join(',') : '0 hits');
console.log(`needles: ${all.length} values (${values.names.length} names, ${values.identifiers.length} identifiers, 1 committee reason) x raw/normalised/hex/base64 = ${needles.length}`);

// 1. analytics + fairness (fresh; SUPER_ADMIN with fixtures - the widest view)
const sa = await login('admin.p11@example.org');
let blob = '';
for (const v of ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction']) {
  const j = await call('GET', `/analytics/${v}?from=2026-01-01&to=2026-12-31&include_fixtures=true`, undefined, sa, { raw: true });
  const c = await fetch(`http://localhost:3000/api/v1/analytics/${v}/export.csv?from=2026-01-01&to=2026-12-31&include_fixtures=true`, { headers: { Authorization: `Bearer ${sa}` } });
  blob += JSON.stringify(j.body) + (await c.text());
}
console.log(`analytics: 6 JSON + 6 CSV (${blob.length} bytes) -> ${show(scan(blob))}`);
let fb = '';
for (const [sc, yr] of [['TOP_CLASS', '2033-34'], ['NFST', '2031-32'], ['NFST', '2032-33']]) {
  const j = await call('GET', `/analytics/fairness?scheme=${sc}&academic_year=${yr}&include_fixtures=true`, undefined, sa, { raw: true });
  const c = await fetch(`http://localhost:3000/api/v1/analytics/fairness/export.csv?scheme=${sc}&academic_year=${yr}&include_fixtures=true`, { headers: { Authorization: `Bearer ${sa}` } });
  fb += JSON.stringify(j.body) + (await c.text());
}
console.log(`fairness: 3 JSON + 3 CSV (${fb.length} bytes) -> ${show(scan(fb))}`);

// 2. saved responses
const files = readdirSync('responses/p13e');
const hits = files.map((f) => [f, scan(readFileSync(`responses/p13e/${f}`).toString('latin1'))]).filter(([, h]) => h.length);
console.log(`saved responses: ${files.length} files -> ${hits.length ? hits.map(([f, h]) => `${f}: ${h.join(',')}`).join('; ') : '0 hits'}`);

// 3. logs
for (const svc of ['api', 'ml', 'postgres', 'redis', 'minio', 'mailpit']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  const L = logs.split('\n');
  const ctl = svc === 'api' ? ` [window: ${L.filter((l) => l.includes('committee decision')).length} 'committee decision', ${L.filter((l) => l.includes('final list published')).length} 'final list published', ${L.filter((l) => l.includes('fairness query')).length} 'fairness query' lines]` : '';
  console.log(`logs ${svc.padEnd(9)} ${String(L.length).padStart(6)} lines -> ${show(scan(logs))}${ctl}`);
}
const apiLogs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29 }).toString().split('\n');
const sample = apiLogs.find((l) => l.includes('committee decision'));
console.log(`  sample committee log line: ${sample ? sample.replace(/^.*?\{/, '{').replace(/"time":"[^"]*",/, '') : '(none in this api log window)'}`);

// 4. notification bodies
const bodies = psql(`SELECT string_agg(subject||' '||body, E'\\n') FROM notifications WHERE body NOT LIKE '%${REASON}%';`);
console.log(`notification subjects + bodies other than the reason's own notice (${psql('SELECT count(*) FROM notifications;')} rows total) -> ${show(scan(bodies))}`);
console.log('  the committee reason in notifications: ' + psql(`SELECT count(*)||' rows, templates '||coalesce(string_agg(DISTINCT n.template_key, ','),'-')||', all to the objecting applicant: '||coalesce(bool_and(n.recipient_account_id = p.user_id), true) FROM notifications n JOIN applications a ON a.id = n.application_id JOIN applicants p ON p.id = a.applicant_id WHERE n.body LIKE '%${REASON}%';`));
console.log('  list notices naming another application: ' + psql(`SELECT count(*) FROM notifications n JOIN applications other ON other.id <> n.application_id WHERE n.template_key LIKE 'selection.list_%' AND position(other.application_no IN n.subject || n.body) > 0;`));

// 5. mailpit
const list = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=1000').then((r) => r.json());
let mail = '';
let reasonMail = 0;
for (const m of list.messages) {
  const text = (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`).then((r) => r.json())).Text + '\n' + m.Subject + '\n';
  if (text.includes(REASON)) reasonMail++;
  else mail += text;
}
console.log(`mailpit: ${list.messages.length} emails (${reasonMail} carrying the reason, to its owner) -> others ${show(scan(mail))}`);

// 6. tables (where the values are stored)
const rels = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
const arr = `ARRAY[${needles.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]`;
const t = [];
for (const r of rels) { const c = psql(`SELECT count(*) FROM "${r}" x WHERE row_to_json(x)::text ILIKE ANY(${arr});`); if (c !== '0') t.push(`${r}=${c}`); }
console.log(`tables (${rels.length}) with a needle: ${t.join(', ') || 'none'}`);

// 7. positive controls
console.log('positive controls:');
console.log(`  'Lalita' in applicants.first_name (plaintext by design): ${psql(`SELECT count(*) FROM applicants WHERE first_name='Lalita';`)}`);
console.log(`  the committee reason in selection_committee_decisions.reason: ${psql(`SELECT count(*) FROM selection_committee_decisions WHERE reason LIKE '%${REASON}%';`)}`);
console.log(`  'Karma Oraon' read by real OCR from the PDF into extracted_data (Phase 7 design): ${psql(`SELECT count(*) FROM document_extractions WHERE extracted_data::text LIKE '%Karma Oraon%';`)}`);
console.log(`  scanner on base64 of 'Lalita Minz': ${scan(Buffer.from('Lalita Minz').toString('base64')).length}; hex of 'Chotu Oraon': ${scan(Buffer.from('Chotu Oraon').toString('hex')).length}; 'HIRAMANI-TETE': ${scan('HIRAMANI-TETE').length}`);
