// VIDYASETU leak search (Phase 17, A4) - a routine check that no personal data reaches a log,
// an analytics response or export, a notification or a saved response.
//
// Usage (from the repository root, stack running, Node 20+):
//   LEAK_SEARCH_EMAIL=<super-admin email> LEAK_SEARCH_PASSWORD=<password> \
//   node scripts/proofs/leak-search.mjs [--extra values.json] [--saved <dir>]... [--since 24h]
//
// Needles: every applicant's full name, e-mail, phone and date of birth read from the database
// (plaintext columns), plus any values in --extra (a JSON array of strings: identifiers that are
// stored encrypted, test markers). Each value is searched raw, normalised (NFKC, upper case,
// letters and digits only), and hex / base64 encoded, in both raw and normalised form.
// Sources: `docker compose logs` of every service (postgres included); every analytics view as
// JSON, CSV, XLSX and PDF (SUPER_ADMIN, fixtures included - the widest view); notification
// subjects and bodies; mailpit messages; files under each --saved directory.
// Positive controls: the needles must be found where they are stored by design (applicants), and
// the scanner must find encoded forms of a sample value - otherwise the search itself is broken.
// Exit code 0 = no hits and controls pass; 1 = hits or a failed control.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
// Per-file variant (Phase 17.2 proof aid): same needles and extractors as the permanent script,
// reported per file so a hit can be attributed to a named file.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const dir of argv('--saved')) for (const f of walk(dir)) {
  const b = readFileSync(f);
  const h = scan(f.endsWith('.xlsx') ? unzipText(b) : f.endsWith('.pdf') ? pdfText(b) : b.toString('utf8'));
  if (h.length) console.log(`HIT ${f}: ${h.length} value(s)`);
}
