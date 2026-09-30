import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from './lib.mjs';
import { applicant } from './setup.mjs';
import { psql } from './psql.mjs';
let seq = 70;
const rec = (label, r) => { writeFileSync(`responses/${String(++seq).padStart(2, '0')}-${label}.json`, JSON.stringify(r, null, 1)); return r; };
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const line = (s, r, extra = '') => console.log(`${s.padEnd(62)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const dsql = (id) => psql(`SELECT status||' transaction_reference='||coalesce(transaction_reference,'null') FROM disbursements WHERE id='${id}';`);
if (!state.P.A2T8) {
  const email = 'a2t8.salomi.p11@example.org';
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Sumitra', last_name: 'Bhagat', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-880031', annual_income: '420000.00', bank_account: 'SBIN0004455:88004004', gender: 'FEMALE', dob: '1996-08-23' });
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2027-28', declared: { education_level: LVL.TOP_CLASS } }, await login(email));
  state.P.A2T8 = { email, applicationId: app.id, application_no: app.application_no, district: 'Ranchi' }; save();
  console.log(`A2 fixture X (TOP_CLASS 2027-28): ${app.application_no} gate=${app.eligibility_gate?.outcome} stage=${app.current_stage}`);
}
const X = state.P.A2T8, min = await login('ministry.p11@example.org');
state.A2T8 ??= {};
if (!state.A2T8.disbursementId) {
  for (const [who, at] of [['ino.ranchi', 'INO_VERIFIED'], ['dno.ranchi', 'DNO_VERIFIED'], ['sno.jharkhand', 'SNO_VERIFIED']]) {
    const r = await req(`a2n-verify-${who}`, 'POST', `/applications/${X.applicationId}/verify`, { remarks: `verified at ${at}` }, await login(`${who}.p11@example.org`));
    line(`${who} verifies X at ${at}`, r, ` -> ${r.body.application?.current_stage}`);
  }
  let r = await req('a2n-selection', 'POST', '/schemes/TOP_CLASS/academic-years/2027-28/run-selection', {}, min);
  line('ministry runs TOP_CLASS 2027-28 selection', r, ` basis=${r.body.basis} selected=${r.body.counts?.selected}`);
  const sel = r.body.selected.find((s) => s.application_id === X.applicationId).selection_id;
  r = await req('a2n-confirm', 'POST', `/selections/${sel}/confirm`, { override_reason: 'P11.5 A2 test fixture: committee confirmation inside the objection window.' }, min);
  line('ministry confirms the selection', r, ` status=${r.body.selection?.selection_status}`);
  r = await req('a2n-sanction', 'POST', `/selections/${sel}/sanction-order`, undefined, min);
  line('ministry issues the sanction order', r);
  r = await req('a2n-schedule', 'POST', `/selections/${sel}/disbursements`, undefined, min);
  line('ministry creates the disbursement schedule', r, ` instalments=${r.body.instalments.length}`);
  state.A2T8 = { disbursementId: r.body.instalments[0].id, selectionId: sel }; save();
}
const D = state.A2T8.disbursementId;
console.log(`instalment ${D}: ${dsql(D)}`);
const Y = await applicant(['A2V', 'Lakhan', 'Pahan', '1999-12-01', 'MALE', 'Ranchi', 'sbin0004455 : 88004004', 'JH-ST-2026-880032', null]);
console.log(`\nY registers with X's account typed 'sbin0004455 : 88004004': ${Y.application_no}`);
await new Promise((res) => setTimeout(res, 2000));
console.log('flags on X now:', psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status, ', ') FROM fraud_flags WHERE application_id='${X.applicationId}';`) || '(none)');
let r = await req('a2n-initiate-held', 'POST', `/disbursements/${D}/initiate`, undefined, min);
line('\nministry initiates X instalment (HIGH flag OPEN)', r);
console.log('  body:', JSON.stringify(r.body));
console.log('  denial row:', psql(`SELECT action_attempted||' | '||denial_reason||' | subject '||coalesce(subject_type,'-')||':'||coalesce(subject_id::text,'-')||' | actor_role '||actor_role FROM authorization_denials WHERE request_id='${r.body.requestId}';`) || '(none)');
console.log('  instalment after refusal:', dsql(D));
const flag = r.body.details?.flag_ids?.[0];
if (!flag) process.exit(1);
r = await req('a2n-disp-fp', 'POST', `/fraud-flags/${flag}/disposition`, { status: 'FALSE_POSITIVE', notes: 'A2 fixture: bank confirms the account is X only; Y mistyped it.' }, min);
line('ministry dispositions X flag FALSE_POSITIVE', r, ` status=${r.body.status}`);
r = await req('a2n-initiate-released', 'POST', `/disbursements/${D}/initiate`, undefined, min);
line('ministry initiates X instalment (released)', r, ` status=${r.body.status}`);
console.log('  instalment after initiate:', dsql(D));
console.log('  Y still held (own flag):', psql(`SELECT string_agg(flag_type||'/'||severity||'/'||status, ', ') FROM fraud_flags WHERE application_id='${Y.applicationId}';`));
