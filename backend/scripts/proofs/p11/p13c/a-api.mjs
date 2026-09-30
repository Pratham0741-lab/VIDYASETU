// Phase 13C proof A2: GET /api/v1/audit/verify per caller; the response is a summary.
import { writeFileSync } from 'node:fs';
import { call, login } from '../lib.mjs';
const API = 'http://localhost:3000/api/v1';
const cases = [['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org'], ['SUPER_ADMIN', 'admin.p11@example.org'], ['DNO Ranchi', 'dno.ranchi.p11@example.org'], ['applicant', 'b1.arjun.p11@example.org'], ['no token', null]];
for (const [label, email] of cases) {
  let token = null;
  if (email) { try { token = await login(email); } catch (e) { console.log(`${label}: login failed ${e.message.slice(0, 80)}`); continue; } }
  const r = email ? await call('GET', '/audit/verify', undefined, token, { raw: true }) : await fetch(`${API}/audit/verify`).then(async (x) => ({ status: x.status, body: await x.json() }));
  writeFileSync(`responses/p13c/verify-${label.replace(/\W+/g, '-')}.json`, JSON.stringify(r, null, 1));
  const b = r.body;
  if (r.status !== 200) { console.log(`${label.padEnd(18)} HTTP ${r.status} ${b.code}`); continue; }
  console.log(`${label.padEnd(18)} HTTP 200 ok=${b.ok} | audit rows ${b.chain.rows} legacy ${b.legacy.rows} match=${b.legacy.matches_checkpoint} break=${b.first_break?.kind ?? null} | denials ok=${b.denials.ok} chain ${b.denials.chain.rows} legacy ${b.denials.legacy.rows}/${b.denials.legacy.checkpoint_rows} match=${b.denials.legacy.matches_checkpoint} break=${b.denials.first_break?.kind ?? null}`);
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, p + k + '.') : [p + k]));
  if (label === 'AUDITOR Jharkhand') console.log(`   response keys: ${keys(b).join(', ')}`);
}
