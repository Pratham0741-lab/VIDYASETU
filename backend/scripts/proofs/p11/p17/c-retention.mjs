// Phase 17 Part C proofs: data retention on backdated, tagged fixtures - dry run vs real run,
// protected rows kept, protected tables untouched, audit rows never updated or deleted,
// repeatable (second run deletes nothing), SYSTEM-only function, both chains verify.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';

const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const asUser = (actorSql, role, sql) => {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actorSql}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim() || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};
const E = 'pv5.ret.p11@example.org';
const ACC = `(SELECT id FROM accounts WHERE email='${E}')`;

console.log('=== 0. Fixture applicant PV5 (Ranchi) - tagged at the end with the other p17 fixtures');
state.P17.PV5 ??= { email: E };
if (!state.P17.PV5.registered) {
  const r = await call('POST', '/auth/register', { email: E, password: PW, first_name: 'Retta', last_name: 'Minz', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-17P501', annual_income: '110000.00', bank_account: 'SBIN0004455:17P05010', gender: 'FEMALE', dob: '2004-05-05', preferred_language: 'en' }, undefined, { raw: true });
  line('register PV5', r);
  if (r.status !== 201) process.exit(1);
  state.P17.PV5.registered = true;
  save();

  // Real rows through the API: four logins (four refresh tokens), one logout (revoked), two drafts.
  const tokens = [];
  for (let i = 0; i < 4; i++) tokens.push((await call('POST', '/auth/login', { email: E, password: PW })));
  await call('POST', '/auth/logout', { refresh_token: tokens[1].refresh_token });
  const t = tokens[3].access_token;
  const d1 = await call('POST', '/application-drafts', { course_name: 'BSc Retention Old', course_year: 1 }, t, { raw: true });
  const d2 = await call('POST', '/application-drafts', { course_name: 'BSc Retention New', course_year: 1 }, t, { raw: true });
  line('PV5 draft 1 (to be backdated)', d1, ` id=${d1.body.id ?? d1.body.draft?.id}`);
  line('PV5 draft 2 (recent)', d2, ` id=${d2.body.id ?? d2.body.draft?.id}`);
  state.P17.PV5.draftOld = d1.body.id ?? d1.body.draft?.id;
  state.P17.PV5.draftNew = d2.body.id ?? d2.body.draft?.id;
  // A real notification: PV5 files a correction, INO Ranchi rejects it.
  const c = await call('POST', '/applicants/me/correction-requests', { field: 'last_name', value: 'Mins', reason: 'Retention fixture: a request that will be rejected.' }, t, { raw: true });
  await call('POST', `/correction-requests/${c.body.id}/decide`, { decision: 'REJECT', reason: 'Retention fixture: nothing supports this change.' }, await login('ino.ranchi.p11@example.org'), { raw: true });
  await new Promise((r) => setTimeout(r, 2500));

  // Application-linked notices (inserted as the owner, marked RETENTION_FIXTURE): one per protection case.
  const grievApp = psql(`SELECT g.application_id FROM grievances g WHERE g.status IN ('OPEN','IN_PROGRESS') AND NOT EXISTS (SELECT 1 FROM deficiencies d WHERE d.application_id=g.application_id AND d.status IN ('OPEN','RESUBMITTED','OVERDUE')) AND NOT EXISTS (SELECT 1 FROM deficiency_items i WHERE i.application_id=g.application_id AND i.status IN ('OPEN','RESUBMITTED','OVERDUE')) LIMIT 1;`);
  const defApp = psql(`SELECT i.application_id FROM deficiency_items i WHERE i.status IN ('OPEN','RESUBMITTED') AND NOT EXISTS (SELECT 1 FROM grievances g WHERE g.application_id=i.application_id AND g.status IN ('OPEN','IN_PROGRESS')) LIMIT 1;`);
  const freeApp = state.P17.PV1.applicationId;
  state.P17.PV5.apps = { grievApp, defApp, freeApp };
  save();
  psql(`INSERT INTO notifications (event_type, template_key, locale, channel, recipient_account_id, application_id, subject, body, status, delivered_at, created_at) VALUES
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'IN_APP', ${ACC}, '${grievApp}', 'fixture: open grievance', 'fixture', 'SENT', now(), now()),
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'IN_APP', ${ACC}, '${defApp}', 'fixture: open deficiency', 'fixture', 'SENT', now(), now()),
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'IN_APP', ${ACC}, '${freeApp}', 'fixture: nothing open', 'fixture', 'SENT', now(), now()),
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'EMAIL', ${ACC}, NULL, 'fixture: failed email', 'fixture', 'FAILED', NULL, now()),
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'SMS', ${ACC}, NULL, 'fixture: still pending', 'fixture', 'PENDING', NULL, now()),
    ('RETENTION_FIXTURE', 'p17.retention', 'en', 'IN_APP', ${ACC}, NULL, 'fixture: recent', 'fixture', 'SENT', now(), now());`);

  // Backdate (the fixtures' clock, not the data): everything but the 'recent' notice, one fresh
  // token and the recent draft is moved beyond its retention period.
  psql(`UPDATE notifications SET created_at = now() - interval '400 days' WHERE recipient_account_id=${ACC} AND subject <> 'fixture: recent';
        UPDATE refresh_tokens SET created_at = now() - interval '60 days', expires_at = now() - interval '40 days' WHERE account_id=${ACC} AND id IN (SELECT id FROM refresh_tokens WHERE account_id=${ACC} AND revoked_at IS NULL ORDER BY created_at LIMIT 2);
        UPDATE refresh_tokens SET revoked_at = now() - interval '40 days' WHERE account_id=${ACC} AND revoked_at IS NOT NULL;
        UPDATE application_drafts SET updated_at = now() - interval '200 days', created_at = now() - interval '200 days' WHERE id='${state.P17.PV5.draftOld}';`);
}

const pv5 = () => psql(`SELECT 'notifications='||(SELECT count(*) FROM notifications WHERE recipient_account_id=${ACC})
  ||' ['||(SELECT string_agg(coalesce(nullif(subject, ''), '-')||':'||status, ', ' ORDER BY subject) FROM notifications WHERE recipient_account_id=${ACC})||']'
  ||' refresh_tokens='||(SELECT count(*) FROM refresh_tokens WHERE account_id=${ACC})
  ||' drafts='||(SELECT count(*) FROM application_drafts d JOIN applicants a ON a.id=d.applicant_id WHERE a.user_id=${ACC});`);
const PROTECTED = ['audit_logs', 'authorization_denials', 'decision_records', 'selection_lists', 'selection_list_entries', 'selections', 'sanction_orders', 'disbursements', 'grievances', 'deficiencies', 'deficiency_items', 'applicants', 'applications', 'documents', 'document_extractions', 'pii_match_index', 'consent_records', 'correction_requests', 'erasure_requests'];
const snap = () => Object.fromEntries(psql(`SELECT ${PROTECTED.map((t) => `'${t}='||(SELECT count(*) FROM ${t})`).join("||' '||")};`).split(' ').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
const auditFingerprint = () => psql(`SELECT count(*)||' rows, max seq '||max(seq)||', md5 of rows up to seq '||(SELECT max(seq) FROM audit_logs)||': '||md5(string_agg(seq||record_hash, ',' ORDER BY seq)) FROM audit_logs;`);
const auditPrefix = (upTo) => psql(`SELECT md5(string_agg(seq||record_hash, ',' ORDER BY seq)) FROM audit_logs WHERE seq <= ${upTo};`);

console.log('\n=== 1. Fixtures after backdating (PV5)');
console.log('  ' + pv5());
console.log('  protection cases: ' + JSON.stringify(state.P17.PV5.apps));
console.log('  global eligible now (owner view): notifications SENT/FAILED older than 365d=' + psql(`SELECT count(*) FROM notifications WHERE created_at < now()-interval '365 days' AND status IN ('SENT','FAILED');`) + ', refresh tokens expired/revoked >30d=' + psql(`SELECT count(*) FROM refresh_tokens WHERE expires_at < now()-interval '30 days' OR revoked_at < now()-interval '30 days';`) + ', DRAFT drafts idle >180d=' + psql(`SELECT count(*) FROM application_drafts WHERE status='DRAFT' AND updated_at < now()-interval '180 days';`));

console.log('\n=== 2. Off by default: the running api has no retention schedule');
console.log('  config (api container env): ' + spawnSync('docker', ['compose', 'exec', '-T', 'api', 'sh', '-c', 'env | grep ^RETENTION_ | sort | tr "\\n" " "'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).stdout.toString().trim());
console.log('  "data retention scheduled" lines since start: ' + spawnSync('sh', ['-c', 'docker compose logs api 2>&1 | grep -c "data retention scheduled"'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).stdout.toString().trim());

console.log('\n=== 3. Who may run it');
const sa = await login('admin.p11@example.org');
for (const [who, email] of [['SNO', 'sno.jharkhand.p11@example.org'], ['AUDITOR', 'auditor.jharkhand.p11@example.org'], ['APPLICANT PV5', E]]) {
  const r = await call('POST', '/admin/retention/run', { dry_run: true }, await login(email), { raw: true });
  line(`${who} POST /admin/retention/run`, r);
}
line('AUDITOR GET /admin/retention/runs', await call('GET', '/admin/retention/runs', undefined, await login('auditor.jharkhand.p11@example.org'), { raw: true }));
line('no token POST /admin/retention/run', await call('POST', '/admin/retention/run', {}, undefined, { raw: true }));
line('SA POST /admin/retention/run {dry_run:"no"} (validation)', await call('POST', '/admin/retention/run', { dry_run: 'no' }, sa, { raw: true }));

console.log('\n=== 4. Dry run (the default for a manual run: no body)');
const before = snap();
const auditBefore = auditFingerprint();
const seqBefore = psql('SELECT max(seq) FROM audit_logs;');
const pv5Before = pv5();
let r = await call('POST', '/admin/retention/run', {}, sa, { raw: true });
line('SA POST /admin/retention/run (no body)', r, ` dry_run=${r.body.dry_run} run=${r.body.retention_run_id}`);
console.log('  counts: ' + JSON.stringify(r.body.counts));
writeFileSync('responses/p17/c-dry-run.json', JSON.stringify(r, null, 1));
console.log('  PV5 unchanged: ' + (pv5() === pv5Before) + ' | ' + pv5());
const afterDry = snap();
console.log('  protected-table counts unchanged except audit_logs +1 (the retention_runs row): ' + JSON.stringify(Object.fromEntries(Object.entries(afterDry).filter(([k, v]) => v !== before[k]).map(([k, v]) => [k, `${before[k]} -> ${v}`]))));

console.log('\n=== 5. Real run');
const before2 = snap();
const seqBefore2 = psql('SELECT max(seq) FROM audit_logs;');
const prefix2 = auditPrefix(seqBefore2);
r = await call('POST', '/admin/retention/run', { dry_run: false }, sa, { raw: true });
line('SA POST /admin/retention/run {dry_run:false}', r, ` dry_run=${r.body.dry_run} run=${r.body.retention_run_id}`);
console.log('  counts: ' + JSON.stringify(r.body.counts));
writeFileSync('responses/p17/c-real-run.json', JSON.stringify(r, null, 1));
console.log('  PV5 after: ' + pv5());
console.log('  PV5 recent draft kept: ' + psql(`SELECT count(*) FROM application_drafts WHERE id='${state.P17.PV5.draftNew}';`) + ', old draft gone: ' + (psql(`SELECT count(*) FROM application_drafts WHERE id='${state.P17.PV5.draftOld}';`) === '0'));
const after2 = snap();
console.log('  protected-table count changes: ' + JSON.stringify(Object.fromEntries(Object.entries(after2).filter(([k, v]) => v !== before2[k]).map(([k, v]) => [k, `${before2[k]} -> ${v}`]))));
console.log('  new audit rows: ' + psql(`SELECT string_agg(table_name||' '||action||' '||coalesce(actor_role,'-'), '; ' ORDER BY seq) FROM audit_logs WHERE seq > ${seqBefore2};`));
console.log('  audit rows up to seq ' + seqBefore2 + ' byte-identical after the run (no update/delete): ' + (auditPrefix(seqBefore2) === prefix2));

console.log('\n=== 6. Repeatable: a second real run deletes nothing more');
r = await call('POST', '/admin/retention/run', { dry_run: false }, sa, { raw: true });
line('SA POST /admin/retention/run {dry_run:false} (again)', r, ` counts=${JSON.stringify(r.body.counts)}`);
console.log('  PV5: ' + pv5());

console.log('\n=== 7. The recorded runs: counts only');
console.log(psql(`SELECT trigger||' dry_run='||dry_run||' by='||coalesce((SELECT email FROM accounts WHERE id=triggered_by_account_id),'schedule')||' counts='||counts::text FROM retention_runs ORDER BY run_at DESC LIMIT 4;`));
console.log('  columns: ' + psql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='retention_runs';`));
console.log('  audit row for the last run: ' + psql(`SELECT action||' actor_type='||coalesce(actor_type,'-')||' actor_role='||coalesce(actor_role,'-')||' keys='||(SELECT string_agg(k, ',') FROM jsonb_object_keys(row_data) k) FROM audit_logs WHERE table_name='retention_runs' ORDER BY seq DESC LIMIT 1;`));

console.log('\n=== 8. Database guards (as app_user)');
const RUN = `SELECT count(*) FROM retention_apply(now(), true, 365, 30, 180, 'MANUAL', NULL)`;
console.log('  SA actor calls retention_apply():          ' + asUser(`(SELECT id::text FROM accounts WHERE email='admin.p11@example.org')`, 'SUPER_ADMIN', RUN));
console.log('  role SYSTEM with an actor id:              ' + asUser(`(SELECT id::text FROM accounts WHERE email='admin.p11@example.org')`, 'SYSTEM', RUN));
console.log('  no actor:                                  ' + asUser("''", '', RUN));
console.log('  SYSTEM (no actor id), dry run:             ' + asUser("''", 'SYSTEM', RUN) + ' (rolled back)');
console.log('  AUDITOR as SYSTEM-less caller:             ' + asUser(`(SELECT id::text FROM accounts WHERE email='auditor.jharkhand.p11@example.org')`, 'AUDITOR', RUN));
console.log('  app_user UPDATE retention_runs:            ' + asUser("''", 'SYSTEM', `UPDATE retention_runs SET dry_run = true`));
console.log('  app_user DELETE retention_runs:            ' + asUser("''", 'SYSTEM', `DELETE FROM retention_runs`));
console.log('  app_user INSERT retention_runs directly:   ' + asUser("''", 'SYSTEM', `INSERT INTO retention_runs (trigger, dry_run, run_at, policy, counts) VALUES ('MANUAL', true, now(), '{}', '{}')`));
console.log('  owner: a dry-run row claiming deletions:   ' + (() => { try { return psql(`BEGIN; INSERT INTO retention_runs (trigger, dry_run, run_at, policy, counts) VALUES ('MANUAL', true, now(), '{}', '{"notifications":{"deleted":1}}'); ROLLBACK;`); } catch (e) { return String(e.stderr ?? e.message).split('\n').find((l) => l.includes('ERROR')); } })());

console.log('\n=== 9. Both chains verify');
const v = await call('GET', '/audit/verify', undefined, sa, { raw: true });
line('GET /audit/verify', v, ` ok=${v.body.ok} audit=${JSON.stringify(v.body.chain ?? v.body.audit ?? {}).slice(0, 120)} denials=${JSON.stringify(v.body.denials ?? {}).slice(0, 120)}`);
writeFileSync('responses/p17/c-verify.json', JSON.stringify(v, null, 1));
