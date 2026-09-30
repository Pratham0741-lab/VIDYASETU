import { readFileSync } from 'node:fs';
import { call, login, save, state } from './p9lib.mjs';
const min = await login('ministry9@example.org');
const K = state.P.K;

console.log('=== the real TOP_CLASS v3 benefits[] (seed file)');
const seed = JSON.parse(readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/prisma/scheme_versions_seed_v2.json', 'utf8'));
for (const b of seed.find((v) => v.scheme_code === 'TOP_CLASS' && v.effective_to == null).config.benefits) {
  console.log(`  ${b.id.padEnd(28)} condition=${JSON.stringify(b.condition).padEnd(28)} currency=${b.currency ?? '-'} amount_annual=${b.amount_annual ?? '-'} amount_monthly=${b.amount_monthly ?? '-'} channel=${b.disbursement_channel ?? '-'}`);
}

console.log('\n=== STEP 4: POST /selections/:id/disbursements (K)');
const s = await call('POST', `/selections/${K.selectionId}/disbursements`, undefined, min, { raw: true });
console.log(`HTTP ${s.status} scheduled_date_basis="${s.body.scheduled_date_basis}"`);
for (const d of s.body.instalments) console.log(`  instalment ${d.installment_no}: ${d.currency} ${d.amount} ${d.beneficiary_type}/${d.payment_mode} scheduled ${d.scheduled_date.slice(0, 10)} status=${d.status} lines=${JSON.stringify(d.benefit_lines.map((l) => `${l.benefit_id}:${l.amount_annual}`))}`);
console.log(`  unschedulable_benefits=${JSON.stringify(s.body.unschedulable_benefits.map((u) => u.benefit_id))}`);
const d1 = s.body.instalments[0];
K.disbursementId = d1.id; save();

const before = await call('GET', `/applications/${K.applicationId}`, undefined, min);
console.log(`\napplication stage before: ${before.current_stage}`);
const i = await call('POST', `/disbursements/${d1.id}/initiate`, undefined, min);
console.log(`initiate (MOCK PFMS stand-in): status=${i.status} transaction_reference=${i.transaction_reference}`);
const r = await call('POST', `/disbursements/${d1.id}/reconcile`, undefined, min);
console.log(`reconcile: disbursement status=${r.disbursement.status} utr=${r.disbursement.utr_number} disbursed_at=${r.disbursement.disbursed_at}`);
console.log(`  PFMS stand-in callback: ${JSON.stringify(r.pfms_callback)}`);
console.log(`  workflow (Phase 4 engine via WorkflowService.act): ${JSON.stringify(r.workflow)}`);
const after = await call('GET', `/applications/${K.applicationId}`, undefined, min);
console.log(`application stage after: ${after.current_stage} status=${after.status}`);
const again = await call('POST', `/disbursements/${d1.id}/reconcile`, undefined, min, { raw: true });
console.log(`reconcile again: HTTP ${again.status} ${JSON.stringify(again.body.details)}`);
