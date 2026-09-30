// Phase 13C proofs 1 and 2: itemised deficiencies from failed checks, and the notice in each language.
import { writeFileSync } from 'node:fs';
import { call, login, save, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const ino = await login('ino.ranchi.p11@example.org');
const saveR = (n, r) => writeFileSync(`responses/p13c/${n}.json`, JSON.stringify(r, null, 1));
const REASON = 'Income certificate is older than the scheme allows (LEAKCHECK-9D3F, checked by Shri Balram Toppo).';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const show = (items) => items.map((i) => `     - [${i.source}/${i.check_code}] slot="${i.document_slot ?? '(all documents)'}" type=${i.document_type ?? '-'} problem=${i.problem_code} fix=${i.fix_code} deadline=${String(i.deadline_at).slice(0, 10)} status=${i.status ?? 'n/a'} crop_ref=${i.crop_ref ?? null}`).join('\n');

console.log('=== proof 1: H1 (income certificate issued 2024-06-01; validity 12 months)');
const H1 = state.P.H1;
let r = await call('POST', `/applications/${H1.applicationId}/deficiencies`, { reason: 'short' }, ino, { raw: true });
console.log(`issue with a 5-character reason: HTTP ${r.status} ${r.body.code} ${JSON.stringify(r.body.details)}`);
r = await call('POST', `/applications/${H1.applicationId}/deficiencies`, { reason: REASON, dry_run: true }, ino, { raw: true });
saveR('c1-dry-run-H1', r);
console.log(`dry run: HTTP ${r.status} deadline_days=${r.body.deadline_days} items=${r.body.items.length}\n${show(r.body.items)}`);
console.log(`   after dry run: stage=${psql(`SELECT current_stage FROM applications WHERE id='${H1.applicationId}';`)} deficiency_items=${psql(`SELECT count(*) FROM deficiency_items WHERE application_id='${H1.applicationId}';`)}`);
r = await call('POST', `/applications/${H1.applicationId}/deficiencies`, { reason: REASON }, ino, { raw: true });
saveR('c1-issue-H1', r);
console.log(`issue: HTTP ${r.status} stage=${r.body.current_stage} deficiency=${r.body.deficiency_id?.slice(0, 8)} decision_record=${r.body.decision_record_id?.slice(0, 8)}\n${show(r.body.items)}`);
H1.deficiencyId = r.body.deficiency_id;

console.log('\n=== E1 (English) and S1 (Santali - no templates; one officer-added item)');
const E1 = state.P.E1;
r = await call('POST', `/applications/${E1.applicationId}/deficiencies`, { reason: REASON }, ino, { raw: true });
saveR('c1-issue-E1', r);
E1.deficiencyId = r.body.deficiency_id;
console.log(`E1 issue: HTTP ${r.status} stage=${r.body.current_stage} items=${r.body.items.length}`);
const S1 = state.P.S1;
const casteSlot = S1.checklist.find((s) => /^ST certificate/.test(s));
r = await call('POST', `/applications/${S1.applicationId}/deficiencies`, {
  reason: 'The ST certificate carries no seal of the issuing authority; income certificate too old.',
  items: [{ document_slot: casteSlot, check_code: 'OFFICER', problem_code: 'deficiency.problem.not_attested' }],
}, ino, { raw: true });
saveR('c1-issue-S1', r);
S1.deficiencyId = r.body.deficiency_id;
console.log(`S1 issue: HTTP ${r.status} stage=${r.body.current_stage} items=${r.body.items.length}\n${show(r.body.items)}`);
save();

console.log('\n=== DB rows (as owner): deficiencies, items, audit rows');
for (const [k, P] of [['H1', H1], ['E1', E1], ['S1', S1]]) {
  console.log(`${k}: ` + psql(`SELECT 'deficiency code='||d.code||' title='||d.title||' | items='||(SELECT count(*) FROM deficiency_items i WHERE i.deficiency_id=d.id)||' | officer_reason on items='||(SELECT count(*) FROM deficiency_items i WHERE i.deficiency_id=d.id AND i.officer_reason IS NOT NULL)||' | audit rows for items='||(SELECT count(*) FROM audit_logs l WHERE l.table_name='deficiency_items' AND l.record_id IN (SELECT id FROM deficiency_items WHERE deficiency_id=d.id))||' | decision remarks length='||(SELECT length(remarks) FROM decision_records WHERE application_id=d.application_id AND decision='DEFECT' ORDER BY created_at DESC LIMIT 1) FROM deficiencies d WHERE d.id='${P.deficiencyId}';`));
}

console.log('\n=== proof 2: notices (delivered asynchronously; waiting 5 s)');
await sleep(5000);
for (const [k, P] of [['H1', H1], ['E1', E1], ['S1', S1]]) {
  const rows = psql(`SELECT template_key||' | '||channel||' | locale='||locale||' requested='||coalesce(requested_locale,'-')||' | '||status FROM notifications WHERE application_id='${P.applicationId}' AND created_at > now() - interval '5 minutes' ORDER BY channel;`);
  console.log(`${k} (${P.application_no}, preferred ${P.lang}):\n   ${rows.split('\n').join('\n   ')}`);
  const inapp = psql(`SELECT subject||E'\\n'||body FROM notifications WHERE application_id='${P.applicationId}' AND template_key='DEFICIENCY_NOTICE' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`);
  console.log(`   IN_APP text:\n     ${inapp.split('\n').join('\n     ')}`);
  writeFileSync(`responses/p13c/c2-notice-${k}.txt`, inapp);
}
console.log('\ngeneric application.deficiency_raised sent for these three: ' + psql(`SELECT count(*) FROM notifications WHERE template_key='application.deficiency_raised' AND application_id IN ('${H1.applicationId}','${E1.applicationId}','${S1.applicationId}');`));
console.log('fallback log lines (api): see c-issue log check below');
