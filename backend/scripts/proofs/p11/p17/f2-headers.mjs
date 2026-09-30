// Phase 17 F1 (rate limits) and F2 (security headers, CSP, HSTS, CORS) against the live api.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const BASE = 'http://127.0.0.1:3000';
const env = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'sh', '-c', 'echo "$CORS_ORIGINS|$SWAGGER_ENABLED|$NODE_ENV"'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).stdout.toString().trim().split('|');
const [origins, swagger, nodeEnv] = env;
console.log(`live config: CORS_ORIGINS=${origins} SWAGGER_ENABLED=${swagger} NODE_ENV=${nodeEnv}`);
const allowed = origins.split(',')[0];

const SHOW = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'origin-agent-cluster', 'x-dns-prefetch-control', 'x-download-options', 'x-permitted-cross-domain-policies', 'x-xss-protection', 'x-powered-by', 'server', 'cache-control', 'content-type', 'content-disposition', 'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers', 'access-control-max-age', 'vary'];
const dump = {};
async function show(label, path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  await res.arrayBuffer();
  const h = Object.fromEntries(SHOW.filter((k) => res.headers.has(k)).map((k) => [k, res.headers.get(k)]));
  dump[label] = { status: res.status, headers: h };
  console.log(`\n--- ${label}: ${opts.method ?? 'GET'} ${path} -> HTTP ${res.status}`);
  for (const k of SHOW) console.log(`  ${k.padEnd(34)} ${res.headers.get(k) ?? '(absent)'}`);
  return res;
}

const sno = await login('sno.jharkhand.p11@example.org');
const soOwner = await login(psql(`SELECT p.email FROM sanction_orders s JOIN applications a ON a.id=s.application_id JOIN applicants p ON p.id=a.applicant_id ORDER BY s.id LIMIT 1;`));
const soId = psql('SELECT id FROM sanction_orders ORDER BY id LIMIT 1;');

console.log('=== F2. Security headers on representative responses');
await show('health (public JSON)', '/health');
await show('authenticated JSON', '/api/v1/applications?limit=1', { headers: { Authorization: `Bearer ${sno}` } });
await show('error (401, standard error body)', '/api/v1/applications');
await show('404 unknown route', '/api/v1/nope');
await show('PDF download', `/api/v1/sanction-orders/${soId}/pdf`, { headers: { Authorization: `Bearer ${soOwner}` } });
await show('CSV export', '/api/v1/analytics/funnel/export.csv?from=2026-04-01&to=2027-04-01', { headers: { Authorization: `Bearer ${sno}` } });
if (swagger === 'true') await show('Swagger UI (docs)', '/docs');

console.log('\n=== F2. CORS');
await show(`preflight from the allowed origin ${allowed}`, '/api/v1/applications', { method: 'OPTIONS', headers: { Origin: allowed, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,content-type' } });
await show('preflight from https://evil.example', '/api/v1/applications', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
await show('simple GET from https://evil.example (with a valid token)', '/api/v1/auth/me', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${sno}` } });
await show('preflight asking for a non-allowed header (X-Evil)', '/api/v1/applications', { method: 'OPTIONS', headers: { Origin: allowed, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-evil' } });
await show('preflight with Origin "null"', '/api/v1/applications', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET' } });
writeFileSync('responses/p17/f2-headers.json', JSON.stringify(dump, null, 1));

console.log('\n=== F1. Per-account rate limits (live)');
async function burst(label, path, token, n, opts = {}) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const res = await fetch(BASE + '/api/v1' + path, { ...opts, headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}` } });
    await res.arrayBuffer();
    codes.push(res.status);
  }
  const first429 = codes.indexOf(429);
  const counts = codes.reduce((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
  console.log(`  ${label.padEnd(58)} ${n} calls -> ${JSON.stringify(counts)}; first 429 at call ${first429 < 0 ? '-' : first429 + 1}`);
  return codes;
}
const dnoR = await login('dno.ranchi.p11@example.org');
await burst('SNO: CSV export (EXPORT 20/min)', '/analytics/funnel/export.csv?from=2026-04-01&to=2027-04-01', sno, 22);
await burst('DNO Ranchi: same export right after (own counter)', '/analytics/funnel/export.csv?from=2026-04-01&to=2027-04-01', dnoR, 2);
await burst('SNO: a different export route (own counter per route)', '/analytics/sla/export.csv?from=2026-04-01&to=2027-04-01', sno, 2);
await burst('PV1: own data export (DATA_EXPORT 5/min)', '/applicants/me/data-export', await login(state.P17.PV1.email), 6);
await burst('SNO: GET /applications (SEARCH 60/min)', '/applications?limit=1', sno, 61);
const res = await fetch(BASE + '/api/v1/applicants/me/data-export', { headers: { Authorization: `Bearer ${await login(state.P17.PV1.email)}` } });
console.log(`  a limited response: HTTP ${res.status} retry-after=${res.headers.get('retry-after')} body=${(await res.text()).slice(0, 160)}`);
