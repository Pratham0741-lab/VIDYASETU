// Phase 16 Part C proofs: C1 officer notice language; C2 Aadhaar status for in-jurisdiction
// reviewers only; C3 what Postgres logs for a failed statement.
import { writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { call, login, save, state, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const saveR = (n, r) => writeFileSync(`responses/p16/c-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(70)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asUser = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q -F " | "'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};
const W = state.P16.wq.apps;
const sa = await login('admin.p11@example.org');
const ino = await login('ino.ranchi.p11@example.org');

console.log('=== C1.1 officers set a notice language');
let r = await call('GET', '/officers/me/preferences', undefined, ino, { raw: true });
line('INO Ranchi GET /officers/me/preferences (before)', r, ` ${JSON.stringify(r.body)}`);
r = await call('PUT', '/officers/me/preferences', { preferred_language: 'fr' }, ino, { raw: true });
line('INO Ranchi PUT fr (not supported)', r, ` ${JSON.stringify(r.body.details)}`);
r = await call('PUT', '/officers/me/preferences', { preferred_language: 'hi' }, ino, { raw: true });
line('INO Ranchi PUT hi', r, ` ${JSON.stringify(r.body)}`);
saveR('ino-hi', r);
const dnoOfficer = psql(`SELECT o.id FROM officers o JOIN accounts a ON a.id=o.user_id WHERE a.email='dno.ranchi.p11@example.org';`);
r = await call('PUT', `/admin/officers/${dnoOfficer}/preferences`, { preferred_language: 'sat' }, sa, { raw: true });
line('SUPER_ADMIN PUT sat for DNO Ranchi (no templates in sat)', r, ` ${JSON.stringify(r.body)}`);
r = await call('PUT', '/officers/me/preferences', { preferred_language: 'hi' }, await login('auditor.jharkhand.p11@example.org'), { raw: true });
line('AUDITOR PUT (read-only role)', r);
r = await call('PUT', `/admin/officers/${dnoOfficer}/preferences`, { preferred_language: 'hi' }, ino, { raw: true });
line('INO Ranchi PUT another officer via the admin route', r);
console.log('   raw DB, INO Ranchi updating DNO Ranchi\'s row: ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', `UPDATE officer_preferences SET preferred_language='en' WHERE officer_id='${dnoOfficer}' RETURNING officer_id`));
console.log('   audit rows: ' + psql(`SELECT string_agg(seq||' '||action||' '||actor_role||' keys='||(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(row_data) k), '; ' ORDER BY seq) FROM audit_logs WHERE table_name='officer_preferences';`));

console.log('\n=== C1.2 SLA breach notices in each officer\'s language');
const before = psql(`SELECT count(*) FROM notifications WHERE template_key='officer.sla_breached';`);
for (const [key, stage] of [['W10', 'INO_VERIFIED'], ['W06', 'DNO_VERIFIED'], ['W05', 'SNO_VERIFIED']]) {
  psql(`UPDATE applications SET stage_entered_at = now() - interval '12 days', stage_due_at = now() - interval '1 day' WHERE id='${W[key].applicationId}' AND current_stage='${stage}';`);
}
r = await call('POST', '/applications/sla-breaches/sweep', undefined, sa, { raw: true });
line('sweep', r, ` newly_recorded=${r.body.newly_recorded}`);
await sleep(3000);
console.log(psql(`SELECT n.recipient_role||' pref='||coalesce(p.preferred_language,'(none)')||' locale='||n.locale||' requested='||n.requested_locale||' '||n.channel||' | '||n.subject FROM notifications n JOIN officers o ON o.user_id=n.recipient_account_id LEFT JOIN officer_preferences p ON p.officer_id=o.id WHERE n.template_key='officer.sla_breached' AND n.application_id IN ('${W.W10.applicationId}','${W.W06.applicationId}','${W.W05.applicationId}') ORDER BY n.recipient_role, n.channel;`));
console.log('   Hindi body: ' + psql(`SELECT body FROM notifications WHERE template_key='officer.sla_breached' AND locale='hi' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`));
console.log(`   notices ${before} -> ${psql(`SELECT count(*) FROM notifications WHERE template_key='officer.sla_breached';`)}; api log fallback line: ` + (execFileSync('docker', ['compose', 'logs', '--no-color', '--since', '2m', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes('notification language fallback')).slice(-1)[0]?.replace(/^.*?\{/, '{').replace(/"time":"[^"]*",/, '') ?? '(none)'));

console.log('\n=== C2 Aadhaar status in the officer application view');
state.P16.aa ??= {};
if (!state.P16.aa.app) {
  const email = state.P14.aa.AA1.email; // authenticated (0999 0000 0017, Phase 14)
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, await login(email), { raw: true });
  if (app.status !== 201) throw new Error(JSON.stringify(app.body));
  state.P16.aa.app = app.body.id;
  save();
}
if (!state.P16.aa.w01) {
  r = await call('POST', '/applicants/me/aadhaar-authentication', { aadhaar_number: '0999 0000 0029', consent: true }, await login(W.W01.email), { raw: true });
  line('W01 authenticates 0999 0000 0029 (name differs: fails)', r, ` outcome=${r.body.authentication?.outcome} error=${r.body.authentication?.error_code}`);
  state.P16.aa.w01 = true;
  save();
}
const cases = [['AA1 (authenticated)', state.P16.aa.app], ['W01 (failed)', W.W01.applicationId], ['W03 (not attempted)', W.W03.applicationId]];
for (const who of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand', 'ministry', 'ino.dumka', 'auditor.jharkhand']) {
  const t = await login(`${who}.p11@example.org`);
  for (const [label, id] of cases) {
    r = await call('GET', `/applications/${id}`, undefined, t, { raw: true });
    line(`${who.padEnd(17)} GET /applications/:id ${label}`, r, r.status === 200 ? ` aadhaar_authentication=${JSON.stringify(r.body.aadhaar_authentication)}` : '');
  }
}
saveR('officer-view', await call('GET', `/applications/${state.P16.aa.app}`, undefined, ino, { raw: true }));
r = await call('GET', `/applications/${state.P16.aa.app}`, undefined, await login(state.P14.aa.AA1.email), { raw: true });
line('AA1 (the applicant) GET own application', r, ` has aadhaar_authentication: ${'aadhaar_authentication' in r.body}`);
r = await call('GET', `/applications/${state.P16.aa.app}`, undefined, await login(state.P14.aa.AA2.email), { raw: true });
line('AA2 (another applicant) GET it', r);
console.log('\n   the function as app_user (outcome | last4 | at):');
for (const [label, email, role] of [
  ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Dumka (other district)', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Ranchi claiming MINISTRY_OFFICER', 'ino.ranchi.p11@example.org', 'MINISTRY_OFFICER'],
  ['AUDITOR', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org', 'COMMITTEE'],
  ['AA1 (owner applicant)', state.P14.aa.AA1.email, 'APPLICANT'],
  ['AA2 (other applicant)', state.P14.aa.AA2.email, 'APPLICANT'],
  ['no actor', null, ''],
]) console.log(`     ${label.padEnd(38)} ${asUser(email, role, `SELECT * FROM aadhaar_status_for_application('${state.P16.aa.app}')`)}`);
console.log('   columns returned by the function: ' + psql(`SELECT string_agg(parameter_name, ', ' ORDER BY ordinal_position) FROM information_schema.parameters WHERE specific_name LIKE 'aadhaar_status_for_application%' AND parameter_mode='OUT';`));
console.log('   aadhaar_authentications directly as INO Ranchi: ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'SELECT count(*) FROM aadhaar_authentications'));

console.log('\n=== C3 Postgres logging of failed statements (settings unchanged)');
console.log('   ' + psql(`SELECT string_agg(name||'='||setting, ', ' ORDER BY name) FROM pg_settings WHERE name IN ('log_min_error_statement','log_statement','log_parameter_max_length_on_error','log_min_messages','log_destination','logging_collector');`));
const marker = 'P16-C3-LOG-DEMO-VALUE';
spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `INSERT INTO officer_preferences (officer_id, preferred_language, updated_by_account_id) VALUES ('${dnoOfficer}', '${marker}', '${dnoOfficer}');\nPREPARE p16 (text) AS INSERT INTO officer_preferences (officer_id, preferred_language, updated_by_account_id) VALUES ('${dnoOfficer}', $1, '${dnoOfficer}');\nEXECUTE p16('${marker}-BOUND');` });
await sleep(1000);
const pglog = execFileSync('docker', ['compose', 'logs', '--no-color', '--since', '1m', 'postgres'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes('officer_preferences') || l.includes('ERROR')).slice(-6);
for (const l of pglog) console.log('   ' + l.replace(/^postgres-1\s+\|\s+/, '').slice(0, 260));
console.log(`   literal value in the log: ${pglog.some((l) => l.includes(marker + "'"))}; bound parameter value in the log: ${pglog.some((l) => l.includes(marker + '-BOUND'))}`);
