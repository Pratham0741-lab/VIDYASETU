// Phase 14 proof 1 (database part): the new tables as app_user, per actor, including no actor.
import { spawnSync } from 'node:child_process';
import { state } from '../lib.mjs';

const ACTORS = [
  ['sw1 (applicant, Ranchi)', state.P14.sw.SW1.email, 'APPLICANT'],
  ['sw2 (applicant, Dumka)', state.P14.sw.SW2.email, 'APPLICANT'],
  ['dr1 (applicant, drafts)', state.P14.dr.DR1.email, 'APPLICANT'],
  ['aa2 (applicant, Aadhaar)', state.P14.aa.AA2.email, 'APPLICANT'],
  ['rn1 (applicant, renewal)', state.P14.rn1.email, 'APPLICANT'],
  ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Dumka', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['DNO Dumka', 'dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['SNO Jharkhand', 'sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER'],
  ['MINISTRY', 'ministry.p11@example.org', 'MINISTRY_OFFICER'],
  ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org', 'COMMITTEE'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['SUPER_ADMIN', 'admin.p11@example.org', 'SUPER_ADMIN'],
  ['no actor', null, ''],
];
const Q = [
  ['sla_breaches', 'SELECT count(*) FROM sla_breaches'],
  ['application_drafts', 'SELECT count(*) FROM application_drafts'],
  ['aadhaar_auth', 'SELECT count(*) FROM aadhaar_authentications'],
  ['renewals(year advanced)', 'SELECT count(*) FROM renewals WHERE year_advanced_to IS NOT NULL'],
  ['renewal instalments', 'SELECT count(*) FROM disbursements WHERE renewal_id IS NOT NULL'],
];
const run = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim().split('\n')[0]);
};
console.log(`${'actor (as app_user)'.padEnd(26)} ${Q.map(([n]) => n.padStart(24)).join('')}`);
for (const [label, email, role] of ACTORS) {
  console.log(`${label.padEnd(26)} ${Q.map(([, sql]) => run(email, role, sql).padStart(24)).join('')}`);
}
console.log('\nowner (table totals):     ' + Q.map(([, sql]) => spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql + ';' }).stdout.toString().trim().padStart(24)).join(''));
console.log('\nwrites as app_user:');
console.log('  INO Ranchi INSERT sla_breaches:            ' + run('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `INSERT INTO sla_breaches (application_id, stage, stage_entered_at, stage_due_at, sla_days, jurisdiction_state, sweep_run_id, detected_at) SELECT application_id, stage, stage_entered_at - interval '1 day', stage_due_at, sla_days, jurisdiction_state, sweep_run_id, detected_at FROM sla_breaches LIMIT 1`));
console.log('  INO Ranchi calls sla_record_breaches():    ' + run('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `SELECT count(*) FROM sla_record_breaches(now(), gen_random_uuid(), NULL)`));
console.log('  no actor calls sla_record_breaches():      ' + run(null, '', `SELECT count(*) FROM sla_record_breaches(now(), gen_random_uuid(), NULL)`));
console.log('  SYSTEM (no actor id) calls it:             ' + run(null, 'SYSTEM', `SELECT count(*)||' stage instances past due, '||count(*) FILTER (WHERE newly_recorded)||' new' FROM sla_record_breaches(now(), gen_random_uuid(), NULL)`));
console.log('  aa2 UPDATE own aadhaar row:                ' + run(state.P14.aa.AA2.email, 'APPLICANT', `UPDATE aadhaar_authentications SET outcome='AUTHENTICATED', error_code=NULL`));
console.log('  aa1 INSERT aadhaar row with a 12-digit uid: ' + run(state.P14.aa.AA1.email, 'APPLICANT', `INSERT INTO aadhaar_authentications (applicant_id, outcome, uid_hmac, uid_last4, hmac_key_version, adapter_mode, txn_id, consent_given_at) SELECT id, 'AUTHENTICATED', '099900000017', '0017', 1, 'mock', 't', now() FROM applicants WHERE user_id=(SELECT id FROM accounts WHERE email='${state.P14.aa.AA1.email}')`));
console.log('  dr1 DELETE own draft:                      ' + run(state.P14.dr.DR1.email, 'APPLICANT', `DELETE FROM application_drafts`));
