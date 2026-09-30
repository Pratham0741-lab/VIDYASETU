import { call, login, state, save, PW } from './p7.mjs';
const V = JSON.parse(process.env.VERSIONS);
const lvl = process.env.POST_LEVEL;
// Officer (SUPER_ADMIN is bootstrapped by the documented script beforehand).
if (!state.officer) {
  const admin = await login('admin.phase7@example.org');
  await call('POST', '/admin/officers', { email: 'ino.ranchi7@example.org', password: PW, name: 'INO Ranchi', role: 'INSTITUTE_NODAL_OFFICER', jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Ranchi', institution_code: 'U-0421' }, admin);
  state.officer = true; save();
}
for (const [key, first, last, income] of [['A', 'Kavya', 'Oraon', '180000.00'], ['B', 'Ravi', 'Munda', '200000.00']]) {
  if (state[key]) continue;
  const email = `${first.toLowerCase()}.p7@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${key}7731`, annual_income: income, bank_account: `SBIN0001234:3001770${key}`, gender: key === 'A' ? 'FEMALE' : 'MALE', dob: '2006-05-02' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: lvl } }, await login(email));
  state[key] = { email, applicationId: app.id, application_no: app.application_no, stage: app.current_stage, gate: app.eligibility_gate.outcome, needs_review: app.needs_eligibility_review };
  save();
  console.log(`applicant ${key} ${first} ${last} income ${income}: application ${app.id} gate=${app.eligibility_gate.outcome} -> ${app.current_stage}, needs_eligibility_review=${app.needs_eligibility_review}`);
}
