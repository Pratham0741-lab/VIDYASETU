import { writeFileSync } from 'node:fs';
import { call, login, save, state } from './lib.mjs';
import { applicant } from './setup.mjs';
import { psql } from './psql.mjs';
let seq = 30;
const rec = (label, r) => { writeFileSync(`responses/${String(++seq).padStart(2, '0')}-${label}.json`, JSON.stringify(r, null, 1)); return r; };
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const line = (s, r, extra = '') => console.log(`${s.padEnd(60)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
state.A2 ??= {};
import { PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
// TOP_CLASS: NO_COMPETITION with numeric benefits (POST_MATRIC schedules no instalments).
state.P ??= {};
if (!state.P.A2U) {
  const email = 'a2u.ramesh.p11@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Ramesh', last_name: 'Munda', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-880013', annual_income: '420000.00', bank_account: 'SBIN0004455:88002002', gender: 'MALE', dob: '2001-07-09' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.P.A2U = { email, applicationId: app.id, application_no: app.application_no, district: 'Ranchi', stage: app.current_stage, gate: app.eligibility_gate?.outcome };
  save();
}
const X = state.P.A2U;
console.log(`A2 fixture applicant X (TOP_CLASS): ${X.application_no} gate=${X.gate} stage=${X.stage}`);
const min = await login('ministry.p11@example.org');
if (!state.A2.disbursementId || state.A2.scheme !== 'TOP_CLASS') {
  for (const [who, at] of [['ino.ranchi', 'INO_VERIFIED'], ['dno.ranchi', 'DNO_VERIFIED'], ['sno.jharkhand', 'SNO_VERIFIED']]) {
    const r = await req(`a2-verify-${who}`, 'POST', `/applications/${X.applicationId}/verify`, { remarks: `verified at ${at}` }, await login(`${who}.p11@example.org`));
    line(`${who} verifies X at ${at}`, r, ` -> ${r.body.application?.current_stage}`);
  }
  let r = await req('a2-selection', 'POST', '/schemes/TOP_CLASS/academic-years/2026-27/run-selection', {}, min);
  line('ministry runs TOP_CLASS 2026-27 selection', r, ` basis=${r.body.basis} selected=${r.body.counts?.selected}`);
  const sel = r.body.selected.find((s) => s.application_id === X.applicationId).selection_id;
  r = await req('a2-confirm', 'POST', `/selections/${sel}/confirm`, { override_reason: 'P11.5 A2 test fixture: committee confirmation inside the objection window.' }, min);
  line('ministry confirms the selection', r, ` status=${r.body.selection?.selection_status}`);
  r = await req('a2-sanction', 'POST', `/selections/${sel}/sanction-order`, undefined, min);
  line('ministry issues the sanction order', r);
  r = await req('a2-schedule', 'POST', `/selections/${sel}/disbursements`, undefined, min);
  const list = r.body.disbursements ?? r.body.instalments ?? r.body;
  line('ministry creates the disbursement schedule', r, ` instalments=${list.length}`);
  state.A2 = { scheme: 'TOP_CLASS', disbursementId: list[0].id, selectionId: sel, amount: list[0].amount }; save();
  console.log(`  instalment 1: ${list[0].id} amount=${list[0].amount} status=${list[0].status}`);
}
const Y = await applicant(['A2Z', 'Lakhan', 'Pahan', '1999-12-01', 'MALE', 'Ranchi', 'sbin0004455 - 88002002', 'JH-ST-2026-880014', null]);
console.log(`A2 applicant Y registered with X's bank account (formatted differently): ${Y.application_no}`);
await new Promise((res) => setTimeout(res, 1500));
console.log('flags on X now:', psql(`SELECT flag_type||'/'||severity||'/'||status FROM fraud_flags WHERE application_id='${X.applicationId}';`) || '(none)');
const D = state.A2.disbursementId;
console.log('disbursement before initiate:', psql(`SELECT status||' pfms_ref='||coalesce(pfms_reference,'null') FROM disbursements WHERE id='${D}';`));
let r = await req('a2-initiate-held', 'POST', `/disbursements/${D}/initiate`, undefined, min);
line('ministry initiates X disbursement (HIGH flag OPEN)', r);
console.log('  body:', JSON.stringify(r.body));
console.log('  denial row:', psql(`SELECT action_attempted||' | '||denial_reason||' | subject '||subject_type||':'||subject_id||' | actor_role '||actor_role FROM authorization_denials WHERE request_id='${r.body.requestId}';`) || '(none)');
console.log('  disbursement after refusal:', psql(`SELECT status||' pfms_ref='||coalesce(pfms_reference,'null') FROM disbursements WHERE id='${D}';`));
const flag = r.body.details.flag_ids[0];
r = await req('a2-disp-fp', 'POST', `/fraud-flags/${flag}/disposition`, { status: 'FALSE_POSITIVE', notes: 'A2 fixture: bank confirms account belongs to X only; Y mistyped it.' }, min);
line('ministry dispositions X flag FALSE_POSITIVE', r, ` status=${r.body.status}`);
r = await req('a2-initiate-released', 'POST', `/disbursements/${D}/initiate`, undefined, min);
line('ministry initiates X disbursement (released)', r, ` status=${r.body.status ?? r.body.disbursement?.status}`);
console.log('  disbursement after initiate:', psql(`SELECT status||' pfms_ref='||coalesce(pfms_reference,'null') FROM disbursements WHERE id='${D}';`));
console.log('  flags on Y (still OPEN, Y is held separately):', psql(`SELECT flag_type||'/'||severity||'/'||status FROM fraud_flags WHERE application_id='${Y.applicationId}';`));
