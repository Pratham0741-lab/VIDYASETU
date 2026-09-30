import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './p9lib.mjs';
// Proof 5 setup: four TOP_CLASS applications in 2027-28, each driven to a PENDING disbursement.
state.F ??= {};
const people = [['F1', 'Anil', 'Kujur'], ['F2', 'Bina', 'Ekka'], ['F3', 'Chandan', 'Minj'], ['F4', 'Dulari', 'Toppo']];
for (const [key, first, last] of people) {
  if (state.F[key]) continue;
  const email = `${first.toLowerCase()}.${key.toLowerCase()}.p10@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2027-${key}0`, annual_income: '420000.00', bank_account: `UBIN0531234:7701${key}`, gender: 'FEMALE', dob: '2004-06-10' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2027-28', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.F[key] = { email, applicationId: app.id, application_no: app.application_no, stage: app.current_stage };
  save();
}
for (const f of Object.values(state.F)) for (const [officer, at] of [['ino.ranchi9@example.org', 'INO_VERIFIED'], ['dno.ranchi9@example.org', 'DNO_VERIFIED'], ['sno.jharkhand9@example.org', 'SNO_VERIFIED']]) {
  if (f.stage !== at) continue;
  f.stage = (await call('POST', `/applications/${f.applicationId}/verify`, { remarks: `verified at ${at}` }, await login(officer))).application.current_stage; save();
}
const min = await login('ministry9@example.org');
if (!state.Frun) {
  const r = await call('POST', '/schemes/TOP_CLASS/academic-years/2027-28/run-selection', {}, min);
  state.Frun = r.selection_run_id;
  for (const s of r.selected) { const f = Object.values(state.F).find((x) => x.applicationId === s.application_id); f.selectionId = s.selection_id; }
  save();
  console.log(`TOP_CLASS 2027-28 run ${r.selection_run_id.slice(0, 8)}: selected ${r.selected.length}, not selected ${r.not_selected.length}`);
}
for (const [key, f] of Object.entries(state.F)) {
  if (f.disbursementId) continue;
  await call('POST', `/selections/${f.selectionId}/confirm`, { override_reason: 'Phase 10 PFMS failure-mode proof: committee approved immediate confirmation.' }, min);
  await call('POST', `/selections/${f.selectionId}/sanction-order`, undefined, min);
  const sch = await call('POST', `/selections/${f.selectionId}/disbursements`, undefined, min);
  f.disbursementId = sch.instalments[0].id; save();
  console.log(`${key} ${f.application_no} stage=${f.stage} -> instalment 1: ${sch.instalments[0].currency} ${sch.instalments[0].amount} status=${sch.instalments[0].status}`);
}
console.log('PFMS_MOCK_SCENARIOS=' + JSON.stringify({ [state.F.F1.application_no]: 'INSUFFICIENT_BALANCE', [state.F.F2.application_no]: 'TIMEOUT', [state.F.F3.application_no]: 'ACCOUNT_INVALID', [state.F.F4.application_no]: 'PENDING' }));
