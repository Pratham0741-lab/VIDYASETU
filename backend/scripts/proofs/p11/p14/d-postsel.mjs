// Phase 14 loose ends, Part D proof. D2: a sanction order embeds the audit-chain record of its
// sanction event and the verify route checks it. D1: an NFST scholar in year 2 is renewed;
// year 3 is recorded and SRF instalments are scheduled quarterly; a skipped, discontinued or
// pending renewal schedules nothing; TOP_CLASS unchanged; the fraud hold still guards initiation.
import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const NFST_V5 = '021aac21-b45a-4c0a-9159-b80b053cc174';
const YEAR = '2034-35';
const saveR = (n, r) => writeFileSync(`responses/p14/d-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(68)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const must = (label, r, ok = [200, 201]) => { if (!ok.includes(r.status)) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.body)}`); return r; };
const min = await login('ministry.p11@example.org');
const cr = await login('committee.ranchi.p11@example.org');
const ino = await login('ino.ranchi.p11@example.org');

state.P14 ??= {};
console.log(`=== D.0 fixture: an NFST scholar in PhD year 2 (course_year 2), ${YEAR}, through selection to sanction`);
if (!state.P14.rn1) {
  const email = 'rn1.sushila.p11@example.org';
  must('register', await call('POST', '/auth/register', { email, password: PW, first_name: 'Sushila', last_name: 'Baskey', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-14D801', annual_income: '170000.00', bank_account: 'SBIN0004455:14D08010', gender: 'FEMALE', dob: '1997-07-07' }, undefined, { raw: true }));
  const app = await call('POST', '/applications', { scheme_version_id: NFST_V5, academic_year: YEAR, course_name: 'Ph.D Anthropology', course_year: 2, declared: { education_level: LVL.NFST, degree_enrolled: 'Ph.D', tenure_years: 2, net_csir_net_score: 72, masters_or_4yr_bachelor_research_score: 68 } }, await login(email));
  for (const who of ['ino.ranchi.p11@example.org', 'dno.ranchi.p11@example.org', 'sno.jharkhand.p11@example.org']) must(`verify ${who}`, await call('POST', `/applications/${app.id}/verify`, {}, await login(who), { raw: true }));
  state.P14.rn1 = { email, applicationId: app.id, application_no: app.application_no };
  save();
}
const RN1 = state.P14.rn1;
if (!state.P14.rn1.sanctionOrderId) {
  let r = must('run-selection', await call('POST', `/schemes/NFST/academic-years/${YEAR}/run-selection`, {}, min, { raw: true }));
  const listId = r.body.selection_list_id;
  console.log(`   run-selection NFST ${YEAR}: HTTP ${r.status} list=${listId} counts=${JSON.stringify(r.body.counts)}`);
  must('approve', await call('POST', `/selection-lists/${listId}/approve`, {}, cr, { raw: true }));
  must('publish provisional', await call('POST', `/selection-lists/${listId}/publish-provisional`, {}, min, { raw: true }));
  must('close early', await call('POST', `/selection-lists/${listId}/close-objection-window-early`, { reason: 'Committee met and received no objections.' }, cr, { raw: true }));
  must('publish final', await call('POST', `/selection-lists/${listId}/publish-final`, {}, min, { raw: true }));
  const selId = psql(`SELECT id FROM selections WHERE application_id='${RN1.applicationId}';`);
  r = must('confirm', await call('POST', `/selections/${selId}/confirm`, { override_reason: 'Final list published; committee closed the window.' }, min, { raw: true }));
  console.log(`   list approved, published, window closed early, final published; selection ${selId} ${r.body.selection.selection_status}`);
  r = must('sanction', await call('POST', `/selections/${selId}/sanction-order`, {}, min, { raw: true }));
  saveR('sanction-order', r);
  Object.assign(state.P14.rn1, { selectionId: selId, sanctionOrderId: r.body.sanction_order_id });
  save();
  line('POST /selections/:id/sanction-order', r, ` content_sha256=${r.body.content_sha256.slice(0, 16)}... audit_chain=${JSON.stringify(r.body.audit_chain)}`);
  console.log(`   qr_payload: ${r.body.qr_payload}`);
  r = must('schedule', await call('POST', `/selections/${selId}/disbursements`, {}, min, { raw: true }));
  line('POST /selections/:id/disbursements (the sanctioned year)', r, ` ${r.body.release_cadence}: ${r.body.instalments.map((i) => `#${i.installment_no} ${i.amount} ${i.academic_year}`).join(', ')}`);
}

console.log('\n=== D2 the sanction PDF embeds the chain record of its sanction event');
const orderId = RN1.sanctionOrderId;
const pdfRes = await fetch(`http://127.0.0.1:3000/api/v1/sanction-orders/${orderId}/pdf`, { headers: { Authorization: `Bearer ${min}` } });
const pdf = Buffer.from(await pdfRes.arrayBuffer());
writeFileSync('responses/p14/d-sanction-order.pdf', pdf);
// /Subject is an indirect string object; read it wherever it sits in the file.
const ref = pdf.toString('latin1').match(/\/Subject (\d+) 0 R/)[1];
const subject = pdf.toString('latin1').match(new RegExp(`\n${ref} 0 obj\n\(([^)]*)\)`))[1];
console.log(`   GET /sanction-orders/:id/pdf: HTTP ${pdfRes.status}, ${pdf.length} bytes; PDF /Subject: ${subject}`);
const m = subject.match(/sha256:([0-9a-f]{64}); audit-seq:(\d+); audit-hash:([0-9a-f]{64})/);
const fromPdf = { seq: m[2], record_hash: m[3] };
console.log('   the chain row it names: ' + psql(`SELECT seq||' '||table_name||' '||action||' record='||record_id||' actor_role='||actor_role||' record_hash='||record_hash||' content_sha256='||(row_data->>'content_sha256') FROM audit_logs WHERE seq=${fromPdf.seq};`));
const order = await call('GET', `/sanction-orders/${orderId}`, undefined, min);
let r = await call('POST', '/sanction-orders/verify', { content: order.content, audit_chain: fromPdf }, await login(RN1.email), { raw: true });
line('verify (as the scholar): content + chain record from the PDF', r, ` match=${r.body.match} verified=${r.body.verified} checks=${JSON.stringify(r.body.audit_chain.checks)}`);
saveR('verify-ok', r);
console.log(`   proves: ${r.body.proves}\n   does not prove: ${r.body.does_not_prove}`);
const tampered = Buffer.from(pdf.toString('latin1').replace(`audit-hash:${fromPdf.record_hash}`, `audit-hash:${fromPdf.record_hash.slice(0, 63)}${fromPdf.record_hash[63] === '0' ? '1' : '0'}`), 'latin1');
const tSub = tampered.toString('latin1').match(/audit-seq:(\d+); audit-hash:([0-9a-f]{64})/);
r = await call('POST', '/sanction-orders/verify', { content: order.content, audit_chain: { seq: tSub[1], record_hash: tSub[2] } }, min, { raw: true });
line('verify a PDF whose printed chain hash was altered (last hex digit)', r, ` verified=${r.body.verified} checks=${JSON.stringify(r.body.audit_chain.checks)}`);
saveR('verify-altered-hash', r);
r = await call('POST', '/sanction-orders/verify', { content: { ...order.content, applicant_name: 'Someone Else' }, audit_chain: fromPdf }, min, { raw: true });
line('verify altered order data (applicant name) with the true chain record', r, ` match=${r.body.match} verified=${r.body.verified} audited_content_sha256_matches=${r.body.audit_chain.checks.audited_content_sha256_matches}`);
const otherSeq = psql(`SELECT seq FROM audit_logs WHERE seq IS NOT NULL AND table_name <> 'sanction_orders' ORDER BY seq DESC LIMIT 1;`);
r = await call('POST', '/sanction-orders/verify', { content: order.content, audit_chain: { seq: otherSeq, record_hash: psql(`SELECT record_hash FROM audit_logs WHERE seq=${otherSeq};`) } }, min, { raw: true });
line(`verify pointing at another genuine record (seq ${otherSeq})`, r, ` verified=${r.body.verified} is_this_orders_insert=${r.body.audit_chain.checks.is_this_orders_insert}`);
r = await call('POST', '/sanction-orders/verify', { content: order.content }, min, { raw: true });
line('verify without the chain reference', r, ` match=${r.body.match} verified=${r.body.verified} reason=${r.body.audit_chain.reason}`);
const legacy = psql(`SELECT id FROM sanction_orders WHERE id <> '${orderId}' ORDER BY generated_at LIMIT 1;`);
const legacyContent = (await call('GET', `/sanction-orders/${legacy}`, undefined, min)).content;
r = await call('POST', '/sanction-orders/verify', { content: legacyContent }, min, { raw: true });
line('verify an order issued before this phase', r, ` match=${r.body.match} verified=${r.body.verified} reason=${r.body.audit_chain.reason}`);

console.log('\n=== D1 renewal: year 2 -> 3 recorded, SRF instalments scheduled quarterly');
const t = await login(RN1.email);
r = await call('GET', `/applications/${RN1.applicationId}/disbursements`, undefined, min, { raw: true });
console.log(`   before: ${r.body.length} instalments: ${r.body.map((d) => `#${d.installment_no} ${d.amount} ${d.academic_year}${d.renewal_id ? ' (renewal)' : ''}`).join(', ')}`);
console.log('   recorded PhD year: applications.course_year = ' + psql(`SELECT course_year FROM applications WHERE id='${RN1.applicationId}';`));
if (!state.P14.rn1.renewal3) {
  r = must('renew', await call('POST', `/applications/${RN1.applicationId}/renewals`, { academic_year: '2035-36', academic_year_number: 3, passed_previous_year: true, percentage_obtained: 71, progress_report: 'Completed coursework and two field seasons; synopsis approved by the research committee.' }, t, { raw: true }));
  state.P14.rn1.renewal3 = r.body.id;
  save();
}
const ren3 = state.P14.rn1.renewal3;
r = await call('GET', `/applications/${RN1.applicationId}/disbursements`, undefined, min, { raw: true });
console.log(`   renewal submitted (PENDING): instalments still ${r.body.length}`);
let step = await call('POST', `/renewals/${ren3}/endorse`, { remarks: 'Progress report checked against the department record.' }, ino, { raw: true });
line('INO endorses', step, ` status=${step.body.verification_status}`);
step = await call('POST', `/renewals/${ren3}/continuation-check`, {}, min, { raw: true });
line('continuation check (frozen NFST v5 tenure rule)', step, ` verdict=${step.body.verdict} inputs=${JSON.stringify(step.body.inputs)}`);
r = await call('GET', `/applications/${RN1.applicationId}/disbursements`, undefined, min, { raw: true });
console.log(`   endorsed + checked, not decided: instalments still ${r.body.length}`);
step = await call('POST', `/renewals/${ren3}/decide`, { decision: 'APPROVE', remarks: 'Continuation approved for year 3.' }, min, { raw: true });
line('MINISTRY_OFFICER approves', step, ` status=${step.body.verification_status} year_advance=${JSON.stringify(step.body.year_advance)}`);
saveR('renewal-approve', step);
if (step.status === 200) {
  const s = step.body.schedule;
  console.log(`   schedule: cadence=${s.release_cadence} recorded_year_used=${s.recorded_year_used} rates_status=${s.rates_status}`);
  for (const i of s.instalments) console.log(`     #${i.installment_no} ${i.currency} ${i.amount} ${i.academic_year} ${i.component_type} due ${i.scheduled_date.slice(0, 10)} lines=${JSON.stringify(i.benefit_lines.map((l) => `${l.benefit_id}:${l.amount_annual}`))}`);
  console.log(`   unschedulable: ${s.unschedulable_benefits.map((u) => u.benefit_id).join(', ')}; not applicable: ${s.not_applicable_benefits.map((u) => u.benefit_id).join(', ')}`);
}
console.log('   renewal row: ' + psql(`SELECT verification_status||' year '||academic_year_number||' advanced '||year_advanced_from||'->'||year_advanced_to||' at '||to_char(year_advanced_at,'YYYY-MM-DD HH24:MI') FROM renewals WHERE id='${ren3}';`));
console.log('   audit row of the approval: ' + psql(`SELECT seq||' '||action||' '||actor_role||' year_advanced_to='||(row_data->>'year_advanced_to') FROM audit_logs WHERE table_name='renewals' AND record_id='${ren3}' ORDER BY seq DESC LIMIT 1;`));
r = await call('GET', `/applications/${RN1.applicationId}/disbursements`, undefined, min, { raw: true });
console.log(`   after: ${r.body.length} instalments: ${r.body.map((d) => `#${d.installment_no} ${d.amount} ${d.academic_year}${d.renewal_id ? ' (renewal)' : ''}`).join(', ')}`);
step = await call('POST', `/renewals/${ren3}/decide`, { decision: 'APPROVE' }, min, { raw: true });
line('approve the same renewal again', step, ` ${JSON.stringify(step.body.details)}`);

console.log('\n=== D1 a skipped year, a discontinued renewal and a pending one schedule nothing');
if (!state.P14.rn1.renewal5) {
  r = must('renew5', await call('POST', `/applications/${RN1.applicationId}/renewals`, { academic_year: '2037-38', academic_year_number: 5, passed_previous_year: true, progress_report: 'Claims to be in year five.' }, t, { raw: true }));
  state.P14.rn1.renewal5 = r.body.id;
  save();
}
const ren5 = state.P14.rn1.renewal5;
await call('POST', `/renewals/${ren5}/endorse`, { remarks: 'Forwarded for the ministry to decide.' }, ino, { raw: true });
step = await call('POST', `/renewals/${ren5}/continuation-check`, {}, min, { raw: true });
line('year-5 renewal: continuation check', step, ` verdict=${step.body.verdict}`);
step = await call('POST', `/renewals/${ren5}/decide`, { decision: 'APPROVE' }, min, { raw: true });
line('approve year 5 after recorded year 3 (skips year 4)', step, ` ${JSON.stringify(step.body.details)}`);
step = await call('POST', `/renewals/${ren5}/decide`, { decision: 'DISCONTINUE', remarks: 'Year four has not been completed or renewed.' }, min, { raw: true });
line('discontinue it', step, ` status=${step.body.verification_status} year_advanced_to=${step.body.year_advanced_to}`);
if (!state.P14.rn1.renewal4) {
  r = must('renew4', await call('POST', `/applications/${RN1.applicationId}/renewals`, { academic_year: '2036-37', academic_year_number: 4, passed_previous_year: true, progress_report: 'Year four report, awaiting endorsement.' }, t, { raw: true }));
  state.P14.rn1.renewal4 = r.body.id;
  save();
}
console.log('   renewals: ' + psql(`SELECT string_agg('y'||academic_year_number||' '||verification_status||' rows='||(SELECT count(*) FROM disbursements d WHERE d.renewal_id=r.id), '; ' ORDER BY academic_year_number) FROM renewals r WHERE parent_application_id='${RN1.applicationId}';`));
console.log('   raw DB: advancing two years on the approved renewal: ' + psql(`DO $$ BEGIN UPDATE renewals SET year_advanced_to = 5 WHERE id='${ren3}'; EXCEPTION WHEN check_violation THEN RAISE NOTICE 'refused: %', SQLERRM; END $$;`, ['-At', '-v', 'ON_ERROR_STOP=1']) || '(see notice above)');

console.log('\n=== D1 TOP_CLASS renewal behaviour unchanged');
const tc = state.P14.dr?.DR2;
r = await call('POST', `/applications/${tc.applicationId}/renewals`, { academic_year: '2027-28', academic_year_number: 2, passed_previous_year: true, progress_report: 'Second year.' }, await login(tc.email), { raw: true });
line('TOP_CLASS application: submit a renewal', r, ` ${r.body.message}`);

console.log('\n=== D1 the fraud hold guard still applies to initiating a renewal instalment');
const inst = psql(`SELECT id FROM disbursements WHERE renewal_id='${ren3}' ORDER BY installment_no LIMIT 1;`);
const flagId = psql(`INSERT INTO fraud_flags (flag_type, severity, subject_type, application_id, summary, detector, jurisdiction_state, jurisdiction_district, dedup_key, evidence) VALUES ('SHARED_BANK_ACCOUNT', 'HIGH', 'APPLICATION', '${RN1.applicationId}', 'P14 fixture: HIGH hold for the renewal-instalment proof', 'p14-fixture', 'Jharkhand', 'Ranchi', 'p14-fixture-hold-${RN1.applicationId}', '{"fixture": true}') ON CONFLICT (dedup_key) DO UPDATE SET status='OPEN', reviewed_by_officer_id=NULL, reviewed_at=NULL, review_notes=NULL RETURNING id;`).split('\n')[0];
r = await call('POST', `/disbursements/${inst}/initiate`, undefined, min, { raw: true });
line('initiate renewal instalment while a HIGH flag is OPEN', r, ` ${JSON.stringify(r.body.details)}`);
r = await call('POST', `/fraud-flags/${flagId}/disposition`, { status: 'FALSE_POSITIVE', notes: 'Fixture hold released after the proof step.' }, ino, { raw: true });
line('INO Ranchi dispositions the flag FALSE_POSITIVE', r, ` status=${r.body.status}`);
r = await call('POST', `/disbursements/${inst}/initiate`, undefined, min, { raw: true });
line('initiate it again', r, ` status=${r.body.status} amount=${r.body.amount} ref=${r.body.transaction_reference ? 'set' : '-'}`);
