import { call, login, save, state, PW } from './p7.mjs';
const V = JSON.parse(process.env.VERSIONS);
if (!state.C) {
  await call('POST', '/auth/register', { email: 'meena.p7@example.org', password: PW, first_name: 'Meena', last_name: 'Hansda', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-C7731', annual_income: '150000.00', bank_account: 'SBIN0001234:30017703', gender: 'FEMALE', dob: '2006-08-11' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: process.env.POST_LEVEL } }, await login('meena.p7@example.org'));
  state.C = { email: 'meena.p7@example.org', applicationId: app.id };
  save();
  console.log(`new application C ${app.id}: gate=${app.eligibility_gate.outcome} -> ${app.current_stage}, needs_eligibility_review=${app.needs_eligibility_review}`);
}
