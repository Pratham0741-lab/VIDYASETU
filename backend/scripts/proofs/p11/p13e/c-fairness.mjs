// Phase 13E proof 6: fairness figures vs independently written SQL on a hand-built
// oracle dataset; small-count suppression in JSON and CSV; scope and fixture rules.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const YEAR = '2033-34';
const API = 'http://localhost:3000/api/v1';
// key, category, gender, disabled, district, institution, verify-through?
const ORACLE = [
  ['FA01', 'ST', 'FEMALE', false, 'Ranchi', 'U-1001', true], ['FA02', 'ST', 'FEMALE', false, 'Ranchi', 'U-1001', true],
  ['FA03', 'ST', 'FEMALE', true, 'Ranchi', 'U-1001', true], ['FA04', 'ST', 'MALE', false, 'Ranchi', 'U-1001', true],
  ['FA05', 'ST', 'MALE', false, 'Ranchi', 'C-2002', true], ['FA06', 'ST', 'FEMALE', false, 'Ranchi', 'C-2002', true],
  ['FA07', 'ST', 'MALE', true, 'Dumka', 'C-2002', true], ['FA08', 'ST', 'FEMALE', false, 'Dumka', 'C-2002', true],
  ['FA09', 'ST', 'MALE', false, 'Dumka', '20123456789', true], ['FA10', 'ST', 'FEMALE', false, 'Ranchi', '20123456789', false],
  ['FA11', 'ST', 'MALE', false, 'Dumka', null, false], ['FA12', 'ST', 'FEMALE', true, 'Ranchi', null, false],
  ['FA13', 'PVTG', 'FEMALE', false, 'Ranchi', 'U-1001', false], ['FA14', 'PVTG', 'MALE', false, 'Dumka', 'U-1001', false],
  ['FA15', 'PVTG', 'FEMALE', false, 'Ranchi', 'C-2002', false], ['FA16', 'PVTG', 'MALE', false, 'Dumka', '20123456789', false],
];
state.P ??= {};
for (const [key, category, gender, disabled, district, inst, through] of ORACLE) {
  if (state.P[key]) continue;
  const email = `${key.toLowerCase()}.oracle.p11@example.org`;
  const n = key.slice(2);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: 'Oracle', last_name: key, category, domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-13F${n}`, annual_income: '180000.00', bank_account: `SBIN0004455:13F0${n}00`, gender, dob: '2003-03-03', is_disabled: disabled, ...(disabled ? { disability_percentage: 50 } : {}) }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${JSON.stringify(reg.body)}`);
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: YEAR, declared: { education_level: LVL.TOP_CLASS }, ...(inst ? { institution_code: inst } : {}) }, await login(email));
  if (through && app.current_stage === 'INO_VERIFIED') {
    for (const who of [`ino.${district.toLowerCase()}`, `dno.${district.toLowerCase()}`, 'sno.jharkhand']) {
      const r = await call('POST', `/applications/${app.id}/verify`, {}, await login(`${who}.p11@example.org`), { raw: true });
      if (r.status !== 200) throw new Error(`${key} verify ${who}: ${JSON.stringify(r.body)}`);
    }
  }
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  console.log(`${key} ${category} ${gender} pwd=${disabled} ${district} ${inst ?? '-'} -> stage ${psql(`SELECT current_stage FROM applications WHERE id='${app.id}';`)}`);
}
if (!state.FA_RUN) {
  const r = await call('POST', `/schemes/TOP_CLASS/academic-years/${YEAR}/run-selection`, {}, await login('ministry.p11@example.org'), { raw: true });
  console.log(`run-selection TOP_CLASS ${YEAR}: HTTP ${r.status} counts=${JSON.stringify(r.body.counts)}`);
  state.FA_RUN = r.body.selection_run_id; save();
}
// Tag the oracle as fixtures (the rule under test: excluded unless a SUPER_ADMIN asks).
spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `INSERT INTO test_fixtures (entity_type, entity_id, label, note) SELECT 'application', a.id, 'p13e-fixture', 'fairness oracle' FROM applications a JOIN applicants p ON p.id=a.applicant_id JOIN accounts c ON c.id=p.user_id WHERE c.email LIKE 'fa__.oracle.p11@example.org' ON CONFLICT DO NOTHING;` });

console.log('\n=== independent SQL (owner; written separately from the service: one GROUP BY per dimension)');
const base = `FROM applications a JOIN applicants p ON p.id = a.applicant_id JOIN schemes s ON s.id = a.scheme_id
  WHERE s.code = 'TOP_CLASS' AND a.academic_year = '${YEAR}' AND a.submitted_at IS NOT NULL`;
const sel = `(SELECT count(*) FROM selections x WHERE x.application_id = a.id AND x.selection_status IN ('PROVISIONAL','CONFIRMED')) > 0`;
const oracle = {};
for (const [dim, expr] of [
  ['category', 'p.category'],
  ['gender', 'p.gender'],
  ['pwd_status', `CASE WHEN p.is_disabled THEN 'PWD' ELSE 'NOT_PWD' END`],
  ['district', 'a.jurisdiction_district'],
  ['institution_type', `CASE WHEN a.institution_code IS NULL THEN 'NOT_RECORDED' WHEN a.institution_code LIKE 'U-%' THEN 'AISHE_UNIVERSITY' WHEN a.institution_code LIKE 'C-%' THEN 'AISHE_COLLEGE' WHEN length(a.institution_code) = 11 THEN 'UDISE_SCHOOL' ELSE 'OTHER' END`],
]) {
  const rows = psql(`SELECT ${expr} AS b, count(*), sum(CASE WHEN ${sel} THEN 1 ELSE 0 END) ${base} GROUP BY 1 ORDER BY 1;`).split('\n').map((l) => l.split('|'));
  oracle[dim] = rows.map(([b, applied, selected]) => ({ bucket: b, applied: Number(applied), selected: Number(selected) }));
  console.log(`  ${dim.padEnd(17)} ${oracle[dim].map((r) => `${r.bucket}=${r.selected}/${r.applied}`).join('  ')}`);
}

// The published rule, applied here independently: 1-4 -> "<5"; a row whose applied is 1-4 is
// masked whole; per dimension, a column with exactly one masked cell also hides its smallest
// other non-zero cell ("suppressed"); a rate only when both counts are shown.
function mask(rows) {
  const out = rows.map((r) => {
    const whole = r.applied > 0 && r.applied < 5;
    const m = (n) => (whole && n > 0 ? '<5' : n > 0 && n < 5 ? '<5' : n);
    return { bucket: r.bucket, applied: m(r.applied), selected: m(r.selected) };
  });
  for (const k of ['applied', 'selected']) {
    const masked = out.filter((r) => typeof r[k] === 'string');
    if (masked.length !== 1) continue;
    const next = out.filter((r) => typeof r[k] === 'number' && r[k] > 0).sort((a, b) => a[k] - b[k])[0];
    if (next) next[k] = 'suppressed';
  }
  return out.map((r) => ({ ...r, selection_rate: typeof r.applied === 'number' && typeof r.selected === 'number' && r.applied > 0 ? Math.round((r.selected / r.applied) * 1000) / 1000 : r.applied === 0 ? null : 'suppressed' }));
}

console.log('\n=== the api (SUPER_ADMIN, include_fixtures=true) vs the oracle with the rule applied independently');
const sa = await login('admin.p11@example.org');
const q = `scheme=TOP_CLASS&academic_year=${YEAR}`;
const j = await call('GET', `/analytics/fairness?${q}&include_fixtures=true`, undefined, sa, { raw: true });
writeFileSync('responses/p13e/fairness-sa-fixtures.json', JSON.stringify(j, null, 1));
const csvRes = await fetch(`${API}/analytics/fairness/export.csv?${q}&include_fixtures=true`, { headers: { Authorization: `Bearer ${sa}` } });
const csv = await csvRes.text();
writeFileSync('responses/p13e/fairness-sa-fixtures.csv', csv);
let allMatch = true;
for (const dim of Object.keys(oracle)) {
  const expected = mask(oracle[dim]);
  const got = j.body.dimensions[dim];
  const match = JSON.stringify(expected) === JSON.stringify(got);
  allMatch &&= match;
  console.log(`  ${dim.padEnd(17)} match=${match}  api: ${got.map((r) => `${r.bucket}=${r.selected}/${r.applied} (${r.selection_rate})`).join('  ')}`);
  const hidden = got.filter((r) => typeof r.applied === 'string' || typeof r.selected === 'string');
  if (hidden.length) console.log(`  ${''.padEnd(17)} suppressed: ${hidden.map((r) => `${r.bucket}[applied ${r.applied}, selected ${r.selected}]`).join(', ')}`);
}
const csvRows = csv.trim().split('\r\n');
const fromJson = Object.entries(j.body.dimensions).flatMap(([d, rows]) => rows.map((r) => [d, r.bucket, r.applied, r.selected, r.selection_rate ?? ''].join(',')));
console.log(`CSV: HTTP ${csvRes.status} ${csvRes.headers.get('content-type')}; header "${csvRows[0]}"; ${csvRows.length - 1} rows; identical to the JSON cells: ${JSON.stringify(csvRows.slice(1)) === JSON.stringify(fromJson)}`);
console.log(`total: ${JSON.stringify(j.body.total)}; every dimension matches the oracle: ${allMatch}`);

console.log('\n=== fixture and role rules');
let r = await call('GET', `/analytics/fairness?${q}`, undefined, sa, { raw: true });
console.log(`  SUPER_ADMIN without include_fixtures: HTTP ${r.status} total=${JSON.stringify(r.body.total)} (the oracle is all fixtures)`);
r = await call('GET', `/analytics/fairness?${q}&include_fixtures=true`, undefined, await login('sno.jharkhand.p11@example.org'), { raw: true });
console.log(`  SNO with include_fixtures: HTTP ${r.status} ${r.body.code} ${JSON.stringify(r.body.details)}`);
r = await call('GET', `/analytics/fairness?${q}`, undefined, await login('committee.ranchi.p11@example.org'), { raw: true });
console.log(`  COMMITTEE Ranchi: HTTP ${r.status}`);
r = await call('GET', `/analytics/fairness?scheme=TOP_CLASS`, undefined, sa, { raw: true });
console.log(`  no academic_year (unbounded): HTTP ${r.status} ${r.body.code} ${JSON.stringify(r.body.details)}`);
r = await call('GET', `/analytics/fairness?${q}`, undefined, await login(state.P.FA01.email), { raw: true });
console.log(`  applicant: HTTP ${r.status} ${r.body.code}`);

console.log('\n=== database scoping of the same cohort as app_user (fixtures included: they are the only data)');
for (const [label, email, role] of [['SNO Jharkhand', 'sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER'], ['DNO Dumka', 'dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER'], ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org', 'COMMITTEE'], ['no actor set', null, null]]) {
  const set = email ? `SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${email}'), true), set_config('app.actor_role', '${role}', true)) s;` : '';
  const out = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${set} SELECT coalesce(string_agg(d||'='||n, ' '), 'none') FROM (SELECT a.jurisdiction_district d, count(*) n ${base} GROUP BY 1 ORDER BY 1) t; COMMIT;` });
  console.log(`  ${label.padEnd(18)} cohort by district: ${out.stderr.toString().trim().split('\n')[0] || out.stdout.toString().trim().split('\n').pop()}`);
}
