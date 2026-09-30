import { call, enc, login, save, state, upload, waitProcessed, PW, VERSIONS as V, LEVELS as LVL } from './p8lib.mjs';
// Stage-routed document notification (MOCK ML fixture low_confidence_field).
if (!state.S) {
  await call('POST', '/auth/register', { email: 'suman.p8@example.org', password: PW, first_name: 'Suman', last_name: 'Lakra', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-S8801', annual_income: '160000.00', bank_account: 'SBIN0001234:3008801S', dob: '2006-02-02' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login('suman.p8@example.org'));
  state.S = { email: 'suman.p8@example.org', applicationId: app.id, application_no: app.application_no }; save();
  console.log(`S Suman Lakra -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
const ino = await login('ino.ranchi8@example.org');
const v = await call('POST', `/applications/${state.S.applicationId}/verify`, { remarks: 'Checked at institute.' }, ino);
console.log(`INO /verify: ${v.transition.from_stage} -> ${v.transition.to_stage}`);
const t = await login(state.S.email);
const slot = 'Family Income Certificate';
const r = await upload(t, state.S.applicationId, slot, `low_confidence_field;low=certificate_number;type=${enc(slot)};holder_name=Suman%20Lakra;family_income_annual=160000`);
const d = await waitProcessed(t, r.body.document_id);
console.log(`upload (application at DNO_VERIFIED): HTTP ${r.status} -> ${d.state}`);
