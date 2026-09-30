// Phase 7 proof harness (ML_MODE=mock). Real HTTP only. Fixture files are valid PNGs whose
// tEXt chunk carries the documented MOCK marker - results derived from them are MOCK output.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
const API = 'http://127.0.0.1:3000/api/v1';
const DIR = 'D:/PROJECTS/SIH_FELLOWSHIP/.phase8-proof/';
const PW = readFileSync(DIR + 'pw.env', 'utf8').match(/PW=(.*)/)[1].trim();
const STATE = DIR + 'p8-state.json';
export const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { tokens: {} };
export const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
/** A valid 8x8 grey PNG carrying a MOCK fixture marker in a tEXt chunk. */
export function fixturePng(marker) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array(8).fill(200)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`Comment\0VIDYASETU-MOCK-FIXTURE:${marker};END`, 'latin1')),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export const enc = encodeURIComponent;

export async function call(method, path, body, token, { raw = false } = {}) {
  for (;;) {
    const res = await fetch(API + path, { method, headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
    if (res.status === 429) { const w = Number(res.headers.get('retry-after') ?? 15); console.log(`  (429, waiting ${w}s)`); await sleep((w + 1) * 1000); continue; }
    const json = await res.json().catch(() => null);
    if (raw) return { status: res.status, body: json };
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
    return json;
  }
}
export async function login(email) {
  if (!state.tokens[email]) { state.tokens[email] = (await call('POST', '/auth/login', { email, password: PW })).access_token; save(); }
  return state.tokens[email];
}
export async function upload(token, appId, slot, marker, name = 'scan.png') {
  const fd = new FormData();
  fd.append('document_type', slot);
  fd.append('file', new Blob([fixturePng(marker)], { type: 'image/png' }), name);
  return call('POST', `/applications/${appId}/documents`, fd, token, { raw: true });
}
export async function waitProcessed(token, docId) {
  for (let i = 0; i < 60; i++) { const d = await call('GET', `/documents/${docId}`, undefined, token); if (d.state !== 'PROCESSING') return d; await sleep(1000); }
  throw new Error('document still PROCESSING after 60s');
}
export { PW };

export const VERSIONS = JSON.parse(readFileSync(DIR + 'versions.json', 'utf8'));
const SEED = JSON.parse(readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/prisma/scheme_versions_seed_v2.json', 'utf8'));
export const LEVELS = Object.fromEntries(['POST_MATRIC', 'NOS', 'NFST'].map((c) => [c, SEED.find((v) => v.scheme_code === c && v.effective_to == null).config.rules.find((r) => r.id === 'education_level_match').params.eligible_level]));
