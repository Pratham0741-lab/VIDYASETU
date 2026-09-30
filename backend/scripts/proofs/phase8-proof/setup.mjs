import { call, login, save, state, PW } from './p8lib.mjs';
const V = JSON.parse(process.env.VERSIONS);
const LVL = JSON.parse(process.env.LEVELS);
if (!state.officers) {
  const admin = await login('admin.phase8@example.org');
  for (const [email, role, st, di, inst, phone] of [
    ['ino.ranchi8@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Ranchi', 'U-0421', '9000000001'],
    ['dno.ranchi8@example.org', 'DISTRICT_NODAL_OFFICER', 'Jharkhand', 'Ranchi', null, '9000000002'],
    ['sno.jharkhand8@example.org', 'STATE_NODAL_OFFICER', 'Jharkhand', null, null, null],
    ['ministry8@example.org', 'MINISTRY_OFFICER', null, null, null, null],
    ['ino.dumka8@example.org', 'INSTITUTE_NODAL_OFFICER', 'Jharkhand', 'Dumka', 'U-0877', null],
  ]) {
    await call('POST', '/admin/officers', { email, password: PW, name: email.split('@')[0], role, ...(st ? { jurisdiction_state: st } : {}), ...(di ? { jurisdiction_district: di } : {}), ...(inst ? { institution_code: inst } : {}), ...(phone ? { phone } : {}) }, admin);
  }
  state.officers = true; save();
  console.log('officers: INO Ranchi, DNO Ranchi, SNO Jharkhand, MINISTRY (national), INO Dumka (other district)');
}
for (const [key, first, last, income, phone, scheme, declared] of [
  ['P', 'Priya', 'Kerketta', '180000.00', '9876543210', 'POST_MATRIC', { education_level: LVL.POST_MATRIC }],
  ['Q', 'Sunil', 'Soren', '300000.00', '9876543211', 'POST_MATRIC', { education_level: LVL.POST_MATRIC }],
]) {
  if (state[key]) continue;
  const email = `${first.toLowerCase()}.p8@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${key}8801`, annual_income: income, bank_account: `SBIN0001234:3008801${key}`, phone, gender: 'FEMALE', dob: '2006-03-03' });
  const app = await call('POST', '/applications', { scheme_version_id: V[scheme], academic_year: '2026-27', declared }, await login(email));
  state[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  console.log(`${key} ${first} ${last} (income ${income}) -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
