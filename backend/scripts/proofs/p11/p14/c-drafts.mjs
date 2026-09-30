// Phase 14 loose ends, Part C proof: application drafts saved, resumed, private, submitted
// through the unchanged submit path; the direct (non-draft) flow unchanged.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const saveR = (n, r) => writeFileSync(`responses/p14/c-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const asAppUser = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const out = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (out.stdout.toString() + out.stderr.toString()).trim();
};
async function applicant(key, first, district) {
  state.P14 ??= {};
  state.P14.dr ??= {};
  if (state.P14.dr[key]) return state.P14.dr[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(700 + Object.keys(state.P14.dr).length);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: 'Murmu', category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-14C${n}`, annual_income: '160000.00', bank_account: `SBIN0004455:14C0${n}0`, gender: 'FEMALE', dob: '2004-06-06' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  state.P14.dr[key] = { email };
  save();
  return state.P14.dr[key];
}

const sa = await login('admin.p11@example.org');
const funnel = async () => {
  // A keep-alive socket closed by the server between calls: retry once.
  const get = () => call('GET', '/analytics/funnel?from=2026-01-01&to=2027-01-01&include_fixtures=true', undefined, sa);
  return (await get().catch(get)).steps[0].count;
};

console.log('=== C.0 before: no draft state exists (verified in the investigation); drafts table empty');
console.log('   application_drafts rows: ' + psql('SELECT count(*) FROM application_drafts;'));
const submittedBefore = await funnel();
console.log(`   analytics funnel "submitted" (SUPER_ADMIN, fixtures included): ${submittedBefore}`);

console.log('\n=== C.1 save and resume a draft');
const DR1 = await applicant('DR1', 'Gita', 'Ranchi');
const t1 = await login(DR1.email);
let r = await call('POST', '/application-drafts', { academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, t1, { raw: true });
line('POST /application-drafts (partial: year + declared input)', r, ` status=${r.body.status} id=${r.body.id}`);
saveR('save', r);
const draftId = r.body.id;
state.P14.dr.DR1.draftId = draftId;
save();
r = await call('POST', '/application-drafts', { declared: { family_income_annual: 90000, caste_cert_number: 'X' } }, t1, { raw: true });
line('POST with recorded/sensitive declared fields', r, ` ${r.body.details?.map((d) => d.field).join(', ')}`);
r = await call('PATCH', `/application-drafts/${draftId}`, { scheme_version_id: V.TOP_CLASS, institution_code: 'U-0510', course_name: 'B.Tech', course_year: 1 }, t1, { raw: true });
line('PATCH (scheme version, institution, course)', r, ` scheme_version_id=${r.body.scheme_version_id?.slice(0, 8)} course=${r.body.course_name}`);
r = await call('GET', `/application-drafts/${draftId}`, undefined, t1, { raw: true });
line('GET (resume)', r, ` ${JSON.stringify({ status: r.body.status, academic_year: r.body.academic_year, institution_code: r.body.institution_code, declared: r.body.declared })}`);
saveR('resume', r);
r = await call('GET', '/application-drafts', undefined, t1, { raw: true });
line('GET /application-drafts (mine)', r, ` count=${r.body.length}`);

console.log('\n=== C.2 private: officers, other applicants, analytics, fraud, selection');
for (const who of ['ino.ranchi.p11@example.org', 'sno.jharkhand.p11@example.org', 'auditor.jharkhand.p11@example.org', 'committee.ranchi.p11@example.org']) {
  r = await call('GET', `/application-drafts/${draftId}`, undefined, await login(who), { raw: true });
  line(`GET the draft as ${who.split('.p11')[0]}`, r);
}
const DR2 = await applicant('DR2', 'Hira', 'Ranchi');
const t2 = await login(DR2.email);
r = await call('GET', `/application-drafts/${draftId}`, undefined, t2, { raw: true });
line('GET the draft as another applicant', r);
r = await call('PATCH', `/application-drafts/${draftId}`, { course_year: 2 }, t2, { raw: true });
line('PATCH the draft as another applicant', r);
r = await call('GET', '/applications/queue', undefined, await login('ino.ranchi.p11@example.org'), { raw: true });
line('INO Ranchi queue', r, ` count=${r.body.count}; contains the draft applicant: ${r.body.applications.some((a) => a.applicant_id === psql(`SELECT id FROM applicants WHERE user_id=(SELECT id FROM accounts WHERE email='${DR1.email}');`))}`);
console.log(`   funnel "submitted" now: ${await funnel()} (before ${submittedBefore}; drafts are not counted - there is no draft bucket)`);
console.log('   applications of the draft applicant: ' + psql(`SELECT count(*) FROM applications a JOIN applicants p ON p.id=a.applicant_id JOIN accounts c ON c.id=p.user_id WHERE c.email='${DR1.email}';`));
console.log('   fraud flags / selections referencing a draft id: ' + psql(`SELECT (SELECT count(*) FROM fraud_flags WHERE application_id='${draftId}')||' / '||(SELECT count(*) FROM selections WHERE application_id='${draftId}');`));
console.log('   as app_user: owner=' + asAppUser(DR1.email, 'APPLICANT', 'SELECT count(*) FROM application_drafts') + ' other applicant=' + asAppUser(DR2.email, 'APPLICANT', 'SELECT count(*) FROM application_drafts') + ' INO Ranchi=' + asAppUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'SELECT count(*) FROM application_drafts') + ' MINISTRY=' + asAppUser('ministry.p11@example.org', 'MINISTRY_OFFICER', 'SELECT count(*) FROM application_drafts') + ' AUDITOR=' + asAppUser('auditor.jharkhand.p11@example.org', 'AUDITOR', 'SELECT count(*) FROM application_drafts') + ' no actor=' + asAppUser(null, '', 'SELECT count(*) FROM application_drafts'));
console.log('   another applicant inserting a draft for the owner: ' + asAppUser(DR2.email, 'APPLICANT', `INSERT INTO application_drafts (applicant_id, updated_at) SELECT p.id, now() FROM applicants p JOIN accounts c ON c.id=p.user_id WHERE c.email='${DR1.email}'`).split('\n')[0]);

console.log('\n=== C.3 submit: the existing submit gate, unchanged');
r = await call('POST', '/application-drafts', { declared: { education_level: LVL.TOP_CLASS } }, t1, { raw: true });
const incomplete = r.body.id;
r = await call('POST', `/application-drafts/${incomplete}/submit`, undefined, t1, { raw: true });
line('submit an incomplete draft (no version, no year)', r, ` ${r.body.details?.map((d) => d.field).join(', ')}`);
r = await call('POST', `/application-drafts/${draftId}/submit`, undefined, t1, { raw: true });
line('submit the complete draft', r, r.status === 201 ? ` draft=${r.body.draft.status} application=${r.body.application.application_no} stage=${r.body.application.current_stage} gate=${r.body.application.eligibility_gate?.outcome}` : ` ${JSON.stringify(r.body.details)}`);
saveR('submit', r);
if (r.status === 201) { state.P14.dr.DR1.applicationId = r.body.application.id; save(); }
r = await call('POST', `/application-drafts/${draftId}/submit`, undefined, t1, { raw: true });
line('submit it again', r, ` ${JSON.stringify(r.body.details)}`);
r = await call('PATCH', `/application-drafts/${draftId}`, { course_year: 2 }, t1, { raw: true });
line('edit it after submission', r, ` ${JSON.stringify(r.body.details)}`);
console.log('   raw UPDATE of the submitted draft (owner connection): ' + spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `BEGIN; UPDATE application_drafts SET course_year=3 WHERE id='${draftId}'; ROLLBACK;` }).stderr.toString().split('\n')[0]);
r = await call('GET', '/applications/queue', undefined, await login('ino.ranchi.p11@example.org'), { raw: true });
line('INO Ranchi queue now', r, ` contains the new application: ${r.body.applications.some((a) => a.id === state.P14.dr.DR1.applicationId)}`);
console.log(`   funnel "submitted" now: ${await funnel()} (before ${submittedBefore})`);
console.log('   application row: ' + psql(`SELECT application_no||' '||current_stage||' version=TOP_CLASS v'||(SELECT version_no FROM scheme_versions WHERE id=a.scheme_version_id)||' institution='||institution_code||' course='||course_name FROM applications a WHERE id='${state.P14.dr.DR1.applicationId}';`));

console.log('\n=== C.4 the old flow without a draft behaves as before');
r = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, t2, { raw: true });
line('POST /applications (DR2, no draft)', r, ` stage=${r.body.current_stage} gate=${r.body.eligibility_gate?.outcome}`);
saveR('direct', r);
if (r.status === 201) { state.P14.dr.DR2.applicationId = r.body.id; save(); }
r = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { family_income_annual: 1 } }, t2, { raw: true });
line('POST /applications with a recorded field declared (unchanged 400)', r, ` ${r.body.details?.map((d) => d.field).join(', ')}`);

console.log('\n=== C.5 audit rows');
console.log(psql(`SELECT a.seq||' '||a.action||' '||coalesce(a.actor_role,'-')||' status='||(a.row_data->>'status') FROM audit_logs a WHERE a.table_name='application_drafts' AND a.record_id='${draftId}' ORDER BY a.seq;`));
