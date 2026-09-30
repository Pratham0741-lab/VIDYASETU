// Phase 13C proof B2: the database refuses a short override reason on new writes only.
import { spawnSync } from 'node:child_process';
const psql = (sql) => spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql });
const ACTOR = "SELECT 'actor set' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='ministry.p11@example.org'), true), set_config('app.actor_role', 'MINISTRY_OFFICER', true)) x;";
const run = (label, sql) => {
  const r = psql(['SET ROLE app_user;', 'BEGIN;', ACTOR, sql, 'ROLLBACK;'].join('\n'));
  const err = r.stderr.toString().trim().split('\n')[0];
  console.log(`${label.padEnd(64)} ${err || 'ACCEPTED: ' + r.stdout.toString().trim().split('\n').pop()}`);
};
console.log('as app_user (MINISTRY_OFFICER actor); every case ROLLED BACK');
const ins = (reason, status = 'CONFIRMED') => `INSERT INTO selections SELECT (jsonb_populate_record(NULL::selections, to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'selection_status', '${status}', 'objection_window_overridden', true, 'override_reason', ${reason}))).* FROM selections s WHERE s.id = (SELECT id FROM selections ORDER BY created_at DESC LIMIT 1) RETURNING 'row inserted';`;
run('raw INSERT, overridden, reason "too short" (9)', ins(`'too short'`));
run('raw INSERT, overridden, reason "   padded   " (6 trimmed)', ins(`'   padded   '`));
run('raw UPDATE: change an existing override reason to 30 chars (control)', `UPDATE selections SET override_reason = 'Committee sign-off on 29 Sep.' WHERE id = (SELECT id FROM selections WHERE objection_window_overridden ORDER BY created_at LIMIT 1) RETURNING 'row updated';`);
run('raw UPDATE: change an existing override reason to "short"', `UPDATE selections SET override_reason = 'short' WHERE id = (SELECT id FROM selections WHERE objection_window_overridden ORDER BY created_at LIMIT 1) RETURNING 'row updated';`);
run('raw UPDATE of existing overridden rows, reason untouched', `WITH u AS (UPDATE selections SET confirmed_at = confirmed_at WHERE objection_window_overridden RETURNING 1) SELECT count(*) || ' rows updated' FROM u;`);
console.log(psql(`SELECT 'overridden rows: '||count(*)||', shortest reason: '||min(length(btrim(override_reason)))||', total selections: '||(SELECT count(*) FROM selections) FROM selections WHERE objection_window_overridden;`).stdout.toString().trim());
