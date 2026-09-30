import { call, login, state, LEVELS as LVL } from './p9lib.mjs';
const min = await login('ministry9@example.org');

console.log('=== control: the same year-4 PhD inputs against each ACTIVE NFST version (public check, nothing stored)');
const profile = { category: 'ST', education_level: LVL.NFST, degree_enrolled: 'PhD', tenure_years: 4 };
for (const v of [4, 5]) {
  const r = await call('POST', `/schemes/NFST/versions/${v}/check-eligibility`, { applicant: profile }, undefined, { raw: true });
  const rule = r.body.rules?.find((x) => x.rule_id === 'fellowship_tenure_limit');
  console.log(`  NFST v${v}: HTTP ${r.status} fellowship_tenure_limit -> ${rule?.verdict}${rule?.explanation ? ` (${rule.explanation})` : ''}`);
}

console.log('\n=== STEP 6: continuation check for N (NFST, year 4) - MINISTRY_OFFICER');
const c = await call('POST', `/renewals/${state.P.N.renewalId}/continuation-check`, undefined, min, { raw: true });
const b = c.body;
console.log(`HTTP ${c.status}`);
console.log(`  application's real scheme_version_id : ${b.application_scheme_version_id}`);
console.log(`  version actually evaluated           : ${JSON.stringify(b.evaluated_scheme_version)}`);
console.log(`  currently ACTIVE NFST versions        : ${JSON.stringify(b.currently_active_versions)}`);
console.log(`  rule evaluated                        : ${b.rule.id}  params.phd_max_years=${b.rule.params.phd_max_years}`);
console.log(`  inputs                                : ${JSON.stringify(b.inputs)}  (degree read from the submission-time gate evaluation)`);
console.log(`  verdict                               : ${b.verdict}   evaluation_run_id=${b.evaluation_run_id}`);

const d = await call('POST', `/renewals/${state.P.N.renewalId}/decide`, { decision: 'APPROVE', remarks: 'Year 4 continuation approved against the frozen NFST v4 tenure rule.' }, min, { raw: true });
console.log(`decide APPROVE: HTTP ${d.status} status=${d.body.verification_status} decided_by=${d.body.decided_by_officer_id} verified_at=${d.body.verified_at}`);

console.log('\n=== NOS renewal for T4 (Master, year 2)');
const n = await call('POST', `/renewals/${state.P.T4.renewalId}/continuation-check`, undefined, min);
console.log(`  evaluated ${JSON.stringify(n.evaluated_scheme_version)} rule ${n.rule.id} masters_max_years=${n.rule.params.masters_max_years} inputs=${JSON.stringify(n.inputs)} -> ${n.verdict}`);
const nd = await call('POST', `/renewals/${state.P.T4.renewalId}/decide`, { decision: 'APPROVE' }, min);
console.log(`  decide APPROVE -> ${nd.verification_status}`);
