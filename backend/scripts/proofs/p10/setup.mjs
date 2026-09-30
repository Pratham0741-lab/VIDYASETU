import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
if (!state.officers) {
  const admin = await login('admin.p10@example.org');
  for (const [email, role, st, di, inst] of [
    ['ino.ranchi.p10@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421'],
    ['dno.ranchi.p10@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi'],
    ['sno.jharkhand.p10@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand'],
    ['ministry.p10@example.org', 'MINISTRY_OFFICER'],
  ]) await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}) }, admin);
  state.officers = true; save();
}
state.P ??= {};
for (const [key, first, last, income, dob, gender] of [
  ['K', 'Kavya', 'Oraon', '180000.00', '2006-05-02', 'FEMALE'],
  ['R', 'Ravi', 'Munda', '200000.00', '2005-09-14', 'MALE'],
  ['M', 'Rekha', 'Minz', '150000.00', '2003-08-21', 'FEMALE'],
]) {
  if (state.P[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.p10@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${key}1010`, annual_income: income, bank_account: `SBIN0001234:3010${key}10`, gender, dob });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  console.log(`${key} ${first} ${last} (declared income ${income}, dob ${dob}) -> ${app.application_no}: ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
