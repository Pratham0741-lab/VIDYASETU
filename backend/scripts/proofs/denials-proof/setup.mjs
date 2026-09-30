import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
// authorization_denials proof setup (from the Phase 9 NOS scenario) - real HTTP only.
if (!state.officers) {
  const admin = await login('admin.denials@example.org');
  for (const [email, role, st, di, inst] of [
    ['ino.ranchi.dn@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421'],
    ['dno.ranchi.dn@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi'],
    ['sno.jharkhand.dn@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand'],
    ['ministry.dn@example.org', 'MINISTRY_OFFICER'],
    ['dno.dumka.dn@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Dumka'],
  ]) {
    await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin);
  }
  state.officers = true; save();
  console.log('officers: INO Ranchi, DNO Ranchi, SNO Jharkhand, MINISTRY (national), DNO Dumka (other district)');
}
const NOS = (qs) => ({ education_level: LVL.NOS, degree_enrolled: 'Master', tenure_years: 2, university_qs_ranking: qs });
const people = [
  ['T1', 'Birsa', 'Asur', 'MALE', 'SBIN0009991:40091001', NOS(55)],
  ['T2', 'Mangal', 'Birhor', 'MALE', 'SBIN0009991:40091002', NOS(150)],
  ['T3', 'Somra', 'Korwa', 'MALE', 'SBIN0009991:40091003', NOS(310)],
  ['T4', 'Salomi', 'Birhor', 'FEMALE', 'SBIN0009991:40091004', NOS(450)],
];
state.P ??= {};
for (const [key, first, last, gender, bank, declared] of people) {
  if (state.P[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.dn@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'PVTG', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-PVTG-2026-${key}9`, annual_income: '350000.00', bank_account: bank, gender, dob: '2000-04-17', phone: `98765${String(key.charCodeAt(0)).padStart(3, '0')}${key.length}9` });
  const app = await call('POST', '/applications', { scheme_version_id: V.NOS, academic_year: '2026-27', declared }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no, stage: app.current_stage };
  save();
  console.log(`${key} ${first} ${last} -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
const steps = [['ino.ranchi.dn@example.org', 'INO_VERIFIED'], ['dno.ranchi.dn@example.org', 'DNO_VERIFIED'], ['sno.jharkhand.dn@example.org', 'SNO_VERIFIED']];
for (const p of Object.values(state.P)) {
  for (const [officer, at] of steps) {
    if (p.stage !== at) continue;
    p.stage = (await call('POST', `/applications/${p.applicationId}/verify`, { remarks: `verified at ${at}` }, await login(officer))).application.current_stage;
    save();
  }
}
console.log('stages:', Object.entries(state.P).map(([k, p]) => `${k}=${p.stage}`).join(' '));
if (!state.run) {
  const r = await call('POST', '/schemes/NOS/academic-years/2026-27/run-selection', {}, await login('ministry.dn@example.org'));
  state.run = r.selection_run_id;
  for (const s of r.selected) { const k = Object.entries(state.P).find(([, p]) => p.applicationId === s.application_id)[0]; state.P[k].selectionId = s.selection_id; console.log(`run ${r.selection_run_id.slice(0, 8)}: SELECTED ${k} rank ${s.merit_rank}`); }
  for (const n of r.not_selected) { const k = Object.entries(state.P).find(([, p]) => p.applicationId === n.application_id)[0]; console.log(`run ${r.selection_run_id.slice(0, 8)}: not selected ${k} rank ${n.merit_rank} ${n.reason}`); }
  save();
}
