import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
import { applicant } from './setup.mjs';
import { psql } from './psql.mjs';
if (!state.P.B2H) {
  const email = 'b2h.birsi.p11@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Birsi', last_name: 'Lohra', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-880041', annual_income: '420000.00', bank_account: 'SBIN0004455:88005005', gender: 'FEMALE', dob: '2002-03-04' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2028-29', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.P.B2H = { email, applicationId: app.id, application_no: app.application_no, district: 'Ranchi' }; save();
  for (const w of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand']) await call('POST', `/applications/${app.id}/verify`, { remarks: 'ok' }, await login(`${w}.p11@example.org`));
}
const H = state.P.B2H;
await applicant(['B2S', 'Etwa', 'Oraon', '1995-10-10', 'MALE', 'Ranchi', 'SBIN0004455 : 88005005', 'JH-ST-2026-880042', null]);
await new Promise((r) => setTimeout(r, 2000));
console.log(`H ${H.application_no}: stage=${psql(`SELECT current_stage FROM applications WHERE id='${H.applicationId}';`)} flags=${psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status, ', ') FROM fraud_flags WHERE application_id='${H.applicationId}';`)}`);
const r = await call('POST', '/schemes/TOP_CLASS/academic-years/2028-29/run-selection', { dry_run: true }, await login('ministry.p11@example.org'), { raw: true });
console.log(`DRY RUN TOP_CLASS 2028-29: HTTP ${r.status} basis=${r.body.basis} counts=${JSON.stringify(r.body.counts)} selected=${JSON.stringify(r.body.selected.map((s) => s.application_no))}`);
console.log(`=> held application selected: ${r.body.selected.some((s) => s.application_id === H.applicationId)}`);
