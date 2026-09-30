import { call, enc, login, save, state, upload, waitProcessed, PW } from './p7.mjs';
const V = JSON.parse(process.env.VERSIONS);
const mark = (s) => console.log(`\n>>> ${s}`);
// 1. applicant D: one ELIGIBLE (POST_MATRIC) and one INELIGIBLE (income over ceiling on POST_MATRIC is impossible for D, so use NOS with no dob -> INELIGIBLE on income)
if (!state.D) {
  await call('POST', '/auth/register', { email: 'arjun.p8@example.org', password: PW, first_name: 'Arjun', last_name: 'Tudu', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-D8801', annual_income: '240000.00', bank_account: 'SBIN0001234:30018801', gender: 'MALE', dob: '2005-01-09' });
  state.D = { email: 'arjun.p8@example.org' }; save();
}
const t = await login(state.D.email);
mark('POST /applications (POST_MATRIC v2, eligible) -> gate event');
const ok = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: process.env.POST_LEVEL } }, t);
console.log(`application ${ok.application_no}: ${ok.eligibility_gate.outcome} -> ${ok.current_stage}`);
mark('POST /applications (NOS v2, income 240000 but PhD age etc. not declared) -> gate event');
const nos = await call('POST', '/applications', { scheme_version_id: V.NOS, academic_year: '2026-27' }, t);
console.log(`application ${nos.application_no}: ${nos.eligibility_gate.outcome} -> ${nos.current_stage}`);
mark('upload MOCK quality_fail fixture -> documents.quality_rejected');
const q = await upload(t, ok.id, 'Family Income Certificate', 'quality_fail');
console.log(`HTTP ${q.status} ${q.body.status}`);
mark('upload MOCK low_confidence_field fixture -> documents.needs_review (worker, after its commit)');
const lc = await upload(t, ok.id, 'Family Income Certificate', `low_confidence_field;low=certificate_number;type=${enc('Family Income Certificate')};holder_name=Arjun%20Tudu;family_income_annual=240000`);
console.log(`HTTP ${lc.status} -> ${(await waitProcessed(t, lc.body.document_id)).state}`);
const ino = await login('ino.ranchi7@example.org');
mark('FAILING request: INO /verify on an application that needs manual review -> 409, must emit nothing');
const bad = await call('POST', `/applications/${nos.id}/verify`, {}, ino, { raw: true });
console.log(`HTTP ${bad.status} ${bad.body.details?.reason ?? bad.body.code}`);
mark('INO /mark-defective on the eligible application -> workflow.transition with deficiency');
const md = await call('POST', `/applications/${ok.id}/mark-defective`, { code: 'DEF_INCOME_UNSIGNED', title: 'Income certificate unsigned', description: 'Upload a signed income certificate.' }, ino, { raw: true });
console.log(`HTTP ${md.status} ${md.body.transition?.from_stage} -> ${md.body.transition?.to_stage} deficiency=${md.body.deficiency_id}`);
state.D.ok = ok.id; state.D.nos = nos.id; save();
