// Phase 17 C: the database guards on retention - rerun after 20261003111000 revoked app_user's
// write privileges on retention_runs (the first run, c-retention.log section 8, showed them).
import { spawnSync } from 'node:child_process';
import { psql } from '../psql.mjs';

const sql = (input) => {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};
const asUser = (actorSql, role, q) =>
  sql(`SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actorSql}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${q}; ROLLBACK;`);
const acc = (e) => `(SELECT id::text FROM accounts WHERE email='${e}')`;

console.log('app_user privileges on retention_runs: ' + psql(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee='app_user' AND table_name='retention_runs';`));
const RUN = `SELECT count(*) FROM retention_apply(now(), true, 365, 30, 180, 'MANUAL', NULL)`;
console.log('SA actor calls retention_apply():          ' + asUser(acc('admin.p11@example.org'), 'SUPER_ADMIN', RUN));
console.log('role SYSTEM with an actor id:              ' + asUser(acc('admin.p11@example.org'), 'SYSTEM', RUN));
console.log('no actor:                                  ' + asUser("''", '', RUN));
console.log('AUDITOR:                                   ' + asUser(acc('auditor.jharkhand.p11@example.org'), 'AUDITOR', RUN));
console.log('SYSTEM (no actor id), dry run:             ' + asUser("''", 'SYSTEM', RUN) + ' row returned (rolled back)');
console.log('app_user UPDATE retention_runs:            ' + asUser("''", 'SYSTEM', 'UPDATE retention_runs SET dry_run = dry_run'));
console.log('app_user DELETE retention_runs:            ' + asUser("''", 'SYSTEM', 'DELETE FROM retention_runs'));
console.log('app_user INSERT retention_runs directly:   ' + asUser("''", 'SYSTEM', `INSERT INTO retention_runs (trigger, dry_run, run_at, policy, counts) VALUES ('MANUAL', true, now(), '{}', '{}')`));
console.log('app_user TRUNCATE retention_runs:          ' + asUser("''", 'SYSTEM', 'TRUNCATE retention_runs'));
console.log('app_user SELECT retention_runs:            ' + asUser("''", '', 'SELECT count(*) FROM retention_runs') + ' rows');
console.log('owner: a dry-run row claiming deletions:   ' + sql(`BEGIN; INSERT INTO retention_runs (trigger, dry_run, run_at, policy, counts) VALUES ('MANUAL', true, now(), '{}', '{"notifications":{"deleted":1}}'); ROLLBACK;`));
