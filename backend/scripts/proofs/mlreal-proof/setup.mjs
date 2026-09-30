import { call, login, state, save, PW } from './lib.mjs';
const V = JSON.parse(process.env.VERSIONS);
const lvl = process.env.POST_LEVEL;
if (!state.officer) {
  const admin = await login('admin.mlreal@example.org');
  await call('POST', '/admin/officers', { email: 'ino.ranchi.mlreal@example.org', password: PW, name: 'INO Ranchi', role: 'INSTITUTE_NODAL_OFFICER', jurisdiction_state: 'Jharkhand', jurisdiction_district: 'Ranchi', institution_code: 'U-0421' }, admin);
  state.officer = true; save();
}
for (const [key, first, last, local] of [['M', 'Kavya', 'Oraon', 'kavya'], ['R', 'Anita', 'Lakra', 'anita'], ['S', 'Anita', 'Lakra', 'anita.s'], ['T', 'Anita', 'Lakra', 'anita.t']]) {
  if (state[key]) continue;
  const email = `${local}.mlreal@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${key}7731`, annual_income: '180000.00', bank_account: `SBIN0001234:3001770${key}`, gender: 'FEMALE', dob: '2006-05-02' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: lvl } }, await login(email));
  state[key] = { email, applicationId: app.id };
  save();
  console.log(`applicant ${key} ${first} ${last}: application ${app.id} gate=${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
