#!/usr/bin/env node
// VIDYASETU leak search (Phase 17, A4) - a routine check that no personal data reaches a log,
// an analytics response or export, a notification or a saved response.
//
// Usage (from the repository root, stack running, Node 20+):
//   LEAK_SEARCH_EMAIL=<super-admin email> LEAK_SEARCH_PASSWORD=<password> \
//   node scripts/proofs/leak-search.mjs [--extra values.json] [--saved <dir>]... [--exclude <file name>]... [--since 24h]
//
// Needles: every applicant's full name, e-mail, phone and date of birth read from the database
// (plaintext columns), plus any values in --extra (a JSON array of strings: identifiers that are
// stored encrypted, test markers). Each value is searched raw, normalised (NFKC, upper case,
// letters and digits only), and hex / base64 encoded, in both raw and normalised form.
// Sources: `docker compose logs` of every service (postgres included); every analytics view as
// JSON, CSV, XLSX and PDF (SUPER_ADMIN, fixtures included - the widest view); notification
// subjects and bodies; mailpit messages; files under each --saved directory, except those whose
// file name is given with --exclude (by-design holders, e.g. an applicant's own data export; every
// excluded file is listed in the output so the exclusion is never silent).
// Positive controls: the needles must be found where they are stored by design (applicants), and
// the scanner must find encoded forms of a sample value - otherwise the search itself is broken.
// Exit code 0 = no hits and controls pass; 1 = hits or a failed control.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';

const API = process.env.LEAK_SEARCH_API ?? 'http://127.0.0.1:3000/api/v1';
const MAILPIT = process.env.LEAK_SEARCH_MAILPIT ?? 'http://127.0.0.1:8025';
const args = process.argv.slice(2);
const argv = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []));
const since = argv('--since')[0];
const compose = (sub) =>
  execFileSync('docker', ['compose', ...sub], { maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
const psql = (sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { input: sql, maxBuffer: 1 << 28 })
    .toString()
    .trim();

// ------------------------------------------------------------------ needles
const rows = psql(`SELECT first_name||' '||last_name, coalesce(email,''), coalesce(phone,''), coalesce(to_char(dob,'YYYY-MM-DD'),'') FROM applicants;`)
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('|'));
const values = new Set();
for (const [name, email, phone] of rows) {
  if (name.trim().length >= 6) values.add(name.trim());
  if (email) values.add(email);
  if (phone.replace(/\D/g, '').length >= 8) values.add(phone);
}
for (const f of argv('--extra')) for (const v of JSON.parse(readFileSync(f, 'utf8'))) values.add(String(v));
const all = [...values];
const norm = (v) => v.normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{Nd}]/gu, '');
const b64 = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '');
const forms = (v) => [...new Set([v, norm(v), Buffer.from(v).toString('hex'), Buffer.from(norm(v)).toString('hex'), b64(v), b64(norm(v))])].filter((f) => f.length >= 6);
const needles = all.flatMap(forms);
const lowerNeedles = needles.map((n) => n.toLowerCase());
const normNeedles = all.map(norm).filter((n) => n.length >= 6);
function scan(text) {
  const lower = text.toLowerCase();
  const hits = new Set();
  lowerNeedles.forEach((x, i) => lower.includes(x) && hits.add(needles[i]));
  // Normalised matching line by line: joining separate lines (rows, log
  // entries) could otherwise fabricate a match across the boundary.
  for (const line of text.split('\n')) {
    const n = norm(line);
    if (n.length >= 6) normNeedles.forEach((x) => n.includes(x) && hits.add(x));
  }
  return [...hits];
}
const report = (label, text, results) => {
  const h = scan(text);
  results.push({ label, hits: h.length });
  console.log(`${label.padEnd(58)} ${String(text.length).padStart(10)} chars -> ${h.length ? `HIT ${h.slice(0, 5).join(', ')}${h.length > 5 ? ` (+${h.length - 5})` : ''}` : '0 hits'}`);
};

// ------------------------------------------------------------------ extractors
function unzipText(buf) {
  let out = '';
  for (let i = 0; i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50; ) {
    const method = buf.readUInt16LE(i + 8);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extra;
    const data = buf.subarray(start, start + size);
    out += (method === 8 ? inflateRawSync(data) : data).toString('utf8') + '\n';
    i = start + size;
  }
  return out;
}
function pdfText(buf) {
  const s = buf.toString('latin1');
  let out = s;
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const c = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
      for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) {
        out += '\n' + [...bt[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('');
      }
    } catch {
      /* not a Flate stream */
    }
  }
  return out;
}

// ------------------------------------------------------------------ run
const results = [];
console.log(`needles: ${all.length} values (${rows.length} applicants: names, e-mails, phones; ${argv('--extra').length} extra file(s)) x raw/normalised/hex/base64 = ${needles.length}`);

for (const svc of compose(['config', '--services']).split('\n').filter(Boolean)) {
  let logs = '';
  try {
    logs = compose(['logs', '--no-color', ...(since ? ['--since', since] : []), svc]);
  } catch {
    logs = '';
  }
  report(`logs: ${svc}`, logs, results);
}

const email = process.env.LEAK_SEARCH_EMAIL;
const password = process.env.LEAK_SEARCH_PASSWORD;
if (email && password) {
  let login;
  for (;;) {
    login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (login.status !== 429) break;
    const wait = [...login.headers].find(([k]) => k.startsWith('retry-after'))?.[1];
    await new Promise((r) => setTimeout(r, (Number(wait ?? 15) + 1) * 1000));
  }
  if (!login.ok) throw new Error(`leak search: login as ${email} -> HTTP ${login.status}`);
  const token = (await login.json()).access_token;
  const H = { Authorization: `Bearer ${token}` };
  // A throttled or failed call must not pass as "0 hits": wait out 429 (the EXPORT limit is per
  // account per minute and one run makes more export calls than that), fail on any other non-2xx.
  const get = async (url) => {
    for (;;) {
      const res = await fetch(url, { headers: H });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after') ?? 15) + 1) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`leak search: ${url.replace(API, '')} -> HTTP ${res.status}`);
      return res;
    }
  };
  // The views accept a window of at most 366 days: one window per calendar year that holds a
  // submitted application (a wider window is a 400, which get() refuses to scan as "0 hits").
  const years = psql(`SELECT string_agg(DISTINCT extract(year FROM submitted_at)::int::text, ',') FROM applications WHERE submitted_at IS NOT NULL;`)
    .split(',')
    .filter(Boolean);
  const windows = years.map((y) => `from=${y}-01-01&to=${Number(y) + 1}-01-01&include_fixtures=true`);
  const views = ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction', 'workload', 'verification-quality'];
  const text = { json: '', csv: '', xlsx: '', pdf: '' };
  for (const W of windows) for (const v of views) {
    text.json += await (await get(`${API}/analytics/${v}?${W}`)).text();
    text.csv += await (await get(`${API}/analytics/${v}/export.csv?${W}`)).text();
    text.xlsx += unzipText(Buffer.from(await (await get(`${API}/analytics/${v}/export.xlsx?${W}`)).arrayBuffer()));
    text.pdf += pdfText(Buffer.from(await (await get(`${API}/analytics/${v}/export.pdf?${W}`)).arrayBuffer()));
  }
  const pairs = psql(`SELECT string_agg(DISTINCT s.code||'|'||a.academic_year, ',') FROM applications a JOIN schemes s ON s.id=a.scheme_id;`);
  for (const p of pairs.split(',').filter(Boolean)) {
    const [scheme, year] = p.split('|');
    const q = `scheme=${scheme}&academic_year=${year}&include_fixtures=true`;
    text.json += await (await get(`${API}/analytics/fairness?${q}`)).text();
    text.xlsx += unzipText(Buffer.from(await (await get(`${API}/analytics/fairness/export.xlsx?${q}`)).arrayBuffer()));
    text.pdf += pdfText(Buffer.from(await (await get(`${API}/analytics/fairness/export.pdf?${q}`)).arrayBuffer()));
  }
  for (const [f, t] of Object.entries(text)) report(`analytics ${f} (every view${f === 'csv' ? '' : ' + fairness'})`, t, results);
} else {
  console.log('analytics: SKIPPED (set LEAK_SEARCH_EMAIL / LEAK_SEARCH_PASSWORD for a SUPER_ADMIN)');
}

report('notifications: subjects + bodies', psql(`SELECT coalesce(string_agg(subject||' '||body, E'\\n'), '') FROM notifications;`), results);
try {
  const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=5000`)).json();
  let mail = '';
  for (const m of list.messages ?? []) mail += (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()).Text + '\n' + m.Subject + '\n';
  report(`mailpit: ${list.messages?.length ?? 0} messages`, mail, results);
} catch {
  console.log('mailpit: SKIPPED (not reachable)');
}
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const excluded = new Set(argv('--exclude'));
for (const dir of argv('--saved')) {
  let t = '';
  for (const f of walk(dir)) {
    if (excluded.has(basename(f))) {
      console.log(`saved responses: EXCLUDED by name (by design): ${f}`);
      continue;
    }
    const b = readFileSync(f);
    t += f.endsWith('.xlsx') ? unzipText(b) : f.endsWith('.pdf') ? pdfText(b) : b.toString('utf8');
    t += '\n';
  }
  report(`saved responses: ${dir}`, t, results);
}

// ------------------------------------------------------------------ positive controls
const controls = [];
const stored = psql(`SELECT count(*) FROM applicants WHERE first_name||' '||last_name = '${(rows[0]?.[0] ?? '').replace(/'/g, "''")}';`);
controls.push(['a needle is found where it is stored by design (applicants)', stored !== '0' && scan(rows[0]?.[0] ?? '').length > 0]);
const sample = all.find((v) => v.includes('@')) ?? all[0] ?? 'control@example.org';
controls.push([`hex / base64 / normalised forms of "${sample.slice(0, 3)}…" are detected`, [Buffer.from(sample).toString('hex'), b64(sample), norm(sample).toLowerCase()].every((f) => scan(`xx ${f} yy`).length > 0)]);
for (const [label, ok] of controls) console.log(`positive control: ${label}: ${ok ? 'PASS' : 'FAIL'}`);

const hits = results.filter((r) => r.hits > 0);
const failed = controls.filter(([, ok]) => !ok);
console.log(`\nRESULT: ${hits.length} source(s) with hits, ${failed.length} failed control(s) -> ${hits.length || failed.length ? 'FAIL' : 'PASS'}`);
process.exit(hits.length || failed.length ? 1 : 0);
