import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './p8lib.mjs';
// Live selection.run_completed: 4 PVTG NOS applicants -> MINISTRY_APPROVED -> real selection run.
const pool = [
  ['T1', 'Birsa', 'Asur', 'MALE', 55],
  ['T2', 'Mangal', 'Birhor', 'MALE', 150],
  ['T3', 'Somra', 'Korwa', 'MALE', 310],
  ['T4', 'Salomi', 'Birhor', 'FEMALE', 450],
];
state.T ??= {};
for (const [key, first, last, gender, qs] of pool) {
  if (state.T[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.p8@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'PVTG', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-PVTG-2026-${key}`, annual_income: '350000.00', bank_account: `SBIN0001234:30088${key}`, phone: `98765400${key.slice(1)}${key.slice(1)}`, gender, dob: '2000-04-17' });
  const app = await call('POST', '/applications', { scheme_version_id: V.NOS, academic_year: '2026-27', declared: { education_level: LVL.NOS, degree_enrolled: 'Master', tenure_years: 2, university_qs_ranking: qs } }, await login(email));
  state.T[key] = { email, applicationId: app.id, application_no: app.application_no, stage: app.current_stage };
  save();
  console.log(`${key} ${first} ${last} (${gender}, QS ${qs}) -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
const steps = [['ino.ranchi8@example.org', 'INO_VERIFIED'], ['dno.ranchi8@example.org', 'DNO_VERIFIED'], ['sno.jharkhand8@example.org', 'SNO_VERIFIED']];
for (const [key] of pool) {
  for (const [officer, at] of steps) {
    if (state.T[key].stage !== at) continue;
    const r = await call('POST', `/applications/${state.T[key].applicationId}/verify`, { remarks: `verified at ${at}` }, await login(officer));
    state.T[key].stage = r.application.current_stage; save();
  }
}
console.log('stages:', Object.entries(state.T).map(([k, a]) => `${k}=${a.stage}`).join(' '));
const min = await login('ministry8@example.org');
const run = await call('POST', '/schemes/NOS/academic-years/2026-27/run-selection', {}, min, { raw: true });
const key = (id) => Object.entries(state.T).find(([, a]) => a.applicationId === id)?.[0];
console.log(`\nrun-selection: HTTP ${run.status} basis=${run.body.basis} run=${run.body.selection_run_id}`);
for (const s of run.body.selected) console.log(`  selected     ${key(s.application_id)} rank ${s.merit_rank} ${s.vertical_category} under=${s.horizontal_reservation}`);
for (const n of run.body.not_selected) console.log(`  not selected ${key(n.application_id)} rank ${n.merit_rank} ${n.reason}`);
state.selectionRun = run.body.selection_run_id; save();
