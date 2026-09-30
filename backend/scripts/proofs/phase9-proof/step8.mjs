import { call, login, save, state } from './p9lib.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const K = state.P.K;
const k = await login(K.email);
const min = await login('ministry9@example.org');

console.log('=== STEP 8: K raises a grievance about the real disbursement');
const g = await call('POST', '/grievances', { application_id: K.applicationId, subject_type: 'DISBURSEMENT', disbursement_id: K.disbursementId, description: 'The first instalment shows SUCCESS but only part of it reached my account.' }, k, { raw: true });
console.log(`POST /grievances: HTTP ${g.status} id=${g.body.id} subject=${g.body.subject_type} disbursement_id=${g.body.disbursement_id} status=${g.body.status} sla_due_at=${g.body.sla_due_at}`);
state.grievanceId = g.body.id; save();

const s = await call('POST', `/grievances/${g.body.id}/start`, undefined, min, { raw: true });
console.log(`ministry start:   HTTP ${s.status} status=${s.body.status} sla_due_at=${s.body.sla_due_at}`);
const r = await call('POST', `/grievances/${g.body.id}/resolve`, { outcome: 'RESOLVED', note: 'PFMS confirms the full INR 41,000 was credited (UTR on the disbursement record); the bank had held part of it for 2 days.' }, min, { raw: true });
console.log(`ministry resolve: HTTP ${r.status} status=${r.body.status} resolved_by=${r.body.resolved_by_officer_id} resolved_at=${r.body.resolved_at}`);
const again = await call('POST', `/grievances/${g.body.id}/resolve`, { outcome: 'REJECTED', note: 'x' }, min, { raw: true });
console.log(`resolve again:    HTTP ${again.status} ${JSON.stringify(again.body.details)}`);

const o = await call('POST', `/grievances/${state.objectionId}/resolve`, { outcome: 'REJECTED', note: 'The PVTG pool has 3 seats with a mandatory 30% female earmark (1 seat); the reservation displaced rank 3 as the rules require.' }, min, { raw: true });
console.log(`T3 objection:     HTTP ${o.status} status=${o.body.status}`);

await sleep(3000);
console.log('\n=== in-app notifications (GET /api/v1/notifications, each recipient\'s own token)');
for (const [who, token] of [['K', k], ['MINISTRY', min]]) {
  const inbox = await call('GET', '/notifications', undefined, token);
  for (const n of inbox.notifications.filter((x) => x.event_type === 'grievances.status_changed' && x.application_id === K.applicationId).reverse()) {
    console.log(`${who}: [${n.template_key}] ${n.subject}\n   ${n.body.replace(/\n/g, '\n   ')}`);
  }
}
