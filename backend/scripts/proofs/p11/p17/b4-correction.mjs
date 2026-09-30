// Phase 17 B4 rerun after the policy fix (20261003091000): a correction request approved by the
// in-jurisdiction officer is applied through the verified change path; another is rejected.
import { writeFileSync } from 'node:fs';
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P1 = state.P17.PV1;
const t1 = await login(P1.email);
const ino = await login('ino.ranchi.p11@example.org');
console.log('before: ' + psql(`SELECT first_name||' '||last_name||' dob='||dob FROM applicants WHERE email='${P1.email}';`));
let r = await call('POST', '/applicants/me/correction-requests', { field: 'first_name', value: 'Rinky', reason: 'Name on my Class 10 certificate reads Rinky.' }, t1, { raw: true });
line('PV1 files: first_name -> "Rinky"', r, ` id=${r.body.id}`);
const a = r.body.id;
r = await call('POST', '/applicants/me/correction-requests', { field: 'dob', value: '2003-03-30', reason: 'My date of birth was typed as the 3rd, it is the 30th.' }, t1, { raw: true });
line('PV1 files: dob -> 2003-03-30', r, ` id=${r.body.id}`);
const b = r.body.id;
r = await call('POST', `/correction-requests/${a}/decide`, { decision: 'APPROVE', reason: 'Verified against the Class 10 certificate on file.' }, ino, { raw: true });
line('INO Ranchi approves the name', r, ` status=${r.body.status}`);
writeFileSync('responses/p17/b4-approved.json', JSON.stringify(r, null, 1));
r = await call('POST', `/correction-requests/${b}/decide`, { decision: 'REJECT', reason: 'No document supports the new date of birth.' }, ino, { raw: true });
line('INO Ranchi rejects the date of birth', r, ` status=${r.body.status}`);
console.log('after : ' + psql(`SELECT first_name||' '||last_name||' dob='||dob FROM applicants WHERE email='${P1.email}';`));
console.log('change log: ' + psql(`SELECT string_agg(array_to_string(changed_fields, ',')||' by '||(SELECT email FROM accounts WHERE id=changed_by_account_id)||' at '||to_char(c.created_at,'HH24:MI:SS'), '; ' ORDER BY c.created_at) FROM applicant_profile_changes c JOIN applicants p ON p.id=c.applicant_id WHERE p.email='${P1.email}';`));
r = await call('GET', '/applicants/me/correction-requests', undefined, t1, { raw: true });
console.log('PV1 sees: ' + r.body.requests.map((x) => `${x.field}:${x.status}:${x.decision?.decision ?? '-'}`).join(', '));
await sleep(2500);
console.log('notices: ' + psql(`SELECT string_agg(locale||' '||subject, ' || ' ORDER BY created_at) FROM notifications WHERE template_key='privacy.correction_decided' AND channel='IN_APP' AND recipient_account_id=(SELECT id FROM accounts WHERE email='${P1.email}');`));
console.log('audit (actor roles): ' + psql(`SELECT string_agg(table_name||' '||action||' '||actor_role, '; ' ORDER BY seq) FROM audit_logs WHERE seq > (SELECT max(seq) - 40 FROM audit_logs) AND table_name IN ('correction_requests','correction_decisions','applicants','applicant_profile_changes');`));
console.log('audit rows with the requested value "Rinky" in clear: ' + psql(`SELECT string_agg(table_name||' '||action, ', ') FROM audit_logs WHERE row_data::text LIKE '%Rinky%';`));
