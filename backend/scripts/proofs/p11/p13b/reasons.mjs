// Phase 13B proof 3: every decision-changing action needs a reason, at the API and in the database.
import { writeFileSync, mkdirSync } from 'node:fs';
import { call, enc, login, save, state, upload, waitProcessed, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { applicant } from '../setup.mjs';
import { psql } from '../psql.mjs';

mkdirSync('responses/p13b', { recursive: true });
const MARK = 'LEAKCHECK-7Q4Z';
const REASON = (what) => `${what}: checked by the officer (${MARK} Shri Balram Toppo, ph 9876501234).`;
const rec = (label, r) => { writeFileSync(`responses/p13b/${label}.json`, JSON.stringify(r, null, 1)); return r; };
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const out = (label, r) => console.log(`  ${label.padEnd(44)} HTTP ${r.status} ${r.body?.code ?? ''}${r.status >= 400 && r.body?.details ? ' ' + JSON.stringify(r.body.details) : ''}`);
const ino = await login('ino.ranchi.p11@example.org');
const min = await login('ministry.p11@example.org');
const inoId = psql(`SELECT id FROM accounts WHERE email='ino.ranchi.p11@example.org';`);
const inoOfficer = psql(`SELECT id FROM officers WHERE user_id='${inoId}';`);
/** Raw write as app_user with the INO actor, always rolled back. */
const raw = (label, sql) => {
  const r = psql(`SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id','${inoId}',true), set_config('app.actor_role','INSTITUTE_NODAL_OFFICER',true); ${sql}; ROLLBACK;`, ['-At', '-v', 'ON_ERROR_STOP=0']);
  console.log(`  raw DB ${label.padEnd(37)} ${(r.split('\n').find((l) => /ERROR/.test(l)) ?? 'NO ERROR (write accepted)').replace(/^.*?ERROR:\s*/, 'ERROR: ')}`);
};
const auditRef = (table, id, field) =>
  psql(`SELECT 'audit seq '||seq||' '||action||' on '||table_name||' record '||left(record_id::text,8)||'..: '||'${field} present='||(row_data ? '${field}')||', length '||coalesce(length(row_data->>'${field}'),0) FROM audit_logs WHERE table_name='${table}' AND record_id='${id}' ORDER BY seq DESC NULLS LAST LIMIT 1;`);

const mk = async (key, first, last, dob, declared) => {
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-13B${key.slice(-1)}01`, annual_income: '180000.00', bank_account: `SBIN0004455:1313${key.slice(-1)}0013`, gender: 'MALE', dob });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no, needsReview: app.needs_eligibility_review ?? null };
  save();
  return state.P[key];
};

// 1. Reject
console.log('== 1. reject (decision_records.remarks)');
const R1 = await mk('R13B1', 'Dhanraj', 'Ekka', '2003-01-01', { education_level: LVL.POST_MATRIC });
out('API reject, no reason', await req('reject-none', 'POST', `/applications/${R1.applicationId}/reject`, {}, ino));
out('API reject, "too short"', await req('reject-short', 'POST', `/applications/${R1.applicationId}/reject`, { remarks: 'too short' }, ino));
raw('INSERT REJECT decision, no remarks', `INSERT INTO decision_records (id, application_id, officer_id, decision, stage) VALUES (gen_random_uuid(), '${R1.applicationId}', '${inoOfficer}', 'REJECT', 'INSTITUTE')`);
let r = await req('reject-ok', 'POST', `/applications/${R1.applicationId}/reject`, { remarks: REASON('Rejected: income above the ceiling') }, ino);
out('API reject, with reason', r);
let dr = psql(`SELECT id||'|'||length(remarks) FROM decision_records WHERE application_id='${R1.applicationId}' AND decision='REJECT';`).split('|');
console.log(`  stored: decision_records ${dr[0].slice(0, 8)}.. remarks length ${dr[1]}; ${auditRef('decision_records', dr[0], 'remarks')}`);

// 2. Mark-defective
console.log('== 2. mark-defective (decision_records.remarks)');
const R2 = await mk('R13B2', 'Gopal', 'Lakra', '2003-02-02', { education_level: LVL.POST_MATRIC });
out('API mark-defective, no reason', await req('defect-none', 'POST', `/applications/${R2.applicationId}/mark-defective`, { code: 'DEF_INCOME_EXPIRED', title: 'Income certificate expired', description: 'Upload a current certificate.' }, ino));
raw('INSERT DEFECT decision, no remarks', `INSERT INTO decision_records (id, application_id, officer_id, decision, stage) VALUES (gen_random_uuid(), '${R2.applicationId}', '${inoOfficer}', 'DEFECT', 'INSTITUTE')`);
r = await req('defect-ok', 'POST', `/applications/${R2.applicationId}/mark-defective`, { code: 'DEF_INCOME_EXPIRED', title: 'Income certificate expired', description: 'Upload a current certificate.', remarks: REASON('Defective: income certificate expired') }, ino);
out('API mark-defective, with reason', r);
dr = psql(`SELECT id||'|'||length(remarks) FROM decision_records WHERE application_id='${R2.applicationId}' AND decision='DEFECT';`).split('|');
console.log(`  stored: decision_records ${dr[0].slice(0, 8)}.. remarks length ${dr[1]}; ${auditRef('decision_records', dr[0], 'remarks')}`);

// 3. Eligibility-review override
console.log('== 3. eligibility-review override (verify + eligibility_review_confirmed)');
const R3 = await mk('R13B3', 'Mohan', 'Tirkey', '2003-03-03', {});
console.log(`  application needs_eligibility_review: ${psql(`SELECT needs_eligibility_review FROM applications WHERE id='${R3.applicationId}';`)}`);
out('API verify+override, no reason', await req('override-none', 'POST', `/applications/${R3.applicationId}/verify`, { eligibility_review_confirmed: true }, ino));
raw('INSERT APPROVE override, no remarks', `INSERT INTO decision_records (id, application_id, officer_id, decision, stage, reasons) VALUES (gen_random_uuid(), '${R3.applicationId}', '${inoOfficer}', 'APPROVE', 'INSTITUTE', '{"eligibility_review_confirmed": true}')`);
raw('INSERT plain APPROVE, no remarks (allowed)', `INSERT INTO decision_records (id, application_id, officer_id, decision, stage) VALUES (gen_random_uuid(), '${R3.applicationId}', '${inoOfficer}', 'APPROVE', 'INSTITUTE')`);
r = await req('override-ok', 'POST', `/applications/${R3.applicationId}/verify`, { eligibility_review_confirmed: true, remarks: REASON('Eligibility checked manually against the mark sheet') }, ino);
out('API verify+override, with reason', r);
dr = psql(`SELECT id||'|'||length(remarks) FROM decision_records WHERE application_id='${R3.applicationId}' AND (reasons->>'eligibility_review_confirmed')='true';`).split('|');
console.log(`  stored: decision_records ${(dr[0] ?? '').slice(0, 8)}.. remarks length ${dr[1]}; ${dr[0] ? auditRef('decision_records', dr[0], 'remarks') : ''}`);

// 4. OCR value correction
console.log('== 4. OCR value correction (document_extractions.confirmation_reason)');
const R4 = await mk('R13B4', 'Suresh', 'Minz', '2003-04-04', { education_level: LVL.POST_MATRIC });
if (!state.R13B4doc) {
  const slot = 'Family Income Certificate';
  const t = await login(R4.email);
  const u = await upload(t, R4.applicationId, slot, `low_confidence_field;type=${enc(slot)};low=certificate_number;holder_name=Suresh%20Minz;certificate_number=JH-INC-2026-R4001;n=r4`);
  await waitProcessed(t, u.body.document_id);
  state.R13B4doc = u.body.document_id; save();
}
const doc = state.R13B4doc;
out('API confirm with corrections, no reason', await req('ocr-none', 'POST', `/documents/${doc}/confirm`, { corrections: { certificate_number: 'JH-INC-2026-R4002' } }, ino));
raw('UPDATE extraction corrected, no reason', `UPDATE document_extractions SET review_status='OFFICER_CONFIRMED', corrected_fields='["certificate_number"]', confirmed_by_officer_id='${inoOfficer}', confirmed_at=now() WHERE document_id='${doc}'`);
r = await req('ocr-ok', 'POST', `/documents/${doc}/confirm`, { corrections: { certificate_number: 'JH-INC-2026-R4002' }, remarks: REASON('Certificate number read from the original') }, ino);
out('API confirm with corrections, with reason', r);
const ex = psql(`SELECT id||'|'||length(confirmation_reason) FROM document_extractions WHERE document_id='${doc}';`).split('|');
console.log(`  stored: document_extractions ${ex[0].slice(0, 8)}.. confirmation_reason length ${ex[1]}; ${auditRef('document_extractions', ex[0], 'confirmation_reason')}`);

// 5. Fraud disposition
console.log('== 5. fraud disposition (fraud_flags.review_notes)');
const flag = psql(`SELECT id FROM fraud_flags WHERE application_id='${state.P.F2.applicationId}' AND status='OPEN' LIMIT 1;`);
out('API disposition, no notes', await req('fraud-none', 'POST', `/fraud-flags/${flag}/disposition`, { status: 'FALSE_POSITIVE' }, ino));
out('API disposition, 5-char notes (was valid)', await req('fraud-short', 'POST', `/fraud-flags/${flag}/disposition`, { status: 'FALSE_POSITIVE', notes: 'ok ok' }, ino));
raw('UPDATE flag dispositioned, no notes', `UPDATE fraud_flags SET status='FALSE_POSITIVE', reviewed_by_officer_id='${inoOfficer}', reviewed_at=now() WHERE id='${flag}'`);
r = await req('fraud-ok', 'POST', `/fraud-flags/${flag}/disposition`, { status: 'NEEDS_MORE_INFO', notes: REASON('Asked for the original certificates') }, ino);
out('API disposition, with reason', r);
console.log(`  stored: fraud_flags ${flag.slice(0, 8)}.. review_notes length ${psql(`SELECT length(review_notes) FROM fraud_flags WHERE id='${flag}';`)}; ${auditRef('fraud_flags', flag, 'review_notes')}`);

// 6. Grievance resolution
console.log('== 6. grievance resolution (grievances.resolution_note)');
if (!state.R13B5g) {
  const g = await call('POST', '/grievances', { application_id: R4.applicationId, subject_type: 'APPLICATION', description: 'My income certificate number was read wrongly.' }, await login(R4.email), { raw: true });
  state.R13B5g = g.body.id; save();
}
const g = state.R13B5g;
out('API resolve, no note', await req('griev-none', 'POST', `/grievances/${g}/resolve`, { outcome: 'RESOLVED' }, ino));
raw('UPDATE grievance RESOLVED, no note', `UPDATE grievances SET status='RESOLVED', resolved_by_officer_id='${inoOfficer}', resolved_at=now(), resolution_note='' WHERE id='${g}'`);
r = await req('griev-ok', 'POST', `/grievances/${g}/resolve`, { outcome: 'RESOLVED', note: REASON('Corrected the certificate number') }, ino);
out('API resolve, with note', r);
console.log(`  stored: grievances ${g.slice(0, 8)}.. resolution_note length ${psql(`SELECT length(resolution_note) FROM grievances WHERE id='${g}';`)}; ${auditRef('grievances', g, 'resolution_note')}`);

// 7. Renewal discontinuation
console.log('== 7. renewal discontinuation (renewals.decision_remarks)');
const N1 = state.P.P12N1;
if (!state.R13B7renewal) {
  const s = await call('POST', `/applications/${N1.applicationId}/renewals`, { academic_year: '2028-29', academic_year_number: 2, passed_previous_year: true, progress_report: 'Year 1 coursework completed; synopsis approved.' }, await login(N1.email), { raw: true });
  console.log(`  renewal submitted: HTTP ${s.status} ${s.body.code ?? ''} ${s.status >= 400 ? JSON.stringify(s.body.details) : ''}`);
  if (s.status < 300) { state.R13B7renewal = s.body.id; save(); }
}
const rn = state.R13B7renewal;
if (rn) {
  const e = await call('POST', `/renewals/${rn}/endorse`, { remarks: 'Supervisor confirms progress.' }, ino, { raw: true });
  console.log(`  INO endorse: HTTP ${e.status} ${e.body.code ?? ''} ${e.status >= 400 ? JSON.stringify(e.body.details) : ''}`);
  out('API DISCONTINUE, no remarks', await req('renew-none', 'POST', `/renewals/${rn}/decide`, { decision: 'DISCONTINUE' }, min));
  raw('UPDATE renewal DISCONTINUED, no remarks', `UPDATE renewals SET verification_status='DISCONTINUED', decided_by_officer_id='${inoOfficer}', verified_at=now() WHERE id='${rn}'`);
  r = await req('renew-ok', 'POST', `/renewals/${rn}/decide`, { decision: 'DISCONTINUE', remarks: REASON('Discontinued: no progress report for the second term') }, min);
  out('API DISCONTINUE, with remarks', r);
  console.log(`  stored: renewals ${rn.slice(0, 8)}.. decision_remarks length ${psql(`SELECT length(decision_remarks) FROM renewals WHERE id='${rn}';`)}; ${auditRef('renewals', rn, 'decision_remarks')}`);
}
