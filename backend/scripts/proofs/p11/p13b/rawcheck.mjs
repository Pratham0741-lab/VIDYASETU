// Phase 13B proof 3 (database half): raw writes without a reason, as app_user with an officer actor,
// always rolled back. Captures psql's stderr so refusals are reported, not mistaken for success.
import { spawnSync } from 'node:child_process';
import { state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const inoId = psql(`SELECT id FROM accounts WHERE email='ino.ranchi.p11@example.org';`);
const off = psql(`SELECT id FROM officers WHERE user_id='${inoId}';`);
const run = (label, sql) => {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id','${inoId}',true), set_config('app.actor_role','INSTITUTE_NODAL_OFFICER',true) \\g /dev/null\nWITH w AS (${sql} RETURNING 1) SELECT 'rows written: ' || count(*) FROM w;\nROLLBACK;`,
  });
  const err = r.stderr.toString().split('\n').find((l) => l.startsWith('ERROR'));
  const rows = r.stdout.toString().split('\n').find((l) => l.startsWith('rows written')) ?? '';
  console.log(`  ${label.padEnd(56)} ${err ? 'REFUSED  ' + err.replace('ERROR:  ', '') : `ACCEPTED (${rows}; rolled back)`}`);
};
const A = (k) => state.P[k].applicationId;
const ins = (app, decision, extra = '') =>
  `INSERT INTO decision_records (id, application_id, officer_id, decision, stage${extra ? ', reasons' : ''}) VALUES (gen_random_uuid(), '${app}', '${off}', '${decision}', 'INSTITUTE'${extra ? `, '${extra}'` : ''})`;
console.log('raw writes as app_user (INO Ranchi actor), each in BEGIN ... ROLLBACK:');
run('decision_records INSERT REJECT, no remarks', ins(A('R13B1'), 'REJECT'));
run('decision_records INSERT DEFECT, no remarks', ins(A('R13B2'), 'DEFECT'));
run('decision_records INSERT APPROVE override, no remarks', ins(A('R13B3'), 'APPROVE', '{"eligibility_review_confirmed": true}'));
run('decision_records INSERT REJECT, remarks "   short  "', ins(A('R13B1'), 'REJECT').replace("'INSTITUTE')", "'INSTITUTE')").replace('stage)', 'stage, remarks)').replace("'INSTITUTE')", "'INSTITUTE', '   short  ')"));
run('control: decision_records INSERT plain APPROVE, no remarks', ins(A('R13B3'), 'APPROVE'));
run('control: REJECT with a 10+ char reason', ins(A('R13B1'), 'REJECT').replace('stage)', 'stage, remarks)').replace("'INSTITUTE')", "'INSTITUTE', 'Income above the ceiling.')"));
const doc = psql(`SELECT id FROM document_extractions WHERE document_id='${state.R13B4doc}';`);
const docNR = psql(`SELECT id FROM document_extractions WHERE document_id='${state.R13B4doc2}';`);
run('document_extractions confirm WITH corrections, no reason', `UPDATE document_extractions SET review_status='OFFICER_CONFIRMED', corrected_fields='["certificate_number"]', confirmation_reason=NULL, confirmed_by_officer_id='${off}', confirmed_at=now() WHERE id='${docNR || doc}'`);
run('control: confirm WITHOUT corrections, no reason', `UPDATE document_extractions SET review_status='OFFICER_CONFIRMED', corrected_fields='[]', confirmed_by_officer_id='${off}', confirmed_at=now() WHERE id='${docNR || doc}'`);
run('control: later update of the OLD corrected row (pre-13B, no reason)', `UPDATE document_extractions SET extraction_engine = extraction_engine WHERE corrected_fields <> '[]'::jsonb AND confirmation_reason IS NULL`);
const openFlag = psql(`SELECT id FROM fraud_flags WHERE status='OPEN' AND jurisdiction_district='Ranchi' AND subject_type='APPLICATION' LIMIT 1;`);
run('fraud_flags disposition, no notes', `UPDATE fraud_flags SET status='CONFIRMED', reviewed_by_officer_id='${off}', reviewed_at=now(), review_notes=NULL WHERE id='${openFlag}'`);
run('fraud_flags disposition, notes "ok"', `UPDATE fraud_flags SET status='CONFIRMED', reviewed_by_officer_id='${off}', reviewed_at=now(), review_notes='ok' WHERE id='${openFlag}'`);
const g = state.R13B6g;
run('control: fraud_flags disposition with a 10+ char note', `UPDATE fraud_flags SET status='CONFIRMED', reviewed_by_officer_id='${off}', reviewed_at=now(), review_notes='Checked with the bank.' WHERE id='${openFlag}'`);
run('grievances RESOLVED, empty note', `UPDATE grievances SET status='RESOLVED', resolved_by_officer_id='${off}', resolved_at=now(), resolution_note='' WHERE id='${g}'`);
const rn = psql(`SELECT id FROM renewals WHERE verification_status IN ('PENDING','ENDORSED') LIMIT 1;`);
if (rn) run('renewals DISCONTINUED, no remarks', `UPDATE renewals SET verification_status='DISCONTINUED', decided_by_officer_id='${off}', verified_at=now(), decision_remarks=NULL WHERE id='${rn}'`);
else console.log('  (no PENDING/ENDORSED renewal to test against)');
