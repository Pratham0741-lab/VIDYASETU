// Phase 13C proof 5: bulk issue and bulk resolve of the same deficiency, with dry runs;
// one out-of-jurisdiction and one fraud-held application skipped and left unchanged.
import { writeFileSync } from 'node:fs';
import { call, login, state, upload, waitProcessed } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { marker } from './c-setup.mjs';

const ino = await login('ino.ranchi.p11@example.org');
const A = (k) => state.P[k].applicationId;
const saveR = (n, r) => writeFileSync(`responses/p13c/${n}.json`, JSON.stringify(r, null, 1));
const snap = (ids) => psql(`SELECT string_agg(application_no||':'||current_stage||':def='||(SELECT count(*) FROM deficiencies d WHERE d.application_id=a.id)||':items='||(SELECT count(*) FROM deficiency_items i WHERE i.application_id=a.id)||':audit='||(SELECT count(*) FROM audit_logs l WHERE l.record_id=a.id), '  ' ORDER BY application_no) FROM applications a WHERE id IN ('${ids.join("','")}');`);
const show = (label, r) => {
  saveR(label.replace(/\W+/g, '-'), r);
  const b = r.body;
  console.log(`${label}: HTTP ${r.status} ${b.code ?? ''} requested=${b.requested} changed=${b.changed} would_change=${b.would_change} no_change=${b.no_change} skipped=${b.skipped} | ${b.transaction ?? JSON.stringify(b.details ?? '')}`);
  for (const i of b.items ?? []) {
    console.log(`   ${(i.application_no ?? i.application_id.slice(0, 8)).padEnd(24)} ${i.outcome.padEnd(13)} ${i.skip_reason ?? ''}${i.to_stage ? '-> ' + i.to_stage : ''}${i.fraud_flag_ids ? ' flags ' + i.fraud_flag_ids.length : ''}${i.checks_run !== undefined ? ` checks run ${i.checks_run} skipped ${i.checks_skipped}` : ''}${i.deficiency_items ? ' items: ' + i.deficiency_items.map((x) => `${x.status} ${x.problem_code.replace('deficiency.problem.', '')}`).join(', ') : ''}`);
  }
};
const batch = [A('BA1'), A('BA2'), A('BA3'), A('B2'), A('D2')];
console.log('batch: BA1 BA2 BA3 (Ranchi, INO stage), B2 (Dumka - outside INO Ranchi), D2 (open HIGH fraud flag)');
console.log('D2 holding flags: ' + psql(`SELECT string_agg(flag_type||'/'||status, ', ') FROM fraud_flags WHERE application_id='${A('D2')}' AND severity='HIGH' AND status <> 'FALSE_POSITIVE';`));
const excluded = () => snap([A('B2'), A('D2')]);
const before = excluded();
console.log(`B2, D2 before: ${before}\n`);

const item = { check_code: 'DOCUMENT_VALIDITY', document_type: 'INCOME_CERTIFICATE' };
const reason = 'Income certificates in this batch are older than 12 months (district drive).';
show('ISSUE_DEFICIENCY dry run', await call('POST', '/applications/bulk-actions', { action: 'ISSUE_DEFICIENCY', application_ids: batch, reason, deficiency_item: item, dry_run: true }, ino, { raw: true }));
console.log(`   after dry run: ${snap(batch.slice(0, 3))}`);
show('\nISSUE_DEFICIENCY', await call('POST', '/applications/bulk-actions', { action: 'ISSUE_DEFICIENCY', application_ids: batch, reason, deficiency_item: item }, ino, { raw: true }));
console.log(`   after: ${snap(batch.slice(0, 3))}`);
console.log(`   B2, D2 unchanged: ${excluded() === before}`);
await new Promise((res) => setTimeout(res, 4000));
console.log('   notices: ' + psql(`SELECT string_agg(a.application_no||' '||n.channel||' '||n.locale, ', ' ORDER BY a.application_no, n.channel) FROM notifications n JOIN applications a ON a.id=n.application_id WHERE n.template_key='DEFICIENCY_NOTICE' AND a.id IN ('${batch.join("','")}');`));

console.log('\n--- applicants replace the certificate: BA1, BA2 current (2026-05-01), BA3 still expired (2024-12-01)');
for (const [k, first, last, issued] of [['BA1', 'Anita', 'Tudu', '2026-05-01'], ['BA2', 'Birsa', 'Soren', '2026-05-01'], ['BA3', 'Chandmuni', 'Hansda', '2024-12-01']]) {
  const t = await login(state.P[k].email);
  const r = await upload(t, A(k), 'Family Income Certificate', marker(first, last, `;issue_date=${issued};family_income_annual=180000`));
  await waitProcessed(t, r.body.document_id);
  console.log(`   ${k} upload HTTP ${r.status} ${r.body.status}`);
}
show('\nRESOLVE_DEFICIENCY dry run', await call('POST', '/applications/bulk-actions', { action: 'RESOLVE_DEFICIENCY', application_ids: batch, dry_run: true }, ino, { raw: true }));
console.log(`   after dry run (items): ${psql(`SELECT string_agg(status, ',' ORDER BY application_id) FROM deficiency_items WHERE application_id IN ('${batch.slice(0, 3).join("','")}') AND source='OFFICER';`)}`);
show('\nRESOLVE_DEFICIENCY', await call('POST', '/applications/bulk-actions', { action: 'RESOLVE_DEFICIENCY', application_ids: batch }, ino, { raw: true }));
console.log(`   items now: ${psql(`SELECT string_agg(a.application_no||' '||i.status, ', ' ORDER BY a.application_no) FROM deficiency_items i JOIN applications a ON a.id=i.application_id WHERE i.application_id IN ('${batch.slice(0, 3).join("','")}');`)}`);
console.log(`   stages: ${snap(batch.slice(0, 3))}`);
console.log(`   B2, D2 unchanged after both actions: ${excluded() === before}  (${excluded()})`);
console.log(`   officer_reason stored on the bulk items: ${psql(`SELECT count(*) FROM deficiency_items WHERE application_id IN ('${batch.slice(0, 3).join("','")}') AND officer_reason IS NOT NULL;`)} of 3`);
