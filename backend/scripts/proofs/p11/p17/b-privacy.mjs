// Phase 17 Part B proofs: consent gate, data export scoping, correction request round trip,
// erasure request recorded (nothing deleted).
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const saveR = (n, r) => writeFileSync(`responses/p17/b-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(70)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asUser = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};
state.P17 ??= {};
async function applicant(key, first, last, district, lang) {
  if (state.P17[key]) return state.P17[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(100 + Object.keys(state.P17).length);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-17P${n}`, annual_income: '130000.00', bank_account: `SBIN0004455:17P0${n}0`, gender: 'FEMALE', dob: '2003-03-03', preferred_language: lang }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  state.P17[key] = { email };
  save();
  return state.P17[key];
}
const P1 = await applicant('PV1', 'Rinki', 'Toppo', 'Ranchi', 'hi');
const P2 = await applicant('PV2', 'Mary', 'Bara', 'Dumka', 'en');
const t1 = await login(P1.email);
const t2 = await login(P2.email);

console.log('=== B2 consent');
let r = await call('GET', '/applicants/me/consents', undefined, t1, { raw: true });
line('PV1 GET /applicants/me/consents (new applicant)', r, ` notice_version=${r.body.notice_version} language=${r.body.language} missing=${JSON.stringify(r.body.missing_for_applications)}`);
console.log(`   notice (hi) ${r.body.purposes[0].title_key}: ${r.body.purposes[0].title}`);
saveR('consents-before', r);
const apply = (t) => call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, t, { raw: true });
r = await apply(t1);
line('PV1 submits an application without consent', r, ` ${JSON.stringify(r.body.details)} message="${r.body.message}"`);
const give = (t, purpose, status = 'GIVEN', notice_version = '2026-10-v1', language = 'hi') => call('POST', '/applicants/me/consents', { purpose, status, notice_version, language }, t, { raw: true });
r = await give(t1, 'application_processing', 'GIVEN', 'old-v0');
line('PV1 consents to an out-of-date notice version', r, ` ${JSON.stringify(r.body.details)}`);
r = await give(t1, 'application_processing');
line('PV1 gives consent: application_processing', r, ` missing=${JSON.stringify(r.body.missing_for_applications)}`);
r = await apply(t1);
line('PV1 submits (one purpose still missing)', r, ` ${JSON.stringify(r.body.details?.missing_purposes)}`);
r = await give(t1, 'government_verification');
line('PV1 gives consent: government_verification', r, ` missing=${JSON.stringify(r.body.missing_for_applications)}`);
r = await apply(t1);
line('PV1 submits with consent', r, ` ${r.body.application_no} stage=${r.body.current_stage}`);
if (r.status === 201) { state.P17.PV1.applicationId = r.body.id; save(); }
r = await give(t1, 'notifications', 'WITHDRAWN');
line('PV1 withdraws consent: notifications', r);
r = await call('GET', '/applicants/me/consents', undefined, t1, { raw: true });
console.log(`   PV1 history: ${r.body.history.map((h) => `${h.purpose}:${h.status}:${h.notice_version}`).join(', ')}`);
saveR('consents-after', r);
r = await call('GET', '/applicants/me/consents', undefined, t2, { raw: true });
line('PV2 GET own consents', r, ` history rows=${r.body.history.length}`);
for (const who of ['ino.ranchi', 'auditor.jharkhand']) {
  r = await call('GET', '/applicants/me/consents', undefined, await login(`${who}.p11@example.org`), { raw: true });
  line(`${who} GET /applicants/me/consents`, r);
}
console.log('   consent_records as app_user: PV1=' + asUser(P1.email, 'APPLICANT', 'SELECT count(*) FROM consent_records') + ' PV2=' + asUser(P2.email, 'APPLICANT', 'SELECT count(*) FROM consent_records') + ' INO Ranchi=' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'SELECT count(*) FROM consent_records') + ' AUDITOR=' + asUser('auditor.jharkhand.p11@example.org', 'AUDITOR', 'SELECT count(*) FROM consent_records') + ' no actor=' + asUser(null, '', 'SELECT count(*) FROM consent_records'));
console.log('   PV1 updating its consent row: ' + asUser(P1.email, 'APPLICANT', `UPDATE consent_records SET status='GIVEN' WHERE purpose='notifications'`));
console.log('   audit rows of consent_records (keys): ' + psql(`SELECT count(*)||' rows; keys '||(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys((SELECT row_data FROM audit_logs WHERE table_name='consent_records' ORDER BY seq DESC LIMIT 1)) k) FROM audit_logs WHERE table_name='consent_records';`));

console.log('\n=== B3 access to own data');
r = await call('GET', '/applicants/me/data-export', undefined, t1, { raw: true });
line('PV1 GET /applicants/me/data-export', r, ` sections=${Object.keys(r.body).join(',')}`);
saveR('data-export', r);
console.log(`   profile: ${r.body.profile.first_name} ${r.body.profile.last_name}, caste_cert=${r.body.profile.caste_cert_number_masked}, bank=${r.body.profile.bank_account_masked}; applications=${r.body.applications.length}; notifications=${r.body.notifications.length}; consent history=${r.body.consents.history.length}`);
const text = JSON.stringify(r.body);
console.log(`   contains PV2's name / e-mail: ${text.includes('Mary') || text.includes(P2.email)}; full caste cert: ${text.includes('JH-ST-2026-17P')}; full bank account: ${text.includes('SBIN0004455:17P')}`);
for (const [who, t] of [['PV2 (another applicant)', t2], ['INO Ranchi', await login('ino.ranchi.p11@example.org')], ['SUPER_ADMIN', await login('admin.p11@example.org')], ['AUDITOR', await login('auditor.jharkhand.p11@example.org')]]) {
  r = await call('GET', '/applicants/me/data-export', undefined, t, { raw: true });
  line(`${who} GET /applicants/me/data-export`, r, r.status === 200 ? ` (own export: ${r.body.profile.first_name})` : '');
}
r = await fetch('http://127.0.0.1:3000/api/v1/applicants/me/data-export');
console.log(`   no token: HTTP ${r.status}`);

console.log('\n=== B4 correction request: applicant -> officer decision -> verified update');
r = await call('POST', '/applicants/me/correction-requests', { field: 'last_name', value: 'Toppno', reason: 'too short' }, t1, { raw: true });
line('PV1 files with a 9-character reason', r, ` ${r.body.code === 'REASON_REQUIRED' ? JSON.stringify(r.body.details) : ''}`);
r = await call('POST', '/applicants/me/correction-requests', { field: 'category', value: 'PVTG', reason: 'Category is wrong in my profile.' }, t1, { raw: true });
line('PV1 asks to correct category (not a correctable field)', r, ` ${JSON.stringify(r.body.details)}`);
r = await call('POST', '/applicants/me/correction-requests', { field: 'dob', value: '2099-01-01', reason: 'Date of birth is recorded wrongly.' }, t1, { raw: true });
line('PV1 asks for a future date of birth', r, ` ${JSON.stringify(r.body.details)}`);
r = await call('POST', '/applicants/me/correction-requests', { field: 'last_name', value: 'Toppno', reason: 'My surname is spelt Toppno on my 10th certificate.' }, t1, { raw: true });
line('PV1 files: last_name -> "Toppno"', r, ` id=${r.body.id} status=${r.body.status}`);
const reqId = r.body.id;
saveR('correction-filed', r);
console.log('   stored: ' + psql(`SELECT field||' status='||status||' value bytes='||length(requested_value_encrypted)||' value in clear: '||(encode(requested_value_encrypted,'escape') LIKE '%Toppno%') FROM correction_requests WHERE id='${reqId}';`));
console.log('   audit row carries the value in clear: ' + psql(`SELECT count(*) FROM audit_logs WHERE table_name='correction_requests' AND row_data::text LIKE '%Toppno%';`));
for (const who of ['ino.ranchi', 'ino.dumka', 'auditor.jharkhand']) {
  r = await call('GET', '/correction-requests?status=OPEN', undefined, await login(`${who}.p11@example.org`), { raw: true });
  line(`${who} GET /correction-requests?status=OPEN`, r, ` contains PV1's request: ${r.body.requests?.some((x) => x.id === reqId)}`);
}
r = await call('POST', `/correction-requests/${reqId}/decide`, { decision: 'APPROVE', reason: 'short' }, await login('ino.ranchi.p11@example.org'), { raw: true });
line('INO Ranchi decides with a 5-character reason', r);
r = await call('POST', `/correction-requests/${reqId}/decide`, { decision: 'APPROVE', reason: 'Matches the 10th certificate on file.' }, await login('ino.dumka.p11@example.org'), { raw: true });
line('INO Dumka (other district) decides', r);
r = await call('POST', `/correction-requests/${reqId}/decide`, { decision: 'APPROVE', reason: 'Matches the 10th certificate on file.' }, await login('auditor.jharkhand.p11@example.org'), { raw: true });
line('AUDITOR decides', r);
console.log('   DB CHECK, short decision reason as INO Ranchi: ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `INSERT INTO correction_decisions (request_id, officer_id, decision, reason) VALUES ('${reqId}', (SELECT o.id FROM officers o JOIN accounts a ON a.id=o.user_id WHERE a.email='ino.ranchi.p11@example.org'), 'APPROVE', 'short')`));
r = await call('POST', `/correction-requests/${reqId}/decide`, { decision: 'APPROVE', reason: 'Matches the 10th certificate on file.' }, await login('ino.ranchi.p11@example.org'), { raw: true });
line('INO Ranchi approves', r, ` status=${r.body.status} decision=${JSON.stringify(r.body.decision)}`);
saveR('correction-decided', r);
r = await call('POST', `/correction-requests/${reqId}/decide`, { decision: 'REJECT', reason: 'Changing my mind after approving.' }, await login('ino.ranchi.p11@example.org'), { raw: true });
line('INO Ranchi decides again', r, ` ${JSON.stringify(r.body.details)}`);
console.log('   applicant now: ' + psql(`SELECT last_name FROM applicants WHERE email='${P1.email}';`) + '; change log: ' + psql(`SELECT string_agg(array_to_string(changed_fields, ',')||' by '||(SELECT email FROM accounts WHERE id=changed_by_account_id), '; ') FROM applicant_profile_changes c JOIN applicants a ON a.id=c.applicant_id WHERE a.email='${P1.email}';`));
console.log('   raw DB: re-opening the decided request: ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `UPDATE correction_requests SET status='REJECTED' WHERE id='${reqId}'`));
console.log('   raw DB: deleting the decision: ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `DELETE FROM correction_decisions WHERE request_id='${reqId}'`));
await sleep(2500);
console.log('   notice to PV1: ' + psql(`SELECT locale||' '||channel||' | '||subject||' | '||replace(body, E'\\n', ' / ') FROM notifications WHERE template_key='privacy.correction_decided' AND recipient_account_id=(SELECT id FROM accounts WHERE email='${P1.email}') AND channel='IN_APP';`));
console.log('   audit: ' + psql(`SELECT string_agg(table_name||' '||action||' '||actor_role, '; ' ORDER BY seq) FROM audit_logs WHERE record_id IN ('${reqId}', (SELECT id FROM correction_decisions WHERE request_id='${reqId}'));`));

console.log('\n=== B5 erasure request (recorded; nothing deleted)');
const counts = () => psql(`SELECT 'applicant='||(SELECT count(*) FROM applicants WHERE email='${P1.email}')||' applications='||(SELECT count(*) FROM applications a JOIN applicants p ON p.id=a.applicant_id WHERE p.email='${P1.email}')||' notifications='||(SELECT count(*) FROM notifications WHERE recipient_account_id=(SELECT id FROM accounts WHERE email='${P1.email}'))||' consents='||(SELECT count(*) FROM consent_records c JOIN applicants p ON p.id=c.applicant_id WHERE p.email='${P1.email}');`);
const before = counts();
r = await call('POST', '/applicants/me/erasure-requests', undefined, t1, { raw: true });
line('PV1 requests erasure', r, ` status=${r.body.status} deleted=${r.body.deleted} key=${r.body.message_key}`);
console.log(`   message (hi): ${r.body.message}`);
saveR('erasure', r);
console.log(`   before: ${before}\n   after : ${counts()}`);
r = await call('GET', '/applicants/me/erasure-requests', undefined, t2, { raw: true });
line('PV2 GET own erasure requests', r, ` count=${r.body.requests.length}`);
