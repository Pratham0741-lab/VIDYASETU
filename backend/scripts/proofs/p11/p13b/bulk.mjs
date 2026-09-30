// Phase 13B proof 4: bulk clearing - dry run, real run, the two exclusions untouched.
import { writeFileSync } from 'node:fs';
import { call, login, state, LEVELS as LVL } from '../lib.mjs';
import { applicant } from '../setup.mjs';
import { psql } from '../psql.mjs';

const ino = await login('ino.ranchi.p11@example.org');
const A = (k) => state.P[k].applicationId;
for (const [k, f, l, d] of [['BK1', 'Anand', 'Kujur', '2004-06-01'], ['BK2', 'Bela', 'Oraon', '2004-06-02'], ['BK3', 'Chandan', 'Munda', '2004-06-03'], ['BK4', 'Durga', 'Tete', '2004-06-04'], ['BK5', 'Elias', 'Barla', '2004-06-05']]) {
  await applicant([k, f, l, d, k === 'BK2' || k === 'BK4' ? 'FEMALE' : 'MALE', 'Ranchi', `SBIN0004455:6060${k.slice(-1)}0060`, `JH-ST-2026-60${k.slice(-1)}060`, null]);
}
const wrongStage = psql(`SELECT id FROM applications WHERE current_stage='DNO_VERIFIED' AND jurisdiction_district='Ranchi' LIMIT 1;`);
const snap = (ids) => psql(`SELECT string_agg(application_no||':'||current_stage||':dec='||(SELECT count(*) FROM decision_records d WHERE d.application_id=a.id)||':audit='||(SELECT count(*) FROM audit_logs l WHERE l.record_id=a.id), '  ' ORDER BY application_no) FROM applications a WHERE id IN ('${ids.join("','")}');`);
const show = (label, r) => {
  writeFileSync(`responses/p13b/${label.trim().replace(/[^A-Za-z0-9_-]+/g, '-')}.json`, JSON.stringify(r, null, 1));
  console.log(`${label}: HTTP ${r.status} ${r.body.code ?? ''} requested=${r.body.requested} changed=${r.body.changed} would_change=${r.body.would_change} skipped=${r.body.skipped} | ${r.body.transaction ?? ''}`);
  for (const i of r.body.items ?? []) console.log(`   ${(i.application_no ?? i.application_id.slice(0, 8)).padEnd(24)} ${i.outcome.padEnd(13)} ${i.skip_reason ?? ''}${i.to_stage ? ' -> ' + i.to_stage : ''}${i.fraud_flag_ids ? ' flags ' + i.fraud_flag_ids.length : ''}${i.decision_record_id ? ' decision ' + i.decision_record_id.slice(0, 8) : ''}`);
};
const batch = [A('BK1'), A('BK2'), A('BK3'), A('B2'), A('D2'), wrongStage];
console.log(`batch: BK1 BK2 BK3 (eligible), B2 (Dumka - outside INO Ranchi), D2 (open HIGH flag), ${wrongStage.slice(0, 8)} (DNO_VERIFIED)`);
console.log('D2 holding flags now: ' + psql(`SELECT string_agg(flag_type||'/'||status, ', ') FROM fraud_flags WHERE application_id='${A('D2')}' AND severity='HIGH';`));
const before = { excluded: snap([A('B2'), A('D2')]), all: snap(batch) };
console.log(`\nbefore: ${before.all}`);

show('\ndry-run VERIFY', await call('POST', '/applications/bulk-actions', { action: 'VERIFY', application_ids: batch, dry_run: true }, ino, { raw: true }));
console.log(`after dry run, unchanged: ${snap(batch) === before.all}`);

show('\nVERIFY', await call('POST', '/applications/bulk-actions', { action: 'VERIFY', application_ids: batch }, ino, { raw: true }));
const after = snap(batch);
console.log(`after: ${after}`);
console.log(`B2 and D2 untouched (stage, decision records, audit rows): ${snap([A('B2'), A('D2')]) === before.excluded}`);

console.log('\n--- bulk MARK_DEFECTIVE with one shared reason');
show('MARK_DEFECTIVE no reason', await call('POST', '/applications/bulk-actions', { action: 'MARK_DEFECTIVE', application_ids: [A('BK4'), A('BK5')], deficiency: { code: 'DEF_PHOTO_MISSING', title: 'Photograph missing', description: 'Upload a recent photograph.' } }, ino, { raw: true }));
show('MARK_DEFECTIVE', await call('POST', '/applications/bulk-actions', { action: 'MARK_DEFECTIVE', application_ids: [A('BK4'), A('BK5'), A('D2')], reason: 'Both applications lack the photograph page (LEAKCHECK-7Q4Z bulk).', deficiency: { code: 'DEF_PHOTO_MISSING', title: 'Photograph missing', description: 'Upload a recent photograph.' } }, ino, { raw: true }));
console.log('   decision records: ' + psql(`SELECT string_agg(a.application_no||' '||d.decision||' remarks length '||length(d.remarks)||' audit rows '||(SELECT count(*) FROM audit_logs l WHERE l.table_name='decision_records' AND l.record_id=d.id), '; ') FROM decision_records d JOIN applications a ON a.id=d.application_id WHERE d.application_id IN ('${A('BK4')}','${A('BK5')}') AND d.decision='DEFECT';`));
