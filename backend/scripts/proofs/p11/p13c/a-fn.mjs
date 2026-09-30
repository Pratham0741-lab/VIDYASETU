// Phase 13C proof A1: audit_verifier_denial_rows as app_user, per actor.
import { spawnSync } from 'node:child_process';
const run = (sql) => {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql });
  const err = r.stderr.toString().trim().split('\n')[0];
  if (err) return err;
  return r.stdout.toString().trim().split('\n').filter((l) => l && !l.includes('|')).join('\n');
};
const who = [
  ['AUDITOR Jharkhand (state-scoped)', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['SUPER_ADMIN', 'admin.p11@example.org', 'SUPER_ADMIN'],
  ['DNO Ranchi', 'dno.ranchi.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['DNO Ranchi claiming actor_role=AUDITOR', 'dno.ranchi.p11@example.org', 'AUDITOR'],
  ['applicant claiming actor_role=AUDITOR', null, 'AUDITOR', true],
  ['no actor set', undefined, null],
];
console.log('role: app_user; READ ONLY transaction per case');
console.log('legacy rows / chain rows via function  |  direct SELECT on authorization_denials (RLS)');
for (const [label, email, role, applicant] of who) {
  const idExpr = applicant ? `(SELECT user_id::text FROM applicants WHERE user_id IS NOT NULL ORDER BY created_at LIMIT 1)` : `(SELECT id::text FROM accounts WHERE email='${email}')`;
  const set = email === undefined ? '' : `SELECT set_config('app.actor_id', ${idExpr}, true), set_config('app.actor_role', '${role}', true);`;
  const q = (body) => run(`SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${set} ${body}; COMMIT;`).split('\n').pop() ?? '';
  const fn = q(`SELECT (SELECT count(*) FROM audit_verifier_denial_rows('legacy', NULL, NULL))||' / '||(SELECT count(*) FROM audit_verifier_denial_rows('chain', 0, 100000))`);
  const direct = q(`SELECT count(*) FILTER (WHERE seq IS NULL)||' / '||count(*) FILTER (WHERE seq IS NOT NULL) FROM authorization_denials`);
  console.log(`${label.padEnd(40)} ${fn.padEnd(60).slice(0, 60)} | ${direct}`);
}
console.log('\nowner totals: ' + run(`SELECT count(*) FILTER (WHERE seq IS NULL)||' / '||count(*) FILTER (WHERE seq IS NOT NULL) FROM authorization_denials;`));
console.log('grants: ' + run(`SELECT string_agg(grantee||':'||privilege_type, ', ') FROM information_schema.routine_privileges WHERE routine_name='audit_verifier_denial_rows';`));
console.log('definition flags: ' + run(`SELECT 'security_definer='||prosecdef||' volatility='||provolatile::text||' config='||array_to_string(proconfig, ',') FROM pg_proc WHERE proname='audit_verifier_denial_rows';`));
console.log('a bad part: ' + run(`SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='admin.p11@example.org'), true), set_config('app.actor_role','SUPER_ADMIN', true); SELECT count(*) FROM audit_verifier_denial_rows('everything', 0, 1); COMMIT;`).split('\n').pop());
