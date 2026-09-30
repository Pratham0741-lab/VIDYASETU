// Phase 14 loose ends, Part A proof: a brand-new scheme created, published and used
// through the API only (zero code changes), drafts private, published versions immutable
// at the API and in the database, config diffs, audit rows.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';

const CODE = 'TRIBAL_ARTS_P14';
const saveR = (n, r) => writeFileSync(`responses/p14/a-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') =>
  console.log(`${label.padEnd(70)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const asAppUser = (email, role, sql) =>
  spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q -v ON_ERROR_STOP=0'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${email}'), true), set_config('app.actor_role', '${role}', true)) s; ${sql}; ROLLBACK;`,
  });

const config = () => ({
  workflow: 'vidyasetu-scrutiny/v1',
  rules: [
    { id: 'category_match', type: 'eligibility', expr: 'applicant.category in params.allowed_categories', params: { allowed_categories: ['ST', 'PVTG'] }, doc_refs: ['CASTE_CERTIFICATE'], message_key: 'eligibility.category_not_allowed', verification: { status: 'PENDING_AUDIT', source_clause: 'P14 synthetic scheme (test data)' } },
    { id: 'income_ceiling', type: 'eligibility', expr: 'applicant.family_income_annual <= params.max_income', params: { max_income: 300000 }, doc_refs: ['INCOME_CERTIFICATE'], message_key: 'eligibility.income_too_high', verification: { status: 'PENDING_AUDIT', source_clause: 'P14 synthetic scheme (test data)' } },
    { id: 'arts_merit_score', type: 'operational', expr: 'params.portfolio_weight * applicant.portfolio_score + params.exam_weight * applicant.exam_score', params: { portfolio_weight: 0.6, exam_weight: 0.4 }, doc_refs: [], message_key: 'selection.merit_score' },
  ],
  benefits: [{ id: 'annual_grant', condition: 'true', description: 'Annual grant (synthetic)', currency: 'INR', amount_annual: 60000, disbursement_channel: 'STUDENT_DBT' }],
  required_documents: ['CASTE_CERTIFICATE', 'INCOME_CERTIFICATE'],
  fund_sharing_ratio: null,
});

const sa = await login('admin.p11@example.org');
const mo = await login('ministry.p11@example.org');
const sno = await login('sno.jharkhand.p11@example.org');
const aud = await login('auditor.jharkhand.p11@example.org');

console.log('=== A2.0 before: schemes known to the platform');
let r = await call('GET', '/admin/schemes', undefined, aud, { raw: true });
line('GET /admin/schemes as AUDITOR (read-only role may read)', r, ` -> ${r.body.schemes.map((s) => `${s.code}[${s.versions.map((v) => v.version_no + ':' + v.status[0]).join(',')}]`).join(' ')}`);
console.log(`   known_workflows: ${JSON.stringify(r.body.known_workflows)}`);

console.log('\n=== A2.1 roles: who may author / publish (configured default SUPER_ADMIN, MINISTRY_OFFICER)');
const schemeBody = { code: CODE, name: 'Tribal Arts Scholarship (P14 synthetic)', department: 'Scholarship Division (test data)', description: 'Synthetic scheme authored through the API for the Phase 14 proof', type: 'CENTRAL_SECTOR', disbursement_mode: 'SCHEDULED_BY_PLATFORM' };
for (const [who, t] of [['STATE_NODAL_OFFICER', sno], ['AUDITOR', aud]]) {
  r = await call('POST', '/admin/schemes', schemeBody, t, { raw: true });
  line(`POST /admin/schemes as ${who}`, r, ` ${JSON.stringify(r.body.details)}`);
}

console.log('\n=== A2.2 create the scheme (MINISTRY_OFFICER)');
r = await call('POST', '/admin/schemes', schemeBody, mo, { raw: true });
if (r.status === 409) { console.log('   (already created by an earlier run)'); }
line(`POST /admin/schemes ${CODE}`, r, r.status === 201 ? ` id=${r.body.id}` : ` ${JSON.stringify(r.body.details)}`);
saveR('create-scheme', r);

console.log('\n=== A2.3 malformed drafts are rejected (standard error shape, message keys, nothing stored)');
const bad1 = { config: { rules: 'not-a-list', benefits: [], required_documents: [] } };
r = await call('POST', `/admin/schemes/${CODE}/versions`, bad1, mo, { raw: true });
line('config.rules not an array, fund_sharing_ratio missing', r);
console.log('   ' + JSON.stringify(r.body).slice(0, 700));
saveR('malformed-1', r);
const bad2 = config();
bad2.workflow = 'fast-track/v9';
bad2.rules[2].expr = 'params.portfolio_weight * applicant.portfolio_score + params.interview_weight * applicant.interview';
bad2.rules[1].expr = 'applicant.family_income_annual <= ';
r = await call('POST', `/admin/schemes/${CODE}/versions`, { config: bad2 }, mo, { raw: true });
line('unknown workflow, missing param, unparseable expression', r);
for (const d of r.body.details) console.log(`   ${d.field.padEnd(28)} ${d.message_key.padEnd(38)} ${Object.values(d.constraints)[0]}`);
saveR('malformed-2', r);
console.log('   versions of the scheme now: ' + psql(`SELECT count(*) FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE s.code='${CODE}';`));

console.log('\n=== A2.4 draft v1: rules, documents, scoring weights, workflow reference');
state.P14 ??= {};
let v1 = await call('GET', `/admin/schemes/${CODE}/versions/1`, undefined, mo, { raw: true });
if (v1.status === 404) {
  const c = config();
  c.rules[1].params.max_income = 250000; // edited below
  r = await call('POST', `/admin/schemes/${CODE}/versions`, { config: c, source_document: 'P14 synthetic scheme - no real guideline', extraction_notes: 'authored through the API' }, mo, { raw: true });
  line('POST /versions (draft)', r, ` version_no=${r.body.version_no} status=${r.body.status}`);
  saveR('draft-v1', r);
}
r = await call('POST', '/schemes/check-eligibility', { applicant: { category: 'ST', family_income_annual: 180000 } }, undefined, { raw: true });
const listed = (b) => [...b.eligible, ...b.not_eligible, ...b.indeterminate].some((x) => x.scheme_code === CODE);
line('public reverse eligibility while v1 is a draft', r, ` ${CODE} listed: ${listed(r.body)}`);
r = await call('GET', `/schemes/${CODE}/versions/1/form-schema`, undefined, undefined, { raw: true });
line('public form-schema of the draft', r);
r = await call('PATCH', `/admin/schemes/${CODE}/versions/1`, { config: config() }, mo, { raw: true });
line('PATCH draft v1 (max_income 250000 -> 300000)', r, ` status=${r.body.status}`);
r = await call('POST', `/admin/schemes/${CODE}/versions/1/validate`, undefined, mo, { raw: true });
line('POST validate v1', r, ` ${JSON.stringify(r.body)}`);
saveR('validate-v1', r);
r = await call('POST', `/admin/schemes/${CODE}/versions/1/preview`, { applicant: { category: 'ST', family_income_annual: 180000, portfolio_score: 80, exam_score: 70 } }, mo, { raw: true });
line('POST preview v1 (draft, nothing stored)', r, ` outcome=${r.body.outcome} score=${r.body.rules?.find((x) => x.rule_id === 'arts_merit_score')?.value}`);

console.log('\n=== A2.5 publish v1, then use it with zero code changes');
r = await call('POST', `/admin/schemes/${CODE}/versions/1/publish`, {}, sno, { raw: true });
line('publish as STATE_NODAL_OFFICER', r);
r = await call('POST', `/admin/schemes/${CODE}/versions/1/publish`, {}, mo, { raw: true });
line('publish as MINISTRY_OFFICER', r, r.status === 200 ? ` status=${r.body.version.status} effective_from=${r.body.version.effective_from.slice(0, 10)}` : ` ${JSON.stringify(r.body.details)}`);
saveR('publish-v1', r);
v1 = await call('GET', `/admin/schemes/${CODE}/versions/1`, undefined, mo);
state.P14.v1 = v1.version.id;
save();
r = await call('GET', `/schemes/${CODE}/versions/1/form-schema`, undefined, undefined, { raw: true });
line('public form-schema v1', r, ` fields=${r.body.fields.map((f) => `${f.key}(${f.types.join('/')})`).join(', ')}`);
console.log(`   documents: ${JSON.stringify(r.body.documents.checklist)}; limits: ${JSON.stringify(r.body.fields.flatMap((f) => f.limits))}; category options: ${JSON.stringify(r.body.fields.find((f) => f.key === 'category').options)}`);
saveR('form-schema-v1', r);
const synthetic = { category: 'ST', family_income_annual: 180000, portfolio_score: 80, exam_score: 70 };
r = await call('POST', `/schemes/${CODE}/versions/1/check-eligibility`, { applicant: synthetic }, undefined, { raw: true });
line('public check-eligibility v1, synthetic applicant', r, ` outcome=${r.body.outcome}; ${r.body.rules.map((x) => `${x.rule_id}=${x.verdict}${x.value !== true && x.value !== null ? '(' + x.value + ')' : ''}`).join(', ')}`);
saveR('eligibility-v1', r);
r = await call('POST', `/schemes/${CODE}/versions/1/check-eligibility`, { applicant: { ...synthetic, family_income_annual: 420000 } }, undefined, { raw: true });
line('  same, income 420000', r, ` outcome=${r.body.outcome} failed=${JSON.stringify(r.body.failed_rules)}`);
r = await call('POST', '/schemes/check-eligibility', { applicant: synthetic }, undefined, { raw: true });
line('public reverse eligibility now', r, ` ${CODE} eligible: ${r.body.eligible.some((x) => x.scheme_code === CODE)}`);

console.log('\n=== A2.6 an applicant applies to the new scheme (workflow gate runs its rules)');
if (!state.P14.ta1) {
  const email = 'ta1.sumi.p11@example.org';
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: 'Sumi', last_name: 'Hansda', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-14A001', annual_income: '180000.00', bank_account: 'SBIN0004455:14A0010', gender: 'FEMALE', dob: '2003-05-05' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  const app = await call('POST', '/applications', { scheme_version_id: state.P14.v1, academic_year: '2026-27', declared: { portfolio_score: 80, exam_score: 70 } }, await login(email));
  state.P14.ta1 = { email, applicationId: app.id, application_no: app.application_no, stage: app.current_stage, gate: app.eligibility_gate.outcome };
  save();
}
console.log(`   ${state.P14.ta1.application_no}: stage ${state.P14.ta1.stage}, gate ${state.P14.ta1.gate}, version v1 ${state.P14.v1}`);

console.log('\n=== A2.7 a published version is never edited: API and database');
r = await call('PATCH', `/admin/schemes/${CODE}/versions/1`, { config: config() }, mo, { raw: true });
line('PATCH published v1', r, ` ${JSON.stringify(r.body.details)}`);
saveR('patch-published', r);
const dbApp = asAppUser('ministry.p11@example.org', 'MINISTRY_OFFICER', `UPDATE scheme_versions SET config = jsonb_set(config, '{fund_sharing_ratio}', '"50:50"') WHERE id='${state.P14.v1}'`);
console.log('   app_user as MINISTRY_OFFICER, raw UPDATE config: ' + (dbApp.stderr.toString().trim() || dbApp.stdout.toString().trim()));
const dbOwner = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `BEGIN; UPDATE scheme_versions SET status='draft' WHERE id='${state.P14.v1}'; ROLLBACK; BEGIN; DELETE FROM scheme_versions WHERE id='${state.P14.v1}'; ROLLBACK;` });
console.log('   owner, raw UPDATE status=draft / DELETE:\n     ' + dbOwner.stderr.toString().trim().split('\n').join('\n     '));
console.log('   v1 config unchanged: ' + psql(`SELECT config->>'fund_sharing_ratio' IS NULL AND status='active' FROM scheme_versions WHERE id='${state.P14.v1}';`));

console.log('\n=== A2.8 change = a new version: draft v2 from v1, diff, publish (v1 retired for new applications)');
let v2 = await call('GET', `/admin/schemes/${CODE}/versions/2`, undefined, mo, { raw: true });
if (v2.status === 404) {
  r = await call('POST', `/admin/schemes/${CODE}/versions`, { based_on_version: 1 }, mo, { raw: true });
  line('POST /versions based_on_version=1', r, ` version_no=${r.body.version_no} status=${r.body.status}`);
  const c = config();
  c.rules[1].params.max_income = 250000;
  c.rules[2].params = { portfolio_weight: 0.5, exam_weight: 0.5 };
  c.required_documents.push('MARKSHEET');
  r = await call('PATCH', `/admin/schemes/${CODE}/versions/2`, { config: c }, mo, { raw: true });
  line('PATCH draft v2', r);
}
r = await call('GET', `/admin/schemes/${CODE}/diff?from=1&to=2`, undefined, aud, { raw: true });
line('GET diff v1 -> v2 (as AUDITOR)', r, ` ${r.body.change_count} changes`);
for (const c of r.body.changes) console.log(`   ${c.change.padEnd(8)} ${c.path} ${c.change === 'changed' ? JSON.stringify(c.from) + ' -> ' + JSON.stringify(c.to) : JSON.stringify(c.to ?? c.from)}`);
saveR('diff-v1-v2', r);
r = await call('POST', `/admin/schemes/${CODE}/versions/2/publish`, { effective_from: new Date().toISOString().slice(0, 10) }, mo, { raw: true });
line('publish v2 from today (v1 is effective from today too)', r, ` ${JSON.stringify(r.body.details ?? '')}`);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
r = await call('POST', `/admin/schemes/${CODE}/versions/2/publish`, { effective_from: tomorrow }, mo, { raw: true });
line(`publish v2 from ${tomorrow}`, r, r.status === 200 ? ` superseded=${JSON.stringify(r.body.superseded)}` : ` ${JSON.stringify(r.body.details)}`);
saveR('publish-v2', r);
console.log('   versions: ' + psql(`SELECT string_agg('v'||version_no||' '||status||' '||effective_from||'..'||coalesce(effective_to::text,''), '; ' ORDER BY version_no) FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE s.code='${CODE}';`));
console.log('   pinned application still on v1: ' + psql(`SELECT a.application_no||' -> v'||v.version_no FROM applications a JOIN scheme_versions v ON v.id=a.scheme_version_id WHERE a.id='${state.P14.ta1.applicationId}';`));
const pin = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `BEGIN; UPDATE applications SET scheme_version_id=(SELECT v.id FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE s.code='${CODE}' AND version_no=2) WHERE id='${state.P14.ta1.applicationId}'; ROLLBACK;` });
console.log('   owner moves it to v2: ' + pin.stderr.toString().trim().split('\n')[0]);
r = await call('POST', '/applications', { scheme_version_id: state.P14.v1, academic_year: '2026-27' }, await login(state.P14.ta1.email), { raw: true });
line('new application on archived v1', r, ` ${JSON.stringify(r.body.details)}`);

console.log('\n=== A2.9 retire');
r = await call('POST', `/admin/schemes/${CODE}/versions/2/retire`, undefined, aud, { raw: true });
line('retire v2 as AUDITOR', r);
r = await call('POST', `/admin/schemes/${CODE}/versions/2/retire`, undefined, mo, { raw: true });
line('retire v2 as MINISTRY_OFFICER', r, r.status === 200 ? ` status=${r.body.status} effective_to=${r.body.effective_to?.slice(0, 10)}` : ` ${JSON.stringify(r.body.details)}`);
r = await call('POST', `/admin/schemes/${CODE}/versions/2/retire`, undefined, mo, { raw: true });
line('retire v2 again', r, ` ${JSON.stringify(r.body.details)}`);

console.log('\n=== A2.10 audit rows for the scheme and its versions');
console.log(psql(`SELECT a.seq||' '||a.table_name||' '||a.action||' '||coalesce(a.actor_role,'-')||' '||coalesce(a.row_data->>'code', 'v'||(a.row_data->>'version_no')||' '||(a.row_data->>'status')) FROM audit_logs a WHERE (a.table_name='schemes' AND a.row_data->>'code'='${CODE}') OR (a.table_name='scheme_versions' AND a.row_data->>'scheme_id'=(SELECT id::text FROM schemes WHERE code='${CODE}')) ORDER BY a.seq;`));
