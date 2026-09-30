// Phase 13C proof 6: applicants see only their own deficiencies, officers only their jurisdiction's.
import { spawnSync } from 'node:child_process';
import { call, login, state } from '../lib.mjs';

const H1 = state.P.H1;
const E1 = state.P.E1;
console.log(`=== API: GET/POST on H1's application (${H1.application_no}, Ranchi)`);
const cases = [
  ['H1 (owner)', H1.email],
  ['E1 (another applicant)', E1.email],
  ['INO Ranchi', 'ino.ranchi.p11@example.org'],
  ['INO Dumka', 'ino.dumka.p11@example.org'],
  ['DNO Dumka', 'dno.dumka.p11@example.org'],
  ['SNO Jharkhand', 'sno.jharkhand.p11@example.org'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org'],
  ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org'],
  ['SUPER_ADMIN', 'admin.p11@example.org'],
];
for (const [label, email] of cases) {
  const t = await login(email);
  const g = await call('GET', `/applications/${H1.applicationId}/deficiencies`, undefined, t, { raw: true });
  const items = g.status === 200 ? g.body.deficiencies.flatMap((d) => d.items).length : '-';
  const p = await call('POST', `/applications/${H1.applicationId}/deficiencies/${H1.deficiencyId}/resubmit`, undefined, t, { raw: true });
  console.log(`${label.padEnd(24)} GET ${g.status} ${g.body.code ?? ''}${g.status === 200 ? ` (${g.body.deficiencies.length} deficiencies, ${items} items)` : ''} | resubmit ${p.status} ${p.body.code ?? ''}`);
}
const noToken = await fetch(`http://localhost:3000/api/v1/applications/${H1.applicationId}/deficiencies`);
console.log(`${'no token'.padEnd(24)} GET ${noToken.status}`);

console.log('\n=== database, as app_user (RLS only): rows visible in deficiency_items / deficiencies');
const run = (sql) => {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: sql });
  return (r.stderr.toString().trim().split('\n')[0] || r.stdout.toString().trim().split('\n').pop());
};
const total = run(`SELECT count(*)||' items / '||(SELECT count(*) FROM deficiencies)||' deficiencies' FROM deficiency_items;`);
console.log(`${'owner (all rows)'.padEnd(26)} ${total}`);
const own = (email) => `(SELECT count(*) FROM deficiency_items i JOIN applications a ON a.id=i.application_id JOIN applicants p ON p.id=a.applicant_id JOIN accounts c ON c.id=p.user_id WHERE c.email='${email}')`;
for (const [label, email, role] of [
  ['H1 applicant', H1.email, 'APPLICANT'],
  ['E1 applicant', E1.email, 'APPLICANT'],
  ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Dumka', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['no actor set', null, null],
]) {
  const set = email ? `SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${email}'), true), set_config('app.actor_role', '${role}', true)) s;` : '';
  const vis = run(`SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${set}
    SELECT count(*)||' items ('||count(*) FILTER (WHERE a.jurisdiction_district='Ranchi')||' Ranchi, '||count(*) FILTER (WHERE a.jurisdiction_district IS DISTINCT FROM 'Ranchi')||' other) / '||(SELECT count(*) FROM deficiencies)||' deficiencies' FROM deficiency_items i JOIN applications a ON a.id = i.application_id; COMMIT;`);
  const expected = email && role === 'APPLICANT' ? `  [owner's own items: ${run(`SELECT ${own(email)};`)}]` : '';
  console.log(`${label.padEnd(26)} ${vis}${expected}`);
}
console.log('\napp_user privileges on deficiency_items: ' + run(`SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants WHERE grantee='app_user' AND table_name='deficiency_items';`));
console.log('RLS enabled: ' + run(`SELECT relrowsecurity FROM pg_class WHERE relname='deficiency_items';`));
