// Phase 16 Part B proof: a brand-new scheme authored through the API with its own scoring
// weights and a declared QUOTA selection basis; six synthetic applicants; selection to a
// provisional list, reproducible.
import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';

const CODE = 'FOREST_SCIENCE_P16';
const YEAR = '2026-27';
const saveR = (n, r) => writeFileSync(`responses/p16/b-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const must = (label, r, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
state.P16 ??= {};
state.P16.fs ??= { apps: {} };
const S = state.P16.fs;
const mo = await login('ministry.p11@example.org');

const config = (policy) => ({
  workflow: 'vidyasetu-scrutiny/v1',
  rules: [
    { id: 'category_match', type: 'eligibility', expr: 'applicant.category in params.allowed_categories', params: { allowed_categories: ['ST', 'PVTG'] }, doc_refs: [], message_key: 'eligibility.category_not_allowed', verification: { status: 'PENDING_AUDIT' } },
    { id: 'forest_merit', type: 'operational', expr: 'params.exam_weight * applicant.exam_score + params.field_weight * applicant.field_score', params: { exam_weight: 0.7, field_weight: 0.3 }, doc_refs: [], message_key: 'selection.merit_score' },
  ],
  benefits: [],
  required_documents: [],
  fund_sharing_ratio: null,
  selection_policy: policy,
});
const POLICY = { basis: 'QUOTA', merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' }, pools: [{ key: 'ST_OTHERS', seats: 2, female_percentage: 50, rounding: 'HALF_UP' }, { key: 'PVTG', seats: 1 }] };

console.log('=== B.1 authoring: malformed declarations are refused (standard error shape, message keys)');
must('scheme', await call('POST', '/admin/schemes', { code: CODE, name: 'Forest Science Fellowship (P16 synthetic)', department: 'Test data', type: 'CENTRAL_SECTOR' }, mo, { raw: true }), [201, 409]);
for (const [label, policy] of [
  ['basis LOTTERY', { basis: 'LOTTERY' }],
  ['QUOTA with pool key GENERAL', { ...POLICY, pools: [{ key: 'GENERAL', seats: 2 }] }],
  ['merit from an eligibility rule', { basis: 'RANKED_NO_CAP', merit: { rule_id: 'category_match', direction: 'HIGHER_IS_BETTER' } }],
]) {
  const r = await call('POST', `/admin/schemes/${CODE}/versions`, { config: config(policy) }, mo, { raw: true });
  line(`draft with ${label}`, r, ` ${r.body.details?.map((d) => `${d.field} ${d.message_key}: ${Object.values(d.constraints)[0]}`).join(' || ')}`);
}

if (!S.versionId) {
  const d = must('draft', await call('POST', `/admin/schemes/${CODE}/versions`, { config: config(POLICY) }, mo, { raw: true }));
  const v = must('validate', await call('POST', `/admin/schemes/${CODE}/versions/${d.version_no}/validate`, undefined, mo, { raw: true }));
  const p = must('publish', await call('POST', `/admin/schemes/${CODE}/versions/${d.version_no}/publish`, {}, mo, { raw: true }));
  S.versionId = p.version.id;
  S.versionNo = d.version_no;
  S.validate = v;
  save();
}
console.log(`\n=== B.2 published ${CODE} v${S.versionNo} ${S.versionId}; declared policy: ${JSON.stringify(POLICY)}`);

console.log('\n=== B.3 six synthetic applicants (fixtures), through the workflow to MINISTRY_APPROVED');
const PEOPLE = [
  ['FS1', 'Sona', 'ST', 'FEMALE', 'Ranchi', 80, 60],
  ['FS2', 'Budhan', 'ST', 'MALE', 'Ranchi', 90, 70],
  ['FS3', 'Mangri', 'ST', 'FEMALE', 'Ranchi', 70, 50],
  ['FS4', 'Lakhan', 'ST', 'MALE', 'Ranchi', 85, 80],
  ['FS5', 'Paulus', 'PVTG', 'MALE', 'Ranchi', 60, 90],
  ['FS6', 'Somri', 'PVTG', 'FEMALE', 'Ranchi', 75, 75],
];
const reviewed = { eligibility_review_confirmed: true, remarks: 'Eligibility checked for the declared-basis demo.' };
for (const [key, first, category, gender, district, exam, field] of PEOPLE) {
  if (S.apps[key]) continue;
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = PEOPLE.findIndex((p) => p[0] === key) + 1;
  must(`register ${key}`, await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: 'Forest', category, domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-16F${n}0`, annual_income: '140000.00', bank_account: `SBIN0004455:16F0${n}00`, gender, dob: '2000-05-05' }, undefined, { raw: true }));
  const app = must(`apply ${key}`, await call('POST', '/applications', { scheme_version_id: S.versionId, academic_year: YEAR, declared: { exam_score: exam, field_score: field } }, await login(email), { raw: true }));
  for (const who of ['ino.ranchi.p11@example.org', 'dno.ranchi.p11@example.org', 'sno.jharkhand.p11@example.org']) {
    const r = await call('POST', `/applications/${app.id}/verify`, who.startsWith('ino') ? reviewed : {}, await login(who), { raw: true });
    must(`verify ${key} ${who}`, r);
  }
  S.apps[key] = { email, applicationId: app.id, application_no: app.application_no, category, gender, score: Math.round((0.7 * exam + 0.3 * field) * 1000) / 1000 };
  save();
}
for (const [k, a] of Object.entries(S.apps)) console.log(`   ${k} ${a.application_no} ${a.category.padEnd(4)} ${a.gender.padEnd(6)} expected merit ${a.score} stage ${psql(`SELECT current_stage FROM applications WHERE id='${a.applicationId}';`)}`);

console.log('\n=== B.4 selection: dry run twice (reproducible), then the real run to a provisional list');
const strip = (b) => JSON.stringify({ ...b, generated_at: undefined });
const d1 = await call('POST', `/schemes/${CODE}/academic-years/${YEAR}/run-selection`, { dry_run: true }, mo, { raw: true });
const d2 = await call('POST', `/schemes/${CODE}/academic-years/${YEAR}/run-selection`, { dry_run: true }, mo, { raw: true });
saveR('dryrun-1', d1);
line('dry run #1', d1, ` basis=${d1.body.basis} counts=${JSON.stringify(d1.body.counts)}`);
line('dry run #2', d2, ` byte-identical to #1: ${JSON.stringify(d1.body) === JSON.stringify(d2.body)} (${JSON.stringify(d1.body).length} bytes)`);
console.log(`   policy: ${JSON.stringify(d1.body.policy)}`);
const show = (b) => {
  for (const s of b.selected ?? []) console.log(`   SELECTED     ${S.apps[Object.keys(S.apps).find((k) => S.apps[k].applicationId === s.application_id)] ? Object.keys(S.apps).find((k) => S.apps[k].applicationId === s.application_id) : '?'} rank=${s.merit_rank} pool=${s.vertical_category} under=${s.selected_under ?? s.horizontal_reservation ?? 'merit'} merit=${s.merit?.value ?? s.merit_value ?? JSON.stringify(s.merit)}`);
  for (const s of b.not_selected ?? []) console.log(`   NOT SELECTED ${Object.keys(S.apps).find((k) => S.apps[k].applicationId === s.application_id)} rank=${s.merit_rank} pool=${s.vertical_category} reason=${s.reason}`);
};
show(d1.body);
if (!S.runId) {
  const r = await call('POST', `/schemes/${CODE}/academic-years/${YEAR}/run-selection`, {}, mo, { raw: true });
  saveR('run', r);
  line('real run', r, ` run=${r.body.selection_run_id} list=${r.body.selection_list_id} status=${r.body.selection_status}`);
  S.runId = r.body.selection_run_id;
  S.listId = r.body.selection_list_id;
  S.run = { selected: r.body.selected, not_selected: r.body.not_selected };
  save();
}
const again = await call('POST', `/schemes/${CODE}/academic-years/${YEAR}/run-selection`, {}, mo, { raw: true });
line('a second real run', again, ` ${again.body.message ?? ''}`);
const d3 = await call('POST', `/schemes/${CODE}/academic-years/${YEAR}/run-selection`, { dry_run: true }, mo, { raw: true });
const pick = (x) => JSON.stringify({ s: x.selected.map((s) => [s.application_id, s.merit_rank, s.vertical_category]), n: x.not_selected.map((s) => [s.application_id, s.merit_rank, s.reason]) });
console.log(`   dry run after the real run gives the same outcome as the persisted run: ${pick(d3.body) === pick(S.run)}`);
console.log('   persisted selections: ' + psql(`SELECT string_agg(a.application_no||' '||s.selection_status||' rank='||coalesce(s.merit_rank::text,'-')||' '||s.vertical_category||CASE WHEN s.is_female_reserved THEN ' FEMALE' ELSE '' END, '; ' ORDER BY s.merit_rank) FROM selections s JOIN applications a ON a.id=s.application_id WHERE s.selection_run_id='${S.runId}';`));
console.log('   provisional list: ' + psql(`SELECT l.status||' entries='||(SELECT count(*) FROM selection_list_entries e WHERE e.selection_list_id=l.id)||' '||(SELECT string_agg(e.computed_outcome||':'||coalesce(e.computed_rank::text,'-'), ',' ORDER BY e.computed_rank NULLS LAST) FROM selection_list_entries e WHERE e.selection_list_id=l.id) FROM selection_lists l WHERE l.id='${S.listId}';`));
console.log('   scores recorded (score_type = the declared rule): ' + psql(`SELECT string_agg(score_type||'='||score_value, ', ' ORDER BY score_value DESC) FROM scores WHERE application_id IN (${Object.values(S.apps).map((a) => `'${a.applicationId}'`).join(',')});`));
