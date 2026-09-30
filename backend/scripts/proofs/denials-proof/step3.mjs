import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
import { psql } from './psql.mjs';
if (!state.P.T5) {
  const email = 'budhni.t5.dn@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Budhni', last_name: 'Oraon', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-T59', annual_income: '240000.00', bank_account: 'SBIN0009991:40091005', gender: 'FEMALE', dob: '2001-02-11', phone: '9876508459' });
  const app = await call('POST', '/applications', { scheme_version_id: V.NOS, academic_year: '2026-27', declared: { education_level: LVL.NOS, degree_enrolled: 'Master', tenure_years: 2, university_qs_ranking: 90 } }, await login(email));
  state.P.T5 = { email, applicationId: app.id, stage: app.current_stage }; save();
}
const T5 = state.P.T5.applicationId, T3 = state.P.T3.applicationId;
console.log(`T5 ${T5} stage=${psql(`SELECT current_stage FROM applications WHERE id='${T5}';`)} | T3 ${T3} stage=${psql(`SELECT current_stage FROM applications WHERE id='${T3}';`)}`);
const sno = await login('sno.jharkhand.dn@example.org');
const r1 = await call('POST', `/applications/${T5}/verify`, { remarks: 'SNO acting at INO_VERIFIED' }, sno, { raw: true });
console.log(`\n[wrong role] SNO verify T5 (INO_VERIFIED): HTTP ${r1.status} ${JSON.stringify(r1.body)}`);
const r2 = await call('POST', `/applications/${T3}/verify`, { remarks: 'verify again' }, sno, { raw: true });
console.log(`[wrong stage] SNO verify T3 (MINISTRY_APPROVED): HTTP ${r2.status} ${JSON.stringify(r2.body)}`);
const dumka = await login('dno.dumka.dn@example.org');
const r3 = await call('POST', `/applications/${T5}/verify`, { remarks: 'out of jurisdiction' }, dumka, { raw: true });
console.log(`[excluded: RLS] DNO Dumka verify T5 (Ranchi): HTTP ${r3.status} ${JSON.stringify(r3.body)}`);
state.p3 = { requestIds: [r1.body.requestId, r2.body.requestId, r3.body.requestId] }; save();
console.log('\n--- authorization_denials rows for these three requests:');
console.log(psql(`SELECT request_id, actor_role, actor_type, action_attempted, subject_type, left(subject_id,8) AS subject, denial_reason, details->>'reason' AS engine_reason, details->>'state' AS state, details->>'transition' AS transition, jurisdiction_state || '/' || jurisdiction_district AS jurisdiction FROM authorization_denials WHERE request_id IN ('${r1.body.requestId}','${r2.body.requestId}','${r3.body.requestId}') ORDER BY occurred_at;`, []));
console.log(`\nrows for the RLS 404 request (${r3.body.requestId}): ${psql(`SELECT count(*) FROM authorization_denials WHERE request_id='${r3.body.requestId}';`)}`);
