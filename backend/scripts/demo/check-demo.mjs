#!/usr/bin/env node
// VIDYASETU demo check (read-only): what the demo seed loaded, and whether the dashboards a
// state officer opens show numbers. Run before recording: node scripts/demo/check-demo.mjs
//
// Counts come from read-only SQL (as the database owner, like the proof scripts); the analytics
// come from the API, logged in as the demo state nodal officer. Nothing is written except one
// login's refresh token when the seed's stored token has expired.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.env.DEMO_SEED_DIR ?? join(REPO, '..', '.demo-seed'));
const ENV = Object.fromEntries(
  readFileSync(join(OUT, 'demo.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const API = ENV.API_BASE ?? 'http://127.0.0.1:3000/api/v1';
const DEMO = "'%.demo@example.org'";
const YEAR = '2025-26';
const FROM = '2026-08-01';
const TO = '2026-10-31';

function sql(q) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q -P pager=off'], { cwd: REPO, input: q });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trimEnd();
}
async function stateOfficerToken() {
  const st = existsSync(join(OUT, 'state.json')) ? JSON.parse(readFileSync(join(OUT, 'state.json'), 'utf8')) : { refresh: {} };
  const email = 'sno.jharkhand.demo@example.org';
  const rt = st.refresh?.[email];
  if (rt) {
    const r = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
    if (r.ok) return (await r.json()).access_token;
  }
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: ENV.DEMO_PASSWORD }) });
  if (!r.ok) throw new Error(`login ${email}: HTTP ${r.status}`);
  return (await r.json()).access_token;
}
async function get(token, path) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
/** Every number in a JSON value (suppressed cells are strings like "<5"), summed. */
const total = (v) => (typeof v === 'number' ? v : Array.isArray(v) ? v.reduce((s, x) => s + total(x), 0) : v && typeof v === 'object' ? Object.values(v).reduce((s, x) => s + total(x), 0) : 0);
const cells = (rows, keys) => rows.map((r) => keys.map((k) => `${k}=${r[k]}`).join(' ')).join('\n    ');

console.log('== Demo rows by table (accounts <local>.demo@example.org; not tagged as test fixtures)');
console.log(sql(`
CREATE TEMP VIEW d_acc AS SELECT id, email FROM accounts WHERE email LIKE ${DEMO};
CREATE TEMP VIEW d_app AS SELECT x.* FROM applications x JOIN applicants p ON p.id=x.applicant_id WHERE p.user_id IN (SELECT id FROM d_acc);
SELECT t AS "table", n AS rows FROM (VALUES
 ('accounts (officers + applicants)', (SELECT count(*) FROM d_acc)),
 ('officers', (SELECT count(*) FROM officers WHERE user_id IN (SELECT id FROM d_acc))),
 ('applicants', (SELECT count(*) FROM applicants WHERE user_id IN (SELECT id FROM d_acc))),
 ('consent_records', (SELECT count(*) FROM consent_records c JOIN applicants p ON p.id=c.applicant_id WHERE p.user_id IN (SELECT id FROM d_acc))),
 ('applications', (SELECT count(*) FROM d_app)),
 ('documents', (SELECT count(*) FROM documents WHERE application_id IN (SELECT id FROM d_app))),
 ('workflow_transitions', (SELECT count(*) FROM workflow_transitions WHERE application_id IN (SELECT id FROM d_app))),
 ('decision_records', (SELECT count(*) FROM decision_records WHERE application_id IN (SELECT id FROM d_app))),
 ('  of which bulk (bulk_batch_id)', (SELECT count(*) FROM decision_records WHERE application_id IN (SELECT id FROM d_app) AND bulk_batch_id IS NOT NULL)),
 ('deficiencies', (SELECT count(*) FROM deficiencies WHERE application_id IN (SELECT id FROM d_app))),
 ('deficiency_items', (SELECT count(*) FROM deficiency_items WHERE application_id IN (SELECT id FROM d_app))),
 ('fraud_flags', (SELECT count(*) FROM fraud_flags WHERE application_id IN (SELECT id FROM d_app))),
 ('selection_lists (academic year ${YEAR})', (SELECT count(*) FROM selection_lists WHERE academic_year='${YEAR}')),
 ('selection_list_entries', (SELECT count(*) FROM selection_list_entries WHERE application_id IN (SELECT id FROM d_app))),
 ('selection_committee_decisions', (SELECT count(*) FROM selection_committee_decisions c JOIN selection_lists l ON l.id=c.selection_list_id WHERE l.academic_year='${YEAR}')),
 ('selections', (SELECT count(*) FROM selections WHERE application_id IN (SELECT id FROM d_app))),
 ('sanction_orders', (SELECT count(*) FROM sanction_orders WHERE application_id IN (SELECT id FROM d_app))),
 ('disbursements', (SELECT count(*) FROM disbursements WHERE application_id IN (SELECT id FROM d_app))),
 ('renewals', (SELECT count(*) FROM renewals WHERE parent_application_id IN (SELECT id FROM d_app))),
 ('sla_breaches', (SELECT count(*) FROM sla_breaches WHERE application_id IN (SELECT id FROM d_app))),
 ('notifications', (SELECT count(*) FROM notifications WHERE recipient_account_id IN (SELECT id FROM d_acc))),
 ('demo rows tagged in test_fixtures (must be 0)', (SELECT count(*) FROM test_fixtures f WHERE f.entity_id IN (SELECT id FROM d_app UNION SELECT id FROM d_acc)))
) v(t, n);
SELECT s.code AS scheme, x.current_stage AS stage, count(*) AS applications FROM d_app x JOIN schemes s ON s.id=x.scheme_id GROUP BY 1,2 ORDER BY 1,2;
SELECT jurisdiction_district AS district, institution_code AS institution, count(*) AS applications FROM d_app GROUP BY 1,2 ORDER BY 1,2;
SELECT to_char(date_trunc('week', submitted_at),'YYYY-MM-DD') AS submitted_week, count(*) AS applications FROM d_app GROUP BY 1 ORDER BY 1;
SELECT f.flag_type, f.severity, f.status, count(*) FROM fraud_flags f WHERE f.application_id IN (SELECT id FROM d_app) GROUP BY 1,2,3 ORDER BY 1;
SELECT s.code AS scheme, d.component_type, d.status, count(*) AS instalments, sum(d.amount) AS amount_inr FROM disbursements d JOIN d_app x ON x.id=d.application_id JOIN schemes s ON s.id=x.scheme_id GROUP BY 1,2,3 ORDER BY 1;
SELECT s.code AS scheme, count(*) AS sanction_orders FROM sanction_orders o JOIN d_app x ON x.id=o.application_id JOIN schemes s ON s.id=x.scheme_id GROUP BY 1 ORDER BY 1;
SELECT verification_status, academic_year, academic_year_number, count(*) FROM renewals WHERE parent_application_id IN (SELECT id FROM d_app) GROUP BY 1,2,3;
`));

const t = await stateOfficerToken();
console.log(`\n== Analytics as the demo state nodal officer (Jharkhand), window ${FROM}..${TO} (fixtures excluded, the default)`);
const q = `from=${FROM}&to=${TO}`;
const funnel = await get(t, `/analytics/funnel?${q}`);
console.log(`funnel     HTTP ${funnel.status}  ${(funnel.body?.steps ?? []).map((x) => `${x.step}=${x.count}`).join(' ')} | current ${JSON.stringify(funnel.body?.current)} held=${funnel.body?.held?.count} state_dbt=${funnel.body?.state_dbt?.count}`);
const sla = await get(t, `/analytics/sla?${q}`);
console.log(`sla        HTTP ${sla.status}
    ${cells(sla.body?.stages ?? [], ['stage', 'sla_days', 'completed_stays', 'median_hours', 'completed_past_sla', 'in_stage_now', 'in_stage_past_sla'])}`);
const fraud = await get(t, `/analytics/fraud?${q}`);
console.log(`fraud      HTTP ${fraud.status}  ${(fraud.body?.application_flags ?? []).map((x) => `${x.flag_type}/${x.severity}: ${x.flags} flags on ${x.applications} applications`).join('; ')} | held ${fraud.body?.held_applications?.total}`);
const workload = await get(t, `/analytics/workload?${q}`);
console.log(`workload   HTTP ${workload.status}\n    ${cells(workload.body?.actions ?? [], ['role', 'level', 'actions_total', 'verify', 'reject', 'defective', 'bulk_actions', 'officers_active'])}`);
for (const scheme of ['NFST', 'TOP_CLASS', 'POST_MATRIC']) {
  const f = await get(t, `/analytics/fairness?scheme=${scheme}&academic_year=${YEAR}`);
  console.log(`fairness ${scheme.padEnd(11)} HTTP ${f.status}  numbers sum=${total(f.body?.groups ?? f.body?.rows ?? f.body?.data ?? f.body)}  keys=${Object.keys(f.body ?? {}).join(',')}`);
}
