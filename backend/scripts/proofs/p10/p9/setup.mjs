import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './p9lib.mjs';
// Phase 9 proof setup - real HTTP only.
if (!state.officers) {
  const admin = await login('admin.phase9@example.org');
  for (const [email, role, st, di, inst] of [
    ['ino.ranchi9@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421'],
    ['dno.ranchi9@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi'],
    ['sno.jharkhand9@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand'],
    ['ministry9@example.org', 'MINISTRY_OFFICER'],
  ]) {
    await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin);
  }
  state.officers = true; save();
}
const NOS = (qs) => ({ education_level: LVL.NOS, degree_enrolled: 'Master', tenure_years: 2, university_qs_ranking: qs });
const people = [
  // key, first, last, category, gender, income, bank, scheme, declared
  ['T1', 'Birsa', 'Asur', 'PVTG', 'MALE', '350000.00', 'SBIN0009991:40091001', 'NOS', NOS(55)],
  ['T2', 'Mangal', 'Birhor', 'PVTG', 'MALE', '350000.00', 'SBIN0009991:40091002', 'NOS', NOS(150)],
  ['T3', 'Somra', 'Korwa', 'PVTG', 'MALE', '350000.00', 'SBIN0009991:40091003', 'NOS', NOS(310)],
  ['T4', 'Salomi', 'Birhor', 'PVTG', 'FEMALE', '350000.00', 'SBIN0009991:40091004', 'NOS', NOS(450)],
  ['K', 'Kiran', 'Tirkey', 'ST', 'FEMALE', '420000.00', 'UBIN0531234:77019912', 'TOP_CLASS', { education_level: LVL.TOP_CLASS }],
  ['N', 'Nilima', 'Hansdah', 'ST', 'FEMALE', '900000.00', 'CNRB0004455:66012345', 'NFST', { education_level: LVL.NFST, degree_enrolled: 'PhD', tenure_years: 2, net_csir_net_score: 82, masters_or_4yr_bachelor_research_score: 71 }],
];
state.P ??= {};
for (const [key, first, last, category, gender, income, bank, scheme, declared] of people) {
  if (state.P[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.p9@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category, domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-${category}-2026-${key}9`, annual_income: income, bank_account: bank, gender, dob: '2000-04-17', phone: `98765${String(key.charCodeAt(0)).padStart(3, '0')}${key.length}9` });
  const app = await call('POST', '/applications', { scheme_version_id: V[scheme], academic_year: '2026-27', declared }, await login(email));
  state.P[key] = { email, scheme, bank, applicationId: app.id, application_no: app.application_no, stage: app.current_stage };
  save();
  console.log(`${key.padEnd(2)} ${first} ${last} (${category}, ${gender}) ${scheme.padEnd(9)} -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
const steps = [['ino.ranchi9@example.org', 'INO_VERIFIED'], ['dno.ranchi9@example.org', 'DNO_VERIFIED'], ['sno.jharkhand9@example.org', 'SNO_VERIFIED']];
for (const p of Object.values(state.P)) {
  for (const [officer, at] of steps) {
    if (p.stage !== at) continue;
    p.stage = (await call('POST', `/applications/${p.applicationId}/verify`, { remarks: `verified at ${at}` }, await login(officer))).application.current_stage;
    save();
  }
}
console.log('stages:', Object.entries(state.P).map(([k, p]) => `${k}=${p.stage}`).join(' '));
const min = await login('ministry9@example.org');
state.runs ??= {};
for (const scheme of ['NOS', 'TOP_CLASS', 'NFST']) {
  if (state.runs[scheme]) continue;
  const r = await call('POST', `/schemes/${scheme}/academic-years/2026-27/run-selection`, {}, min);
  state.runs[scheme] = r.selection_run_id;
  for (const s of r.selected) {
    const key = Object.entries(state.P).find(([, p]) => p.applicationId === s.application_id)[0];
    state.P[key].selectionId = s.selection_id;
    console.log(`${scheme.padEnd(9)} run ${r.selection_run_id.slice(0, 8)}: SELECTED ${key} rank ${s.merit_rank} ${s.vertical_category} under=${s.horizontal_reservation}`);
  }
  for (const n of r.not_selected) {
    const key = Object.entries(state.P).find(([, p]) => p.applicationId === n.application_id)[0];
    console.log(`${scheme.padEnd(9)} run ${r.selection_run_id.slice(0, 8)}: not selected ${key} rank ${n.merit_rank} ${n.reason}`);
  }
  save();
}
