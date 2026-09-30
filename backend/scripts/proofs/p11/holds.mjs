import { writeFileSync } from 'node:fs';
import { call, login, state } from './lib.mjs';
import { psql } from './psql.mjs';
let seq = 0;
const rec = (label, r) => { writeFileSync(`responses/${String(++seq).padStart(2, '0')}-${label}.json`, JSON.stringify(r, null, 1)); return r; };
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const P = state.P, A = (k) => P[k].applicationId;
const ino = await login('ino.ranchi.p11@example.org');
const line = (s, r, extra = '') => console.log(`${s.padEnd(58)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);

console.log('=== HIGH hold on B1 (SHARED_BANK_ACCOUNT) ===');
let r = await req('b1-verify-open', 'POST', `/applications/${A('B1')}/verify`, { remarks: 'verify B1' }, ino);
line('Ranchi INO verifies B1 (flag OPEN)', r, ` flag_types=${JSON.stringify(r.body.details?.flag_types)}`);
const b1Flag = r.body.details.flag_ids[0];
console.log('  denial row:', psql(`SELECT action_attempted||' | '||denial_reason||' | '||subject_id FROM authorization_denials WHERE request_id='${r.body.requestId}';`) || '(none)');
r = await req('b1-disp-nmi', 'POST', `/fraud-flags/${b1Flag}/disposition`, { status: 'NEEDS_MORE_INFO', notes: 'Asked both applicants for bank passbook copies.' }, ino);
line('Ranchi INO dispositions B1 flag NEEDS_MORE_INFO', r, ` status=${r.body.status}`);
r = await req('b1-verify-nmi', 'POST', `/applications/${A('B1')}/verify`, { remarks: 'verify B1' }, ino);
line('Ranchi INO verifies B1 (NEEDS_MORE_INFO)', r);
r = await req('b1-disp-fp', 'POST', `/fraud-flags/${b1Flag}/disposition`, { status: 'FALSE_POSITIVE', notes: 'Passbooks show a joint family account; both are genuine students.' }, ino);
line('Ranchi INO dispositions B1 flag FALSE_POSITIVE', r, ` status=${r.body.status} reviewed_at=${!!r.body.reviewed_at}`);
r = await req('b1-verify-released', 'POST', `/applications/${A('B1')}/verify`, { remarks: 'verify B1' }, ino);
line('Ranchi INO verifies B1 (released)', r, ` stage=${r.body.current_stage ?? r.body.to_stage ?? JSON.stringify(r.body).slice(0, 80)}`);
console.log('  B2 is still held (its own flag is OPEN):', psql(`SELECT status FROM fraud_flags WHERE application_id='${A('B2')}' AND flag_type='SHARED_BANK_ACCOUNT';`));

console.log('\n=== MEDIUM is advisory: F1 (FUZZY_IDENTITY_MATCH MEDIUM) ===');
r = await req('f1-verify', 'POST', `/applications/${A('F1')}/verify`, { remarks: 'verify F1' }, ino);
line('Ranchi INO verifies F1 (only a MEDIUM flag)', r, ` stage=${r.body.current_stage ?? r.body.to_stage ?? ''}`);
console.log('\n=== Reject / mark-defective stay allowed on a HIGH-held application (C2) ===');
r = await req('c2-defective', 'POST', `/applications/${A('C2')}/mark-defective`, { remarks: 'Certificate number duplicates another applicant; upload original.', reasons: ['DOCUMENT_MISMATCH'] }, ino);
line('Ranchi INO marks C2 defective (HIGH flag OPEN)', r, r.status >= 400 ? ' ' + JSON.stringify(r.body).slice(0, 200) : ` stage=${r.body.current_stage ?? r.body.to_stage ?? ''}`);

console.log('\n=== Queue (?fraud=HIGH) ===');
for (const [who, email] of [['Ranchi INO', 'ino.ranchi.p11@example.org'], ['Dumka INO', 'ino.dumka.p11@example.org']]) {
  r = await req(`queue-${who.replace(' ', '-')}`, 'GET', '/applications/queue?fraud=HIGH', undefined, await login(email));
  const items = r.body.items ?? r.body.data ?? r.body;
  const key = Object.fromEntries(Object.entries(P).map(([k, p]) => [p.application_no, k]));
  console.log(`${who}: HTTP ${r.status} ->`, JSON.stringify(items.map((i) => `${key[i.application_no] ?? i.application_no}:${i.fraud.held ? 'HELD' : 'advisory'}(${i.fraud.flags.map((f) => f.flag_type + '/' + f.severity).join(',')})`)));
}
