import { call, login, save, state } from './p9lib.mjs';
const min = await login('ministry9@example.org');
const T4 = state.P.T4;

console.log('=== STEP 2: sanction order for a PROVISIONAL selection (T4)');
const r1 = await call('POST', `/selections/${T4.selectionId}/sanction-order`, undefined, min, { raw: true });
console.log(`HTTP ${r1.status} ${JSON.stringify(r1.body)}`);

console.log('\n=== OBJECTION: T3 (not selected) reads the run reference from their real notification');
const t3 = await login(state.P.T3.email);
const inbox = await call('GET', '/notifications', undefined, t3);
const notice = inbox.notifications.find((n) => n.template_key === 'selection.not_selected');
console.log(`T3 in-app [${notice.template_key}]:\n   ${notice.body.replace(/\n/g, '\n   ')}`);
const runRef = notice.body.match(/Selection run reference: ([0-9a-f-]{36})/)[1];
const g = await call('POST', '/grievances', { application_id: state.P.T3.applicationId, subject_type: 'SELECTION_OBJECTION', selection_run_id: runRef, description: 'I ranked 3rd on QS rank; please re-examine how the female earmark displaced my seat.' }, t3, { raw: true });
console.log(`POST /grievances (SELECTION_OBJECTION): HTTP ${g.status} id=${g.body.id} status=${g.body.status} sla_due_at=${g.body.sla_due_at} selection_run_id=${g.body.selection_run_id}`);
state.objectionId = g.body.id; save();

console.log('\n=== OVERRIDE PROOF: confirm T4 while the objection window is open');
const c1 = await call('POST', `/selections/${T4.selectionId}/confirm`, {}, min, { raw: true });
console.log(`without override: HTTP ${c1.status} ${JSON.stringify(c1.body)}`);
const c2 = await call('POST', `/selections/${T4.selectionId}/confirm`, { override_reason: 'Selection committee meeting of 27-09-2026 reviewed the run, including the pending objection on the PVTG female earmark; the earmark is mandatory, so confirmation proceeds.' }, min, { raw: true });
console.log(`with override:    HTTP ${c2.status} status=${c2.body.selection.selection_status} confirmed_at=${c2.body.selection.confirmed_at} overridden=${c2.body.selection.objection_window_overridden} window=${JSON.stringify(c2.body.objection_window)}`);
