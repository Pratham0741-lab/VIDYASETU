// Phase 16 proof 2: no PII in logs (Postgres included), analytics responses, every export format,
// notification bodies or saved responses. Raw / normalised / hex / base64, with positive controls.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const W = Array.from({ length: 12 }, (_, i) => `W${String(i + 1).padStart(2, '0')}`);
const values = {
  names: [...W.map((k) => `Wq${k} Oracle`), 'Sona Forest', 'Budhan Forest', 'Mangri Forest', 'Lakhan Forest', 'Paulus Forest', 'Somri Forest'],
  extracted: [...W.map((k) => `WQ CORRECTED ${k}`), 'WQ HOLDER W01 0'],
  identifiers: [...W.map((_, i) => `JH-ST-2026-16W${i + 1}0`), ...W.map((_, i) => `SBIN0004455:16W0${i + 1}00`), ...[1, 2, 3, 4, 5, 6].map((n) => `JH-ST-2026-16F${n}0`), ...[1, 2, 3, 4, 5, 6].map((n) => `SBIN0004455:16F0${n}00`)],
  aadhaar: ['0999 0000 0029', '0999 0000 0017'],
};
const all = Object.values(values).flat();
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), Buffer.from(v).toString('base64').replace(/=+$/, ''), Buffer.from(norm(v)).toString('base64').replace(/=+$/, '')])];
const needles = all.flatMap(forms);
const scan = (text) => [...new Set([...needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())), ...all.filter((v) => norm(text).includes(norm(v)))])];
const show = (h) => (h.length ? 'HIT ' + h.join(',') : '0 hits');
const pdfText = (buf) => { let out = ''; const s = buf.toString('latin1'); for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let c; try { c = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; } for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) out += [...bt[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('') + '\n'; } return out + s; };
const xlsxText = (buf) => execFileSync('python', ['-c', "import zipfile,io,sys\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nprint('\\n'.join(z.read(n).decode('utf8') for n in z.namelist()))"], { input: buf }).toString();
console.log(`needles: ${all.length} values (${values.names.length} names, ${values.extracted.length} extracted/corrected values, ${values.identifiers.length} caste certificate / bank identifiers, ${values.aadhaar.length} Aadhaar numbers) x raw/normalised/hex/base64 = ${needles.length}`);

// 1. analytics: JSON + CSV + XLSX + PDF of every view (SUPER_ADMIN, fixtures included - the widest view)
const sa = await login('admin.p11@example.org');
const views = [...['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction', 'workload', 'verification-quality'].map((v) => [v, 'from=2026-01-01&to=2027-01-01&include_fixtures=true']), ['fairness', 'scheme=FOREST_SCIENCE_P16&academic_year=2026-27&include_fixtures=true'], ['fairness', 'scheme=WQ_ORACLE_P16&academic_year=2026-27&include_fixtures=true']];
const per = { json: '', csv: '', xlsx: '', pdf: '' };
for (const [v, q] of views) {
  per.json += JSON.stringify((await call('GET', `/analytics/${v}?${q}`, undefined, sa, { raw: true })).body);
  for (const f of ['csv', 'xlsx', 'pdf']) {
    const buf = Buffer.from(await (await fetch(`http://127.0.0.1:3000/api/v1/analytics/${v}/export.${f}?${q}`, { headers: { Authorization: `Bearer ${sa}` } })).arrayBuffer());
    per[f] += f === 'csv' ? buf.toString('utf8') : f === 'xlsx' ? xlsxText(buf) : pdfText(buf);
  }
}
for (const [f, text] of Object.entries(per)) console.log(`analytics ${f.padEnd(4)} (${views.length} views, ${text.length} chars) -> ${show(scan(text))}`);

// 2. saved responses of this phase (json, xlsx, pdf)
const files = readdirSync('responses/p16');
const hits = files.map((f) => { const b = readFileSync(`responses/p16/${f}`); const t = f.endsWith('.xlsx') ? xlsxText(b) : f.endsWith('.pdf') ? pdfText(b) : b.toString('utf8'); return [f, scan(t)]; }).filter(([, h]) => h.length);
console.log(`saved responses: ${files.length} files -> ${hits.length ? hits.map(([f, h]) => `${f}: ${h.join(',')}`).join('; ') : '0 hits'}`);

// 3. logs of every service, the Postgres log included
for (const svc of ['api', 'postgres', 'ml', 'redis', 'minio', 'mailpit']) {
  let logs = '';
  try { logs = execFileSync('docker', ['compose', 'logs', '--no-color', svc], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { logs = ''; }
  console.log(`logs ${svc.padEnd(9)} ${String(logs.split('\n').length).padStart(6)} lines -> ${show(scan(logs))}`);
}

// 4. notification bodies and mailpit
const bodies = psql(`SELECT string_agg(subject||' '||body, E'\\n') FROM notifications;`);
console.log(`notification subjects + bodies (${psql('SELECT count(*) FROM notifications;')} rows) -> ${show(scan(bodies))}`);
const list = await fetch('http://127.0.0.1:8025/api/v1/messages?limit=3000').then((r) => r.json());
let mail = '';
for (const m of list.messages) mail += (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`).then((r) => r.json())).Text + '\n' + m.Subject + '\n';
console.log(`mailpit: ${list.messages.length} emails -> ${show(scan(mail))}`);

// 5. positive controls
console.log('positive controls:');
console.log(`  'WqW01' in applicants.first_name (plaintext by design): ${psql(`SELECT count(*) FROM applicants WHERE first_name='WqW01';`)}`);
console.log(`  'WQ CORRECTED W01' in document_extractions.extracted_data (officer correction, Phase 7 design): ${psql(`SELECT count(*) FROM document_extractions WHERE extracted_data->>'holder_name'='WQ CORRECTED W01';`)}`);
console.log(`  scanner on hex of 'Sona Forest': ${scan(Buffer.from('Sona Forest').toString('hex')).length}; base64 of 'WQ CORRECTED W07': ${scan(Buffer.from('WQ CORRECTED W07').toString('base64')).length}; '099900000029': ${scan('099900000029').length}; 'jh st 2026 16w30': ${scan('jh st 2026 16w30').length}`);
