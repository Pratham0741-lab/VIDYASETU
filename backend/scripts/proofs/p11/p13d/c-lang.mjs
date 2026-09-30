// Phase 13D proofs 4 and 6: changing preferred_language changes the next notifications
// (three types); an unsupported / template-less language; the profile routes' scope.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, upload, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOT = 'Family Income Certificate';
async function applicant(key, first, last, phone) {
  state.P ??= {};
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(Object.keys(state.P).length + 300);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-13L${n}`, annual_income: '180000.00', bank_account: `SBIN0004455:13L0${n}0`, gender: 'FEMALE', dob: '2004-04-04', phone }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  return state.P[key];
}
const P = await applicant('LG1', 'Sarita', 'Kujur', '9876543101');
const t = await login(P.email);
let mark = psql(`SELECT now();`);
const latest = (label) => {
  const rows = psql(`SELECT template_key||' | '||channel||' | locale='||locale||' requested='||coalesce(requested_locale,'-')||' | '||subject FROM notifications WHERE application_id='${P.applicationId}' AND recipient_account_id=(SELECT id FROM accounts WHERE email='${P.email}') AND created_at > '${mark}' AND channel='IN_APP' ORDER BY created_at;`);
  console.log(`  [${label}] applicant notifications since the last step:\n    ${rows.split('\n').join('\n    ')}`);
  mark = psql(`SELECT now();`);
};
const three = async (officer) => {
  let r = await upload(t, P.applicationId, SLOT, 'quality_fail');
  console.log(`  quality-fail upload: HTTP ${r.status} ${r.body.status}`);
  r = await call('POST', '/grievances', { application_id: P.applicationId, subject_type: 'APPLICATION', description: 'Asking about the status of my application.' }, t, { raw: true });
  console.log(`  grievance: HTTP ${r.status}`);
  r = await call('POST', `/applications/${P.applicationId}/verify`, {}, await login(officer), { raw: true });
  console.log(`  ${officer.split('.')[0]} verifies: HTTP ${r.status} -> ${r.body.application?.current_stage ?? r.body.code}`);
  await sleep(4000);
};

console.log(`=== LG1 ${P.application_no}, registered with no language (en)`);
let me = await call('GET', '/applicants/me', undefined, t, { raw: true });
writeFileSync('responses/p13d/c-me-before.json', JSON.stringify(me, null, 1));
console.log(`GET /applicants/me: HTTP ${me.status} preferred_language=${me.body.preferred_language} supported=${me.body.supported_languages} editable=${me.body.editable_fields} caste=${me.body.caste_cert_number_masked} bank=${me.body.bank_account_masked}`);
mark = psql(`SELECT now() - interval '1 hour';`);
latest('registration');
await three('ino.ranchi.p11@example.org');
latest('English');

console.log('\n=== PATCH /applicants/me {preferred_language: "hi"}');
let r = await call('PATCH', '/applicants/me', { preferred_language: 'hi' }, t, { raw: true });
console.log(`HTTP ${r.status} preferred_language=${r.body.preferred_language} changed_fields=${JSON.stringify(r.body.changed_fields)}`);
await three('dno.ranchi.p11@example.org');
latest('Hindi');
console.log('  Hindi body of the "advanced" notice: ' + psql(`SELECT body FROM notifications WHERE application_id='${P.applicationId}' AND template_key='application.advanced' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`));
console.log('  Hindi body of the retake notice:\n    ' + psql(`SELECT body FROM notifications WHERE application_id='${P.applicationId}' AND template_key='document.retake_required' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`).split('\n').join('\n    '));

console.log('\n=== PATCH {preferred_language: "fr"} (not supported) and "sat" (supported, no templates)');
r = await call('PATCH', '/applicants/me', { preferred_language: 'fr' }, t, { raw: true });
console.log(`fr: HTTP ${r.status} ${r.body.code} ${JSON.stringify(r.body.details)}`);
r = await call('PATCH', '/applicants/me', { preferred_language: 'sat', phone: '9876543102' }, t, { raw: true });
console.log(`sat + new phone: HTTP ${r.status} changed_fields=${JSON.stringify(r.body.changed_fields)}`);
r = await upload(t, P.applicationId, SLOT, 'quality_fail');
r = await call('POST', '/grievances', { application_id: P.applicationId, subject_type: 'APPLICATION', description: 'A second question about my application.' }, t, { raw: true });
await sleep(4000);
latest('Santali (fallback)');

console.log('\n=== proof 6: profile scope');
r = await call('PATCH', '/applicants/me', { first_name: 'Changed', bank_account: 'SBIN0000001:1', domicile_district: 'Dumka' }, t, { raw: true });
console.log(`PATCH with non-editable fields (name, bank, district): HTTP ${r.status} ${r.body.code ?? ''} ${JSON.stringify(r.body.details ?? '')}`);
const Q = await applicant('LG2', 'Jyoti', 'Tirkey', '9876543201');
const tq = await login(Q.email);
me = await call('GET', '/applicants/me', undefined, tq, { raw: true });
console.log(`LG2 GET /applicants/me -> applicant_id is LG2's own: ${me.body.applicant_id === psql(`SELECT id FROM applicants WHERE email='${Q.email}';`)}; contains LG1's name: ${JSON.stringify(me.body).includes('Sarita')}`);
for (const who of ['ino.ranchi.p11@example.org', 'auditor.jharkhand.p11@example.org', 'admin.p11@example.org']) {
  const g = await call('GET', '/applicants/me', undefined, await login(who), { raw: true });
  const p = await call('PATCH', '/applicants/me', { preferred_language: 'hi' }, await login(who), { raw: true });
  console.log(`${who.split('@')[0].padEnd(24)} GET ${g.status} ${g.body.code} | PATCH ${p.status} ${p.body.code}`);
}
const anon = await fetch('http://localhost:3000/api/v1/applicants/me');
console.log(`no token                 GET ${anon.status}`);

console.log('\nDB (owner): applicant_profile_changes for LG1: ' + psql(`SELECT string_agg(array_to_string(changed_fields, '+'), ', ' ORDER BY created_at) FROM applicant_profile_changes WHERE applicant_id=(SELECT id FROM applicants WHERE email='${P.email}');`) + ' | audit rows: ' + psql(`SELECT count(*) FROM audit_logs WHERE table_name='applicant_profile_changes' AND record_id IN (SELECT id FROM applicant_profile_changes WHERE applicant_id=(SELECT id FROM applicants WHERE email='${P.email}'));`));
console.log('as app_user (RLS) on applicant_profile_changes:');
for (const [label, email, role] of [['LG1 (owner)', P.email, 'APPLICANT'], ['LG2 (another applicant)', Q.email, 'APPLICANT'], ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'], ['no actor set', null, null]]) {
  const set = email ? `SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${email}'), true), set_config('app.actor_role', '${role}', true)) s;` : '';
  const out = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${set} SELECT count(*)||' visible (of '||(SELECT count(*) FROM applicant_profile_changes)||' visible total)' FROM applicant_profile_changes WHERE applicant_id=(SELECT id FROM applicants WHERE email='${P.email}'); COMMIT;` });
  console.log(`  ${label.padEnd(26)} LG1's rows: ${(out.stderr.toString().trim().split('\n')[0] || out.stdout.toString().trim().split('\n').pop())}`);
}
const ins = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${Q.email}'), true), set_config('app.actor_role', 'APPLICANT', true)) s; INSERT INTO applicant_profile_changes (applicant_id, changed_fields, changed_by_account_id) SELECT id, ARRAY['phone'], gen_random_uuid() FROM applicants WHERE email='${P.email}'; ROLLBACK;` });
console.log(`  LG2 inserting a change row for LG1 (raw): ${ins.stderr.toString().trim().split('\n')[0] || 'ACCEPTED'}`);
const upd = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${P.email}'), true), set_config('app.actor_role', 'APPLICANT', true)) s; UPDATE applicant_profile_changes SET changed_fields = ARRAY['phone']; ROLLBACK;` });
console.log(`  LG1 updating its own change rows (raw): ${upd.stderr.toString().trim().split('\n')[0] || 'ACCEPTED'}`);
