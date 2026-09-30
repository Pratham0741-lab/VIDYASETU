// Phase 16 Part A: build the hand-built oracle dataset for officer workload and verification
// quality. A scheme authored through the API (WQ_ORACLE_P16, 2026-27), 12 synthetic applicants
// (W01-W10 Ranchi, W11-W12 Dumka), 29 documents with mock-ML fixtures chosen by construction,
// officer confirmations and workflow actions. Idempotent: state in state.json (P16.wq).
import { call, login, save, state, PW, fixturePng } from '../lib.mjs';
import { psql } from '../psql.mjs';

const CODE = 'WQ_ORACLE_P16';
const YEAR = '2026-27';
const INCOME = 'Family Income Certificate';
const CASTE = 'ST certificate issued by competent authority';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = (label, r, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

state.P16 ??= {};
state.P16.wq ??= { apps: {}, docs: {} };
const S = state.P16.wq;
const mo = await login('ministry.p11@example.org');

if (!S.versionId) {
  must('scheme', await call('POST', '/admin/schemes', { code: CODE, name: 'Workload / verification oracle (P16 synthetic)', department: 'Test data', type: 'CENTRAL_SECTOR' }, mo, { raw: true }), [201, 409]);
  const config = {
    rules: [
      { id: 'category_match', type: 'eligibility', expr: 'applicant.category in params.allowed_categories', params: { allowed_categories: ['ST', 'PVTG'] }, doc_refs: [CASTE], message_key: 'eligibility.category_not_allowed', verification: { status: 'PENDING_AUDIT' } },
      { id: 'income_ceiling', type: 'eligibility', expr: 'applicant.family_income_annual <= params.max_income', params: { max_income: 300000 }, doc_refs: [INCOME], message_key: 'eligibility.income_too_high', verification: { status: 'PENDING_AUDIT' } },
    ],
    benefits: [],
    required_documents: [INCOME, CASTE],
    fund_sharing_ratio: null,
  };
  must('draft', await call('POST', `/admin/schemes/${CODE}/versions`, { config }, mo, { raw: true }));
  const pub = must('publish', await call('POST', `/admin/schemes/${CODE}/versions/1/publish`, {}, mo, { raw: true }));
  S.versionId = pub.version.id;
  save();
}
console.log(`scheme ${CODE} v1 ${S.versionId}`);

for (let i = 1; i <= 12; i++) {
  const key = `W${String(i).padStart(2, '0')}`;
  if (S.apps[key]) continue;
  const district = i <= 10 ? 'Ranchi' : 'Dumka';
  const email = `${key.toLowerCase()}.oracle.p11@example.org`;
  must(`register ${key}`, await call('POST', '/auth/register', { email, password: PW, first_name: `Wq${key}`, last_name: 'Oracle', category: 'ST', domicile_state: 'Jharkhand', domicile_district: district, caste_cert_number: `JH-ST-2026-16W${i}0`, annual_income: '150000.00', bank_account: `SBIN0004455:16W0${i}00`, gender: i % 2 ? 'FEMALE' : 'MALE', dob: '2004-01-01' }, undefined, { raw: true }));
  const app = must(`apply ${key}`, await call('POST', '/applications', { scheme_version_id: S.versionId, academic_year: YEAR }, await login(email), { raw: true }));
  S.apps[key] = { email, district, applicationId: app.id, application_no: app.application_no, gate: app.eligibility_gate?.outcome, stage: app.current_stage };
  save();
}
console.log('applications: ' + Object.entries(S.apps).map(([k, a]) => `${k}:${a.stage}`).join(' '));

// Documents by construction (slot, marker scenario, intended outcome).
const PLAN = [];
const W = (n) => `W${String(n).padStart(2, '0')}`;
for (let n = 1; n <= 8; n++) PLAN.push([W(n), INCOME, 'clean;type=INCOME_CERTIFICATE', 'auto']);
for (let n = 1; n <= 10; n++) PLAN.push([W(n), INCOME, 'low_confidence_field;type=INCOME_CERTIFICATE', n <= 4 ? 'confirm-corrected' : n <= 9 ? 'confirm' : 'awaiting']);
for (let n = 1; n <= 3; n++) PLAN.push([W(n), INCOME, 'clean;type=MARKSHEET', 'confirm-type']);
for (let n = 10; n <= 12; n++) PLAN.push([W(n), INCOME, 'quality_fail', 'unreadable']);
for (let n = 1; n <= 3; n++) PLAN.push([W(n), CASTE, 'clean;type=CASTE_CERTIFICATE', 'auto']);
for (let n = 4; n <= 5; n++) PLAN.push([W(n), CASTE, 'low_confidence_field;type=CASTE_CERTIFICATE', 'awaiting']);

for (const [idx, [key, slot, scenario, intent]] of PLAN.entries()) {
  const dk = `${idx}`;
  if (S.docs[dk]) continue;
  const a = S.apps[key];
  const fd = new FormData();
  fd.append('document_type', slot);
  fd.append('file', new Blob([fixturePng(`${scenario};holder_name=WQ%20HOLDER%20${key}%20${idx}`)], { type: 'image/png' }), `oracle-${idx}.png`);
  const r = must(`upload ${dk}`, await call('POST', `/applications/${a.applicationId}/documents`, fd, await login(a.email), { raw: true }), [200, 201, 202, 422]);
  S.docs[dk] = { key, slot, scenario, intent, documentId: r.document_id ?? r.details?.document_id ?? r.id };
  save();
}
// Wait for the pipeline.
for (let i = 0; i < 90; i++) {
  const pending = psql(`SELECT count(*) FROM documents d WHERE d.id IN (${Object.values(S.docs).map((d) => `'${d.documentId}'`).join(',')}) AND d.intake_status='QUEUED' AND NOT EXISTS (SELECT 1 FROM document_extractions e WHERE e.document_id=d.id);`);
  if (pending === '0') break;
  await sleep(2000);
}
console.log('routing: ' + psql(`SELECT string_agg(k||' x'||c, ', ' ORDER BY k) FROM (SELECT d.document_type||'/'||coalesce(d.intake_status,'-')||'/'||coalesce(e.review_status,'-')||'/match='||coalesce(e.classification_matches_slot::text,'-') AS k, count(*) AS c FROM documents d LEFT JOIN document_extractions e ON e.document_id=d.id WHERE d.id IN (${Object.values(S.docs).map((d) => `'${d.documentId}'`).join(',')}) GROUP BY 1) s;`));

const ino = { Ranchi: await login('ino.ranchi.p11@example.org'), Dumka: await login('ino.dumka.p11@example.org') };
for (const d of Object.values(S.docs)) {
  if (d.done || !d.intent.startsWith('confirm')) continue;
  const body = d.intent === 'confirm-corrected'
    ? { corrections: { holder_name: `WQ CORRECTED ${d.key}` }, remarks: 'Holder name corrected against the certificate.' }
    : {};
  must(`confirm ${d.documentId}`, await call('POST', `/documents/${d.documentId}/confirm`, body, ino[S.apps[d.key].district], { raw: true }));
  d.done = true;
  save();
}

const act = async (who, key, verb, body = {}) => {
  const a = S.apps[key];
  if (a.acted?.includes(`${who}:${verb}`)) return;
  must(`${who} ${verb} ${key}`, await call('POST', `/applications/${a.applicationId}/${verb}`, body, await login(who), { raw: true }));
  a.acted = [...(a.acted ?? []), `${who}:${verb}`];
  save();
};
// The gate left these for a manual eligibility review: the INO confirms it (an override).
const reviewed = { eligibility_review_confirmed: true, remarks: 'Eligibility checked against the certificates.' };
for (const k of ['W01', 'W02', 'W03', 'W04', 'W05', 'W06']) await act('ino.ranchi.p11@example.org', k, 'verify', reviewed);
await act('ino.ranchi.p11@example.org', 'W07', 'mark-defective', { code: 'DEF_P16_ORACLE', title: 'Oracle defect', description: 'Synthetic defect for the workload oracle', remarks: 'Bona fide certificate page is unreadable.' });
await act('ino.ranchi.p11@example.org', 'W08', 'reject', { remarks: 'Synthetic rejection for the workload oracle.' });
for (const k of ['W11', 'W12']) await act('ino.dumka.p11@example.org', k, 'verify', reviewed);
for (const k of ['W01', 'W02', 'W03', 'W04', 'W05']) await act('dno.ranchi.p11@example.org', k, 'verify');
for (const k of ['W01', 'W02', 'W03', 'W04']) await act('sno.jharkhand.p11@example.org', k, 'verify');

// One SLA breach: W09 has sat at INO_VERIFIED for 9 days (SLA 7).
if (!S.breach) {
  psql(`UPDATE applications SET stage_entered_at = now() - interval '9 days', stage_due_at = now() - interval '2 days' WHERE id='${S.apps.W09.applicationId}' AND current_stage='INO_VERIFIED';`);
  must('sweep', await call('POST', '/applications/sla-breaches/sweep', undefined, await login('admin.p11@example.org'), { raw: true }));
  S.breach = true;
  save();
}
console.log('stages now: ' + psql(`SELECT string_agg(current_stage||'='||c, ', ' ORDER BY current_stage) FROM (SELECT a.current_stage, count(*) c FROM applications a JOIN schemes s ON s.id=a.scheme_id WHERE s.code='${CODE}' GROUP BY 1) x;`));
