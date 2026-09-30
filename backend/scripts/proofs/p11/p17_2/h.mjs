// Phase 17.2 proof helpers (self-contained; the older ../lib.mjs still points at the
// pre-move path D:/PROJECTS/SIH_FELLOWSHIP and is left untouched).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
export const REPO = 'D:/PROJECTS/vidyasetu/backend';
export const API = 'http://127.0.0.1:3000/api/v1';
const DIR = 'D:/PROJECTS/vidyasetu/.p11/';
export const PW = readFileSync(DIR + 'pw.env', 'utf8').match(/PW=(.*)/)[1].trim();
const TOK = DIR + 'p17_2/tokens.json';
const tokens = existsSync(TOK) ? JSON.parse(readFileSync(TOK, 'utf8')) : {};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function req(method, path, { token, body, raw = false } = {}) {
  for (;;) {
    const res = await fetch(API + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) { const h = [...res.headers].find(([k]) => k.startsWith('retry-after')); await sleep((Number(h?.[1] ?? 15) + 1) * 1000); continue; }
    if (raw) return res;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, headers: res.headers };
  }
}
export async function login(email) {
  const t = tokens[email];
  if (t && Date.now() - t.at < 10 * 60 * 1000) return t.token;
  const r = await req('POST', '/auth/login', { body: { email, password: PW } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  tokens[email] = { token: r.body.access_token, at: Date.now() };
  writeFileSync(TOK, JSON.stringify(tokens));
  return r.body.access_token;
}
/** Owner-level SQL, read-only use in proofs (and tagging of fixture rows). */
export const psql = (sql) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q -v ON_ERROR_STOP=1'], { cwd: REPO, input: sql }).toString().trim();
/** As app_user with a given actor (email or null = no actor) and role, inside a rolled-back transaction. */
export function asUser(email, role, sql) {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  try {
    return execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: REPO, input: `SET ROLE app_user; BEGIN; SELECT 'actor-set:'||set_config('app.actor_id', ${actor}, true)||'/'||set_config('app.actor_role', '${role}', true);\n${sql}; ROLLBACK;` }).toString().trim().split('\n').filter((l) => !l.startsWith('actor-set:')).join(' | ') || '(no rows)';
  } catch (e) { return String(e.stderr ?? e.message).split('\n')[0]; }
}
export const line = (label, r, extra = '') => console.log(`${label.padEnd(64)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
