// Phase 13E proof 4 (full publication path, fresh run): objections by committee-excluded
// applicants, decided with reasons; window closed; final list published and frozen.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const NFST_V5 = '021aac21-b45a-4c0a-9159-b80b053cc174';
const YEAR = '2032-33';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (label, r, extra = '') => console.log(`${label.padEnd(62)} HTTP ${r.status} ${r.body?.code ?? ''}${r.body?.details ? ' ' + JSON.stringify(r.body.details).slice(0, 150) : ''}${extra}`);
async function nfst(key, first, last, scores, lang) {
  state.P ??= {};
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(Object.keys(state.P).length + 600);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-13M${n}`, annual_income: '180000.00', bank_account: `SBIN0004455:13M0${n}0`, gender: 'MALE', dob: '1997-03-03', ...(lang ? { preferred_language: lang } : {}) }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${JSON.stringify(reg.body)}`);
  const app = await call('POST', '/applications', { scheme_version_id: NFST_V5, academic_year: YEAR, declared: { education_level: LVL.NFST, degree_enrolled: 'Ph.D', tenure_years: 1, net_csir_net_score: scores[0], masters_or_4yr_bachelor_research_score: scores[1] } }, await login(email));
  for (const who of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand']) {
    const r = await call('POST', `/applications/${app.id}/verify`, {}, await login(`${who}.p11@example.org`), { raw: true });
    if (r.status !== 200) throw new Error(`${key} verify ${who}: ${JSON.stringify(r.body)}`);
  }
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  return state.P[key];
}
const SM1 = await nfst('SM1', 'Birsa', 'Kujur', [80, 70]);
const SM2 = await nfst('SM2', 'Lalita', 'Minz', [70, 60], 'hi');
const SM3 = await nfst('SM3', 'Chotu', 'Oraon', [60, 60]);
const SM4 = await nfst('SM4', 'Hiramani', 'Tete', [55, 50]);
const all = [SM1, SM2, SM3, SM4];
const min = await login('ministry.p11@example.org');
const cr = await login('committee.ranchi.p11@example.org');
let r = await call('POST', `/schemes/NFST/academic-years/${YEAR}/run-selection`, {}, min, { raw: true });
const listId = r.body.selection_list_id;
const runId = r.body.selection_run_id;
state.SM = { listId, runId }; save();
line('run-selection NFST ' + YEAR, r, ` counts=${JSON.stringify(r.body.counts)}`);
const entries = (await call('GET', `/selection-lists/${listId}`, undefined, min, { raw: true })).body.entries;
const E = (P) => entries.find((e) => e.application_id === P.applicationId);
console.log('  computed: ' + all.map((P, i) => `SM${i + 1} ${E(P).computed_outcome} rank ${E(P).computed_rank}`).join('; '));

r = await call('POST', `/selection-lists/${listId}/entries/${E(SM2).id}/override`, { decision: 'EXCLUDE', reason: 'Research score not attested by the university.' }, cr, { raw: true });
line('committee EXCLUDE SM2', r);
r = await call('POST', `/selection-lists/${listId}/entries/${E(SM3).id}/override`, { decision: 'EXCLUDE', reason: 'Enrolment letter is for a different programme.' }, cr, { raw: true });
line('committee EXCLUDE SM3', r);
r = await call('POST', `/selection-lists/${listId}/publish-provisional`, {}, min, { raw: true });
line('publish before any approval', r);
r = await call('POST', `/selection-lists/${listId}/approve`, { reason: 'Reviewed on 30 Sep.' }, cr, { raw: true });
line('committee approves', r);
r = await call('POST', `/selection-lists/${listId}/publish-provisional`, {}, min, { raw: true });
line('MINISTRY publishes the provisional list', r, ` status=${r.body.status} window_closes_at=${r.body.window_closes_at?.slice(0, 10)}`);

const obj = async (P, text) => call('POST', '/grievances', { application_id: P.applicationId, subject_type: 'SELECTION_OBJECTION', selection_run_id: runId, description: text }, await login(P.email), { raw: true });
r = await obj(SM1, 'I am selected but object anyway.');
line('SM1 (selected) objects', r);
const g2 = await obj(SM2, 'My research score is attested; the certificate is attached.');
line('SM2 (excluded) objects', g2);
const g3 = await obj(SM3, 'My enrolment is for the programme I applied for.');
line('SM3 (excluded) objects', g3);
r = await call('POST', `/selection-lists/${listId}/close-objection-window-early`, { reason: 'Committee sat on 30 Sep and heard all objections.' }, cr, { raw: true });
line('committee closes early with 2 objections undecided', r);
r = await call('POST', `/selection-lists/${listId}/objections/${g2.body.id}/decide`, { outcome: 'UPHELD', reason: 'too short' }, cr, { raw: true });
line('decide SM2 with a 9-character reason', r);
r = await call('POST', `/selection-lists/${listId}/objections/${g2.body.id}/decide`, { outcome: 'UPHELD', reason: 'The attested research score was verified with the university.' }, cr, { raw: true });
line('committee UPHOLDS SM2', r, ` committee_decision=${r.body.committee_decision}`);
r = await call('POST', `/selection-lists/${listId}/objections/${g3.body.id}/decide`, { outcome: 'DISMISSED', reason: 'The enrolment letter names a different programme.' }, cr, { raw: true });
line('committee DISMISSES SM3', r);
console.log('  grievances: ' + psql(`SELECT string_agg(a.application_no||' '||g.status, '; ' ORDER BY a.application_no) FROM grievances g JOIN applications a ON a.id=g.application_id WHERE g.id IN ('${g2.body.id}','${g3.body.id}');`));
r = await call('POST', `/selection-lists/${listId}/close-objection-window`, {}, min, { raw: true });
line('MINISTRY closes (window not elapsed)', r);
r = await call('POST', `/selection-lists/${listId}/close-objection-window-early`, { reason: 'Committee sat on 30 Sep and heard all objections.' }, cr, { raw: true });
line('committee closes early (all decided)', r, ` status=${r.body.status} early=${r.body.window_closed_early}`);
r = await obj(SM4, 'Objecting after the window closed.');
line('objection after closing', r);
r = await call('POST', `/selection-lists/${listId}/publish-final`, {}, min, { raw: true });
writeFileSync('responses/p13e/c2-publish-final.json', JSON.stringify(r, null, 1));
line('MINISTRY publishes the final list', r, ` status=${r.body.status} final=${JSON.stringify(r.body.final)}`);
console.log('  final (DB): ' + psql(`SELECT string_agg(a.application_no||' rank '||e.computed_rank||' '||e.computed_outcome||coalesce(' +'||e.committee_decision,'')||' => '||e.final_outcome, '; ' ORDER BY e.computed_rank) FROM selection_list_entries e JOIN applications a ON a.id=e.application_id WHERE e.selection_list_id='${listId}';`));
console.log('  decisions (DB): ' + psql(`SELECT string_agg(kind||' reason_len='||coalesce(length(reason),0), '; ' ORDER BY created_at) FROM selection_committee_decisions WHERE selection_list_id='${listId}';`));
console.log('  audit rows: lists ' + psql(`SELECT count(*) FROM audit_logs WHERE table_name='selection_lists' AND record_id='${listId}';`) + ', entries ' + psql(`SELECT count(*) FROM audit_logs WHERE table_name='selection_list_entries' AND record_id IN (SELECT id FROM selection_list_entries WHERE selection_list_id='${listId}');`) + ', decisions ' + psql(`SELECT count(*) FROM audit_logs WHERE table_name='selection_committee_decisions' AND record_id IN (SELECT id FROM selection_committee_decisions WHERE selection_list_id='${listId}');`));
r = await call('POST', `/selection-lists/${listId}/approve`, {}, cr, { raw: true });
line('approve after final', r);
const x = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `BEGIN; UPDATE selection_list_entries SET committee_decision='INCLUDE' WHERE id='${E(SM3).id}'; ROLLBACK;` });
console.log(`  raw UPDATE of SM3's entry (owner, rolled back): ${x.stderr.toString().trim().split('\n')[0]}`);
await sleep(5000);
console.log('\nnotifications (in-app):');
console.log(psql(`SELECT string_agg(a.application_no||' '||n.template_key||' '||n.locale, E'\\n' ORDER BY a.application_no, n.created_at) FROM notifications n JOIN applications a ON a.id=n.application_id WHERE n.channel='IN_APP' AND a.id IN ('${all.map((p) => p.applicationId).join("','")}') AND n.template_key IN ('selection.list_provisional','selection.list_final','grievance.registered','grievance.resolved','grievance.rejected');`));
console.log('SM2 (Hindi) objection outcome: ' + psql(`SELECT replace(body, E'\\n', ' / ') FROM notifications WHERE application_id='${SM2.applicationId}' AND template_key='grievance.resolved' AND channel='IN_APP';`));
console.log('SM2 (Hindi) final: ' + psql(`SELECT replace(body, E'\\n', ' / ') FROM notifications WHERE application_id='${SM2.applicationId}' AND template_key='selection.list_final' AND channel='IN_APP';`));
