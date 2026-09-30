import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './p9lib.mjs';
// Non-renewable schemes: every renewal route must refuse cleanly.
for (const [key, first, scheme, declared] of [
  ['PM', 'Pooja', 'POST_MATRIC', { education_level: LVL.POST_MATRIC }],
  ['PR', 'Ravi', 'PRE_MATRIC', {}],
]) {
  if (state.P[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.p9@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: 'Oraon', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${key}9`, annual_income: '120000.00', bank_account: `SBIN0002222:5000${key}`, dob: '2008-01-01' });
  const app = await call('POST', '/applications', { scheme_version_id: V[scheme], academic_year: '2026-27', declared }, await login(email));
  state.P[key] = { email, scheme, applicationId: app.id, application_no: app.application_no };
  save();
}
const body = { academic_year: '2027-28', academic_year_number: 2, passed_previous_year: true, progress_report: 'Passed the previous year.' };
for (const key of ['K', 'PM', 'PR']) {
  const p = state.P[key];
  const t = await login(p.email);
  const post = await call('POST', `/applications/${p.applicationId}/renewals`, body, t, { raw: true });
  const get = await call('GET', `/applications/${p.applicationId}/renewals`, undefined, t, { raw: true });
  console.log(`${p.scheme.padEnd(11)} POST renewals: HTTP ${post.status} ${post.body.code} reason=${post.body.details?.reason}\n            message: ${post.body.message}\n            GET  renewals: HTTP ${get.status} ${get.body.code}`);
}
