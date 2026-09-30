// Phase 13E proofs 3, 4, 5: committee review, publication, objections, final list and freeze.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, upload, PW, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { marker } from '../p13c/c-setup.mjs';

const NFST_V5 = '021aac21-b45a-4c0a-9159-b80b053cc174';
const YEAR = '2031-32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveR = (n, r) => writeFileSync(`responses/p13e/${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${r.body?.details ? ' ' + JSON.stringify(r.body.details).slice(0, 170) : ''}${extra}`);
const officers = {
  ino: { Ranchi: 'ino.ranchi.p11@example.org', Dumka: 'ino.dumka.p11@example.org' },
  dno: { Ranchi: 'dno.ranchi.p11@example.org', Dumka: 'dno.dumka.p11@example.org' },
};
const tok = async (e) => login(e);

async function nfst(key, first, last, district, scores, lang) {
  state.P ??= {};
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(Object.keys(state.P).length + 500);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-13S${n}`, annual_income: '180000.00', bank_account: `SBIN0004455:13S0${n}0`, gender: 'FEMALE', dob: '1998-02-02', ...(lang ? { preferred_language: lang } : {}) }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${JSON.stringify(reg.body)}`);
  const declared = { education_level: LVL.NFST, degree_enrolled: 'Ph.D', tenure_years: 1, ...(scores ? { net_csir_net_score: scores[0], masters_or_4yr_bachelor_research_score: scores[1] } : {}) };
  const app = await call('POST', '/applications', { scheme_version_id: NFST_V5, academic_year: YEAR, declared }, await login(email));
  for (const who of [officers.ino[district], officers.dno[district], 'sno.jharkhand.p11@example.org']) {
    const r = await call('POST', `/applications/${app.id}/verify`, {}, await tok(who), { raw: true });
    if (r.status !== 200) throw new Error(`${key} verify by ${who}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no, district };
  save();
  return state.P[key];
}

console.log(`=== fixtures: NFST ${YEAR}, all verified to MINISTRY_APPROVED`);
const SL1 = await nfst('SL1', 'Rupa', 'Kerketta', 'Ranchi', [80, 70]);
const SL2 = await nfst('SL2', 'Mithun', 'Ekka', 'Ranchi', [60, 60]);
const SL3 = await nfst('SL3', 'Pushpa', 'Lakra', 'Ranchi', null, 'hi');
const SL4 = await nfst('SL4', 'Etwa', 'Oraon', 'Ranchi', null);
const SL5 = await nfst('SL5', 'Sukhmani', 'Tirkey', 'Ranchi', [75, 75]);
const SL6 = await nfst('SL6', 'Dukhni', 'Soren', 'Dumka', [70, 65]);
for (const [k, P] of Object.entries({ SL1, SL2, SL3, SL4, SL5, SL6 })) console.log(`  ${k} ${P.application_no} ${P.district} stage=${psql(`SELECT current_stage FROM applications WHERE id='${P.applicationId}';`)}`);

console.log('\n--- SL5 gets a HIGH fraud flag after approval (a file identical to another applicant\'s)');
const t5 = await login(SL5.email);
const slot5 = (await call('GET', `/applications/${SL5.applicationId}/documents`, undefined, t5)).checklist[0];
let r = await upload(t5, SL5.applicationId, slot5, marker('Phulmani', 'Kisku'));
console.log(`  upload: HTTP ${r.status}`);
await sleep(3000);
r = await call('POST', `/applications/${SL5.applicationId}/fraud-checks`, {}, await tok(officers.ino.Ranchi), { raw: true });
console.log(`  fraud check: HTTP ${r.status}; SL5 HIGH flags: ${psql(`SELECT string_agg(flag_type||'/'||status, ', ') FROM fraud_flags WHERE application_id='${SL5.applicationId}' AND severity='HIGH';`)}`);

console.log('\n=== run selection (MINISTRY_OFFICER) - the allocator, unchanged');
const min = await tok('ministry.p11@example.org');
r = await call('POST', `/schemes/NFST/academic-years/${YEAR}/run-selection`, {}, min, { raw: true });
saveR('c-run', r);
const listId = r.body.selection_list_id;
state.SL = { listId, runId: r.body.selection_run_id }; save();
line('run-selection', r, ` basis=${r.body.basis} counts=${JSON.stringify(r.body.counts)} list=${listId?.slice(0, 8)}`);
console.log('  entries (DB): ' + psql(`SELECT string_agg(a.application_no||' '||e.computed_outcome||' rank='||coalesce(e.computed_rank::text,'-')||coalesce(' '||e.not_selected_reason,''), '; ' ORDER BY e.computed_outcome DESC, e.computed_rank) FROM selection_list_entries e JOIN applications a ON a.id=e.application_id WHERE e.selection_list_id='${listId}';`));
await sleep(3000);
console.log('  applicant notifications at run time for these applicants: ' + psql(`SELECT count(*) FROM notifications WHERE template_key IN ('selection.provisionally_selected','selection.not_selected') AND application_id IN ('${[SL1, SL2, SL3, SL4, SL5, SL6].map((p) => p.applicationId).join("','")}');`) + ' (list-managed: told at publication)');

console.log('\n=== proof 5 (scope): who sees which entries');
for (const who of ['committee.ranchi.p11@example.org', 'committee.dumka.p11@example.org', 'auditor.jharkhand.p11@example.org', 'ministry.p11@example.org']) {
  const g = await call('GET', `/selection-lists/${listId}`, undefined, await tok(who), { raw: true });
  console.log(`  ${who.split('@')[0].padEnd(24)} GET list: HTTP ${g.status} status=${g.body.status} entries in scope=${g.body.entries_in_scope} [${(g.body.entries ?? []).map((e) => e.application_no.slice(-4) + ':' + e.computed_outcome).join(' ')}]`);
}
const entryOf = async (P) => (await call('GET', `/selection-lists/${listId}`, undefined, min, { raw: true })).body.entries.find((e) => e.application_id === P.applicationId);
const cr = await tok('committee.ranchi.p11@example.org');
const cd = await tok('committee.dumka.p11@example.org');
const e2 = await entryOf(SL2);
const e5 = await entryOf(SL5);
const e1 = await entryOf(SL1);

console.log('\n=== proof 3: committee review');
r = await call('POST', `/selection-lists/${listId}/entries/${e2.id}/override`, { decision: 'EXCLUDE', reason: 'too short' }, cr, { raw: true });
line('override SL2 EXCLUDE, reason "too short" (9)', r);
r = await call('POST', `/selection-lists/${listId}/entries/${e2.id}/override`, { decision: 'EXCLUDE', reason: 'Enrolment!' }, cr, { raw: true });
line('override SL2 EXCLUDE, reason "Enrolment!" (10)', r, ` committee_decision=${r.body.committee_decision}`);
console.log('  SL2 entry after: ' + psql(`SELECT 'computed '||computed_outcome||' rank '||computed_rank||' | committee '||committee_decision FROM selection_list_entries WHERE id='${e2.id}';`));
r = await call('POST', `/selection-lists/${listId}/entries/${e5.id}/override`, { decision: 'INCLUDE', reason: 'Candidate appears eligible on merit.' }, cr, { raw: true });
line('override SL5 (HELD) INCLUDE', r);
r = await call('POST', `/selection-lists/${listId}/entries/${e1.id}/override`, { decision: 'EXCLUDE', reason: 'Trying to act outside my district.' }, cd, { raw: true });
line('committee.dumka override SL1 (Ranchi)', r);
const raw = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='committee.ranchi.p11@example.org'), true), set_config('app.actor_role', 'COMMITTEE', true)) s; INSERT INTO selection_committee_decisions (selection_list_id, entry_id, officer_id, kind, reason) VALUES ('${listId}', '${e2.id}', (SELECT o.id FROM officers o JOIN accounts a ON a.id=o.user_id WHERE a.email='committee.ranchi.p11@example.org'), 'OVERRIDE_EXCLUDE', 'too short'); ROLLBACK;` });
console.log(`  raw INSERT of a decision with a 9-character reason (app_user, rolled back): ${raw.stderr.toString().trim().split('\n')[0]}`);

r = await call('POST', `/selection-lists/${listId}/approve`, {}, cr, { raw: true });
line('committee.ranchi approves the list', r);
r = await call('POST', `/selection-lists/${listId}/publish-provisional`, {}, await tok('auditor.jharkhand.p11@example.org'), { raw: true });
line('AUDITOR tries to publish', r);
r = await call('POST', `/selection-lists/${listId}/approve`, {}, await tok('auditor.jharkhand.p11@example.org'), { raw: true });
line('AUDITOR tries to approve', r);

console.log('\n=== proof 4: publication path');
r = await call('POST', `/selection-lists/${listId}/publish-provisional`, {}, min, { raw: true });
saveR('c-publish-provisional', r);
line('MINISTRY publishes the provisional list', r, ` status=${r.body.status} window_closes_at=${r.body.window_closes_at} notified=${r.body.notified}`);
r = await call('POST', `/selection-lists/${listId}/entries/${e2.id}/override`, { decision: 'INCLUDE', reason: 'Changing my mind after publication.' }, cr, { raw: true });
line('override after publication', r);
const obj = async (P, text) => call('POST', '/grievances', { application_id: P.applicationId, subject_type: 'SELECTION_OBJECTION', selection_run_id: state.SL.runId, description: text }, await login(P.email), { raw: true });
const g3 = await obj(SL3, 'My NET score was not considered in the ranking.');
line('SL3 raises an objection', g3);
const g4 = await obj(SL4, 'I should have been selected.');
line('SL4 raises an objection', g4);
r = await call('POST', `/selection-lists/${listId}/close-objection-window`, {}, min, { raw: true });
line('MINISTRY closes the window (not elapsed)', r);
r = await call('POST', `/selection-lists/${listId}/close-objection-window-early`, { reason: 'Committee sat on 30 Sep and heard all objections.' }, cr, { raw: true });
line('COMMITTEE closes early with 2 objections undecided', r);
r = await call('POST', `/selection-lists/${listId}/objections/${g3.body.id}/decide`, { outcome: 'UPHELD', reason: 'Your NET score is verified; you are included in the list.' }, cr, { raw: true });
line('COMMITTEE upholds SL3', r, ` committee_decision=${r.body.committee_decision}`);
r = await call('POST', `/selection-lists/${listId}/objections/${g4.body.id}/decide`, { outcome: 'DISMISSED', reason: 'No merit score was submitted with the application.' }, cr, { raw: true });
line('COMMITTEE dismisses SL4', r);
console.log('  grievances now: ' + psql(`SELECT string_agg(a.application_no||' '||g.status, '; ') FROM grievances g JOIN applications a ON a.id=g.application_id WHERE g.id IN ('${g3.body.id}','${g4.body.id}');`));
r = await call('POST', `/selection-lists/${listId}/close-objection-window-early`, { reason: 'Committee sat on 30 Sep and heard all objections.' }, cr, { raw: true });
line('COMMITTEE closes early (all decided)', r, ` status=${r.body.status} early=${r.body.window_closed_early}`);
r = await obj(SL4, 'A second objection after closing.');
line('objection after the window closed', r);
r = await call('POST', `/selection-lists/${listId}/publish-final`, {}, min, { raw: true });
saveR('c-publish-final', r);
line('MINISTRY publishes the final list', r, ` status=${r.body.status} final=${JSON.stringify(r.body.final)}`);
console.log('  final (DB): ' + psql(`SELECT string_agg(a.application_no||' computed '||e.computed_outcome||coalesce(' rank '||e.computed_rank,'')||coalesce(' +'||e.committee_decision,'')||' => '||e.final_outcome, '; ' ORDER BY a.application_no) FROM selection_list_entries e JOIN applications a ON a.id=e.application_id WHERE e.selection_list_id='${listId}';`));

console.log('\n--- the final list is frozen');
r = await call('POST', `/selection-lists/${listId}/entries/${e1.id}/override`, { decision: 'EXCLUDE', reason: 'Trying to edit the final list.' }, cr, { raw: true });
line('override after final', r);
for (const [label, sql] of [
  ['raw UPDATE of an entry', `UPDATE selection_list_entries SET final_outcome='NOT_SELECTED' WHERE id='${e1.id}';`],
  ['raw INSERT of a decision', `INSERT INTO selection_committee_decisions (selection_list_id, entry_id, officer_id, kind, reason) VALUES ('${listId}', '${e1.id}', (SELECT id FROM officers LIMIT 1), 'OVERRIDE_EXCLUDE', 'Editing a frozen list.');`],
  ['raw UPDATE of the list', `UPDATE selection_lists SET status='DRAFT' WHERE id='${listId}';`],
]) {
  const x = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `BEGIN; ${sql} ROLLBACK;` });
  console.log(`  ${label.padEnd(28)} (owner, rolled back): ${x.stderr.toString().trim().split('\n')[0] || 'ACCEPTED'}`);
}

console.log('\n--- confirmation follows the final list');
const sel = (P) => psql(`SELECT id FROM selections WHERE application_id='${P.applicationId}' AND selection_run_id='${state.SL.runId}';`);
r = await call('POST', `/selections/${sel(SL2)}/confirm`, { override_reason: 'Committee final list published on 30 Sep.' }, min, { raw: true });
line('confirm SL2 (excluded by the committee)', r);
r = await call('POST', `/selections/${sel(SL1)}/confirm`, { override_reason: 'Committee final list published on 30 Sep.' }, min, { raw: true });
line('confirm SL1 (selected in the final list)', r, ` status=${r.body.selection?.selection_status}`);

console.log('\n=== proof 5: results');
for (const [label, who, P] of [['SL3 own result', SL3.email, SL3], ['SL3 asks for SL1', SL3.email, SL1], ['committee.dumka for SL1', 'committee.dumka.p11@example.org', SL1], ['committee.ranchi for SL1', 'committee.ranchi.p11@example.org', SL1], ['AUDITOR for SL5', 'auditor.jharkhand.p11@example.org', SL5]]) {
  r = await call('GET', `/applications/${P.applicationId}/selection-result`, undefined, await tok(who), { raw: true });
  if (label === 'SL3 own result') saveR('c-result-SL3', r);
  line(label, r, r.status === 200 ? ` computed=${r.body.computed_outcome} rank=${r.body.computed_rank} committee=${r.body.committee_decision} final=${r.body.final_outcome} score=${r.body.score ? r.body.score.score_type : 'none'}` : '');
}
await sleep(4000);
console.log('\n--- notifications to the six (in-app): template / locale');
console.log(psql(`SELECT string_agg(a.application_no||' '||n.template_key||' '||n.locale, E'\\n') FROM notifications n JOIN applications a ON a.id=n.application_id WHERE n.channel='IN_APP' AND n.template_key IN ('selection.list_provisional','selection.list_final','grievance.resolved','grievance.rejected') AND a.id IN ('${[SL1, SL2, SL3, SL4, SL5, SL6].map((p) => p.applicationId).join("','")}');`));
console.log('\nSL3 (Hindi) final notice: ' + psql(`SELECT subject||' / '||replace(body, E'\\n', ' / ') FROM notifications WHERE application_id='${SL3.applicationId}' AND template_key='selection.list_final' AND channel='IN_APP';`));
