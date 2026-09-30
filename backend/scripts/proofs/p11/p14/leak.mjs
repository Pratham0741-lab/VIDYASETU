// Phase 14 proof 2: no PII and no Aadhaar value in logs, analytics, notification bodies or
// saved responses. Raw / normalised / hex / base64 forms of every value, with positive controls.
import { readdirSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const values = {
  names: ['Sumi Hansda', 'Anjali Tudu', 'Bandhan Tudu', 'Charu Tudu', 'Dulari Tudu', 'Eshwar Tudu', 'Fagu Tudu', 'Gita Murmu', 'Hira Murmu', 'Sushila Baskey', 'Birsa Hembrom', 'Test Holder One'],
  identifiers: ['JH-ST-2026-14A001', ...[600, 601, 602, 603, 604, 605].map((n) => `JH-ST-2026-14B${n}`), 'JH-ST-2026-14C700', 'JH-ST-2026-14C701', 'JH-ST-2026-14D801', 'JH-ST-2026-14E900', 'JH-ST-2026-14E901',
    'SBIN0004455:14A0010', ...[600, 601, 602, 603, 604, 605].map((n) => `SBIN0004455:14B0${n}0`), 'SBIN0004455:14C07000', 'SBIN0004455:14C07010', 'SBIN0004455:14D08010', 'SBIN0004455:14E09000', 'SBIN0004455:14E09010'],
  aadhaar: ['0999 0000 0017', '0999 0000 0040', '0999 0000 0038', '2363 4717 1230', '2363 4717 1234'],
};
const all = Object.values(values).flat();
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = all.flatMap(forms);
const scan = (text) => [...new Set([...needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())), ...all.filter((v) => norm(text).includes(norm(v)))])];
const show = (h) => (h.length ? 'HIT ' + h.join(',') : '0 hits');
console.log(`needles: ${all.length} values (${values.names.length} names, ${values.identifiers.length} caste certificate / bank identifiers, ${values.aadhaar.length} Aadhaar numbers incl. 2 realistic ones) x raw/normalised/hex/base64 = ${needles.length}`);

// 1. analytics + fairness (SUPER_ADMIN, fixtures included - the widest view)
const sa = await login('admin.p11@example.org');
let blob = '';
for (const v of ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction']) {
  const j = await call('GET', `/analytics/${v}?from=2026-01-01&to=2027-01-01&include_fixtures=true`, undefined, sa, { raw: true });
  const c = await fetch(`http://127.0.0.1:3000/api/v1/analytics/${v}/export.csv?from=2026-01-01&to=2027-01-01&include_fixtures=true`, { headers: { Authorization: `Bearer ${sa}` } });
  blob += JSON.stringify(j.body) + (await c.text());
}
for (const [sc, yr] of [['TOP_CLASS', '2026-27'], ['NFST', '2034-35']]) {
  const j = await call('GET', `/analytics/fairness?scheme=${sc}&academic_year=${yr}&include_fixtures=true`, undefined, sa, { raw: true });
  blob += JSON.stringify(j.body);
}
console.log(`analytics: 6 JSON + 6 CSV + 2 fairness (${blob.length} bytes) -> ${show(scan(blob))}`);

// 2. saved responses of this phase
const files = readdirSync('responses/p14');
const byFile = files.map((f) => [f, scan(readFileSync(`responses/p14/${f}`).toString('latin1'))]).filter(([, h]) => h.length);
console.log(`saved responses: ${files.length} files -> ${byFile.length ? byFile.map(([f, h]) => `${f}: ${h.join(',')}`).join('; ') : '0 hits'}`);

// 3. logs of every service
for (const svc of ['api', 'ml', 'postgres', 'redis', 'minio', 'mailpit']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  console.log(`logs ${svc.padEnd(9)} ${String(logs.split('\n').length).padStart(6)} lines -> ${show(scan(logs))}`);
}

// 4. notification bodies (stored) and mailpit
const bodies = psql(`SELECT string_agg(subject||' '||body, E'\\n') FROM notifications;`);
console.log(`notification subjects + bodies (${psql('SELECT count(*) FROM notifications;')} rows) -> ${show(scan(bodies))}`);
const list = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=2000').then((r) => r.json());
let mail = '';
for (const m of list.messages) mail += (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`).then((r) => r.json())).Text + '\n' + m.Subject + '\n';
console.log(`mailpit: ${list.messages.length} emails -> ${show(scan(mail))}`);

// 5. tables: where the values are stored (by design or not)
const rels = psql(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1;`).split('\n');
const aadhaarForms = values.aadhaar.flatMap(forms);
const arrAll = `ARRAY[${needles.map((n) => `'%${n.replace(/'/g, "''")}%'`).join(',')}]`;
const arrAadhaar = `ARRAY[${aadhaarForms.map((n) => `'%${n}%'`).join(',')}]`;
const t = [];
const ta = [];
for (const r of rels) {
  const c = psql(`SELECT count(*) FROM "${r}" x WHERE row_to_json(x)::text ILIKE ANY(${arrAll});`);
  if (c !== '0') t.push(`${r}=${c}`);
  const a = psql(`SELECT count(*) FROM "${r}" x WHERE row_to_json(x)::text ILIKE ANY(${arrAadhaar});`);
  if (a !== '0') ta.push(`${r}=${a}`);
}
console.log(`tables (${rels.length}) with any needle: ${t.join(', ') || 'none'}`);
console.log(`tables (${rels.length}) with an Aadhaar number form: ${ta.join(', ') || 'none'}`);

// 6. positive controls
console.log('positive controls:');
console.log(`  'Sushila' in applicants.first_name (plaintext by design): ${psql(`SELECT count(*) FROM applicants WHERE first_name='Sushila';`)}`);
console.log(`  'Sushila Baskey' in the sanction order content (the order names its scholar, by design): ${psql(`SELECT count(*) FROM sanction_orders WHERE content->>'applicant_name'='Sushila Baskey';`)}`);
const key = execFileSync('docker', ['compose', 'exec', '-T', 'api', 'printenv', 'FRAUD_MATCH_KEY'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().trim();
const h = createHmac('sha256', Buffer.from(key, 'base64')).update('aadhaar\u0000099900000017', 'utf8').digest('hex');
console.log(`  HMAC('aadhaar', 099900000017) recomputed here is the stored uid_hmac: ${psql(`SELECT count(*) FROM aadhaar_authentications WHERE uid_hmac='${h}';`)} rows (the key is read from the api container, never printed)`);
console.log(`  scanner on base64 of 'Gita Murmu': ${scan(Buffer.from('Gita Murmu').toString('base64')).length}; hex of '0999 0000 0040': ${scan(Buffer.from('0999 0000 0040').toString('hex')).length}; '099900000038' (normalised): ${scan('099900000038').length}; 'fagu-tudu': ${scan('fagu-tudu').length}`);
