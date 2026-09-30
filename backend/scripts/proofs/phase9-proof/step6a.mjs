import { call, login, save, state } from './p9lib.mjs';
const min = await login('ministry9@example.org');
const ino = await login('ino.ranchi9@example.org');

const cn = await call('POST', `/selections/${state.P.N.selectionId}/confirm`, { override_reason: 'NFST RANKED_NO_CAP run, no competition for seats; committee confirmed on 27-09-2026.' }, min);
console.log(`N (NFST) selection: ${cn.selection.selection_status}`);

for (const [key, year, n, report] of [
  ['N', '2029-30', 4, 'Year 4 PhD progress: fieldwork in Santhal Parganas complete, two chapters drafted, one paper under review.'],
  ['T4', '2027-28', 2, 'Year 2 Master\'s progress: first-year modules passed with distinction; dissertation topic approved.'],
]) {
  const t = await login(state.P[key].email);
  const r = await call('POST', `/applications/${state.P[key].applicationId}/renewals`, { academic_year: year, academic_year_number: n, passed_previous_year: true, percentage_obtained: 78.5, progress_report: report }, t, { raw: true });
  console.log(`${key} (${state.P[key].scheme}) submits renewal year ${n}: HTTP ${r.status} status=${r.body.verification_status} frozen scheme_version_id=${r.body.scheme_version_id}`);
  const e = await call('POST', `/renewals/${r.body.id}/endorse`, { remarks: 'Supervisor and head of department confirm the progress report.' }, ino, { raw: true });
  console.log(`   INO endorses: HTTP ${e.status} status=${e.body.verification_status} endorsed_at=${e.body.endorsed_at}`);
  state.P[key].renewalId = r.body.id;
  save();
}
