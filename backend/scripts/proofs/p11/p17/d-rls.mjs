// Phase 17 Part D proofs: M45 (applicants row-level security) and M32 (AUDITOR read-only in the
// database), as app_user - including SYSTEM and no actor - and through the live API.
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';

const line = (label, r, extra = '') => console.log(`${label.padEnd(70)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const asUser = (email, role, sql, { actorSql } = {}) => {
  const actor = actorSql ?? (email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''");
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim().replace(/\n/g, ' | ') || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};
const P1 = state.P17.PV1.email; // Rinky Toppo, Ranchi
const P2 = state.P17.PV2.email; // Mary Bara, Dumka

console.log('=== 1. applicants: RLS state and policies (as the owner)');
console.log(psql(`SELECT 'rowsecurity='||relrowsecurity||' force='||relforcerowsecurity FROM pg_class WHERE relname='applicants';`));
console.log(psql(`SELECT string_agg(policyname||' '||cmd, ', ' ORDER BY policyname) FROM pg_policies WHERE tablename='applicants';`));
console.log('total applicants (owner, RLS bypassed): ' + psql('SELECT count(*) FROM applicants;'));

console.log('\n=== 2. applicants as app_user: rows visible, and whether PV1 (Ranchi) / PV2 (Dumka) are among them');
const vis = `SELECT count(*)||' visible; PV1='||count(*) FILTER (WHERE user_id=(SELECT id FROM accounts WHERE email='${P1}'))||' PV2='||count(*) FILTER (WHERE user_id=(SELECT id FROM accounts WHERE email='${P2}'))||' districts='||coalesce(string_agg(DISTINCT domicile_district, '/'), '-') FROM applicants`;
for (const [label, email, role] of [
  ['PV1 (owner)', P1, 'APPLICANT'],
  ['PV2 (another applicant)', P2, 'APPLICANT'],
  ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Dumka', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['DNO Ranchi', 'dno.ranchi.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['DNO Dumka', 'dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org', 'COMMITTEE'],
  ['SNO Jharkhand', 'sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER'],
  ['MINISTRY', 'ministry.p11@example.org', 'MINISTRY_OFFICER'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['SUPER_ADMIN (no jurisdiction row policy)', 'admin.p11@example.org', 'SUPER_ADMIN'],
  ['SYSTEM (role SYSTEM, no actor id)', null, 'SYSTEM'],
  ['no actor', null, ''],
  ['role SYSTEM WITH an actor id (not SYSTEM)', 'ino.dumka.p11@example.org', 'SYSTEM'],
  ['role APPLICANT, unknown actor id', null, 'APPLICANT'],
]) {
  console.log(`  ${label.padEnd(44)} ${asUser(email, role, vis, email === null && role === 'APPLICANT' ? { actorSql: "'00000000-0000-4000-8000-000000000000'" } : {})}`);
}

console.log('\n=== 3. applicants writes as app_user (each in a rolled-back transaction)');
const upd = (who) => `WITH u AS (UPDATE applicants SET preferred_language=preferred_language WHERE user_id=(SELECT id FROM accounts WHERE email='${who}') RETURNING 1) SELECT count(*)||' row(s) updated' FROM u`;
for (const [label, email, role, sql] of [
  ['PV1 updates own row', P1, 'APPLICANT', upd(P1)],
  ['PV2 updates PV1', P2, 'APPLICANT', upd(P1)],
  ['INO Ranchi (reviewer, in jurisdiction) updates PV1', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', upd(P1)],
  ['INO Dumka updates PV1 (other district)', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER', upd(P1)],
  ['COMMITTEE Ranchi updates PV1 (not a reviewer role)', 'committee.ranchi.p11@example.org', 'COMMITTEE', upd(P1)],
  ['SYSTEM updates PV1 (read-only)', null, 'SYSTEM', upd(P1)],
  ['no actor updates PV1', null, '', upd(P1)],
  ['PV2 deletes PV1', P2, 'APPLICANT', `WITH d AS (DELETE FROM applicants WHERE user_id=(SELECT id FROM accounts WHERE email='${P1}') RETURNING 1) SELECT count(*)||' row(s) deleted' FROM d`],
  ['no actor inserts an applicant', null, '', `INSERT INTO applicants (user_id, email, first_name, last_name, category, domicile_state, domicile_district) VALUES ((SELECT id FROM accounts WHERE email='${P2}'), 'x@example.org', '\\x00'::bytea, '\\x00'::bytea, 'ST', 'Jharkhand', 'Dumka')`],
]) {
  console.log(`  ${label.padEnd(58)} ${asUser(email, role, sql)}`);
}

console.log('\n=== 4. applicant_id_for_account(): the id only, as app_user with no actor');
console.log('  PV1 account -> ' + asUser(null, '', `SELECT applicant_id_for_account((SELECT id FROM accounts WHERE email='${P1}')) = (SELECT id FROM applicants WHERE false) IS NULL AND applicant_id_for_account((SELECT id FROM accounts WHERE email='${P1}')) IS NOT NULL`));
console.log('  officer account -> ' + asUser(null, '', `SELECT coalesce(applicant_id_for_account((SELECT id FROM accounts WHERE email='sno.jharkhand.p11@example.org'))::text, 'NULL')`));
console.log('  function: ' + psql(`SELECT 'security_definer='||prosecdef||' returns='||format_type(prorettype, NULL)||' acl='||proacl::text FROM pg_proc WHERE proname='applicant_id_for_account';`));

console.log('\n=== 5. M32: AUDITOR writes refused by the database, as app_user');
console.log('  tables carrying trigger_refuse_auditor_writes: ' + psql(`SELECT count(DISTINCT event_object_table) FROM information_schema.triggers WHERE trigger_name='trigger_refuse_auditor_writes';`) + ' of ' + psql(`SELECT count(*) FROM pg_tables WHERE schemaname='public';`) + ' public tables');
console.log('  tables WITHOUT it: ' + psql(`SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_tables t WHERE schemaname='public' AND NOT EXISTS (SELECT 1 FROM information_schema.triggers g WHERE g.trigger_name='trigger_refuse_auditor_writes' AND g.event_object_table=t.tablename);`));
const AUD = 'auditor.jharkhand.p11@example.org';
for (const [label, sql] of [
  ['UPDATE applications', `UPDATE applications SET updated_at=updated_at WHERE jurisdiction_district='Ranchi'`],
  ['UPDATE applicants', `UPDATE applicants SET preferred_language=preferred_language`],
  ['INSERT notifications', `INSERT INTO notifications (recipient_account_id, channel, template_key, locale, subject, body, status) VALUES ((SELECT id FROM accounts WHERE email='${AUD}'), 'IN_APP', 'x', 'en', 's', 'b', 'SENT')`],
  ['UPDATE officer_preferences', `UPDATE officer_preferences SET preferred_language=preferred_language`],
  ['DELETE correction_requests', `DELETE FROM correction_requests`],
  ['INSERT decision_records (0 rows selected)', `INSERT INTO decision_records SELECT * FROM decision_records WHERE false`],
  ['TRUNCATE fraud_flags', `TRUNCATE fraud_flags`],
  ['SELECT applications (read still works)', `SELECT count(*)||' applications visible' FROM applications`],
]) {
  console.log(`  AUDITOR ${label.padEnd(42)} ${asUser(AUD, 'AUDITOR', sql)}`);
}
console.log('  control - SNO UPDATE applications (rolled back): ' + asUser('sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER', `WITH u AS (UPDATE applications SET updated_at=updated_at WHERE jurisdiction_district='Ranchi' RETURNING 1) SELECT count(*)||' row(s) updated' FROM u`));
console.log('  AUDITOR role with no actor id, UPDATE notifications: ' + asUser(null, 'AUDITOR', `UPDATE notifications SET read_at=read_at WHERE false`));

console.log('\n=== 6. Live API: flows that touch applicants with no actor or as SYSTEM');
state.P17.PV3.registered = true; state.P17.PV4 ??= { email: 'pv4.anita.p11@example.org' };
save();
let r = state.P17.PV4.registered ? { status: 201, body: { applicant_id: '(registered in an earlier run of this script)' } } : await call('POST', '/auth/register', { email: state.P17.PV4.email, password: PW, first_name: 'Anita', last_name: 'Lakra', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-17P401', annual_income: '120000.00', bank_account: 'SBIN0004455:17P04010', gender: 'FEMALE', dob: '2004-04-04', preferred_language: 'hi' }, undefined, { raw: true });
if (r.status === 201) { state.P17.PV4.registered = true; save(); }
line('register PV4 (applicant insert as its own new owner)', r, r.status === 201 ? ` applicant=${r.body.applicant_id}` : ' ' + JSON.stringify(r.body.details));
console.log('  PV4 applicant row: ' + psql(`SELECT p.domicile_district||' user_id=account:'||(p.user_id=a.id)||' bank_account stored as ciphertext bytes='||(octet_length(p.bank_account) > 16) FROM applicants p JOIN accounts a ON a.id=p.user_id WHERE a.email='${state.P17.PV4.email}';`));
console.log('  audit triggers on accounts/applicants (none before Phase 17 either): ' + psql(`SELECT coalesce(string_agg(tgname||' on '||tgrelid::regclass::text, ', '), 'none') FROM pg_trigger WHERE tgrelid::regclass::text IN ('applicants','accounts') AND tgname NOT LIKE 'trigger_refuse_auditor_writes' AND NOT tgisinternal;`));
r = await call('POST', '/auth/register', { email: state.P17.PV4.email, password: PW, first_name: 'Dup', last_name: 'Licate', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-17P402', annual_income: '1.00', bank_account: 'SBIN0004455:17P04020', gender: 'FEMALE', dob: '2004-04-04' }, undefined, { raw: true });
line('register the same email again', r, ' ' + JSON.stringify(r.body.details));
const lp = await call('POST', '/auth/login', { email: state.P17.PV4.email, password: PW }, undefined, { raw: true });
line('login PV4 (applicant_id_for_account, no actor)', lp);
const tok = lp.body.access_token;
const claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
console.log(`  token role=${claims.role} sub=account:${claims.sub === psql(`SELECT id FROM accounts WHERE email='${state.P17.PV4.email}';`)}`);
r = await call('POST', '/auth/refresh', { refresh_token: lp.body.refresh_token }, undefined, { raw: true });
line('refresh PV4', r, ` role=${JSON.parse(Buffer.from(r.body.access_token.split('.')[1], 'base64url').toString()).role}`);
r = await call('GET', '/applicants/me', undefined, tok, { raw: true });
line('PV4 GET /applicants/me', r, ` name=${r.body.first_name} ${r.body.last_name}`);
const lo = await call('POST', '/auth/login', { email: 'ino.ranchi.p11@example.org', password: PW }, undefined, { raw: true });
line('login INO Ranchi (officer)', lo, ` role=${JSON.parse(Buffer.from(lo.body.access_token.split('.')[1], 'base64url').toString()).role}`);
const la = await call('POST', '/auth/login', { email: 'auditor.jharkhand.p11@example.org', password: PW }, undefined, { raw: true });
line('login AUDITOR', la);
const bad = await call('POST', '/auth/login', { email: state.P17.PV4.email, password: 'wrong-Passphrase-1' }, undefined, { raw: true });
line('login PV4 with a wrong password', bad, ' ' + JSON.stringify(bad.body.details));

const app1 = state.P17.PV1.applicationId;
const ino = await login('ino.ranchi.p11@example.org');
r = await call('GET', `/applications/${app1}`, undefined, ino, { raw: true });
line('INO Ranchi GET PV1 application', r, ` application_no=${r.body.application_no}`);
r = await call('GET', `/applications/${app1}/selection-result`, undefined, ino, { raw: true });
line('INO Ranchi GET PV1 selection-result', r);
r = await call('GET', `/applications/${app1}`, undefined, await login('ino.dumka.p11@example.org'), { raw: true });
line('INO Dumka GET PV1 application', r);
r = await call('GET', '/applicants/me', undefined, await login(P1), { raw: true });
line('PV1 GET /applicants/me', r, ` name=${r.body.first_name} ${r.body.last_name}`);
writeFileSync('responses/p17/d-login.json', JSON.stringify({ status: lp.status, token_type: lp.body.token_type, claims: { ...claims, sub: '(account id)' } }, null, 1));

console.log('\n=== 7. Live API: every route the RBAC matrix opens to AUDITOR, as the AUDITOR (no 5xx, no AUDITOR_READ_ONLY)');
const aud = await login(AUD);
const APP_ID = app1;
const listId = psql(`SELECT id FROM selection_lists ORDER BY created_at DESC LIMIT 1;`);
const denBefore = psql(`SELECT count(*) FROM authorization_denials WHERE denial_reason='AUDITOR_READ_ONLY';`);
const routes = [
  '/auth/me', '/applications', `/applications/${APP_ID}`, '/authorization-denials', `/applications/${APP_ID}/fraud-flags`,
  ...['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction', 'workload', 'verification-quality'].flatMap((k) => [`/analytics/${k}?from=2026-04-01&to=2027-04-01`, ...['csv', 'xlsx', 'pdf'].map((f) => `/analytics/${k}/export.${f}?from=2026-04-01&to=2027-04-01`)]),
  '/analytics/fairness?scheme=NFST&academic_year=2031-32', ...['csv', 'xlsx', 'pdf'].map((f) => `/analytics/fairness/export.${f}?scheme=NFST&academic_year=2031-32`),
  '/audit/verify', `/applications/${APP_ID}/deficiencies`, '/selection-lists', `/selection-lists/${listId}`, `/applications/${APP_ID}/selection-result`,
  '/notifications', '/admin/schemes', '/admin/schemes/NFST/diff?from=4&to=5', '/admin/schemes/NFST/versions/5', '/applications/sla-breaches/recorded',
  '/officers/me/preferences', '/correction-requests',
];
const counts = {};
for (const p of routes) {
  const res = await fetch('http://127.0.0.1:3000/api/v1' + p, { headers: { Authorization: `Bearer ${aud}` } });
  await res.arrayBuffer();
  counts[res.status] = (counts[res.status] ?? 0) + 1;
  if (res.status >= 500 || res.status === 403) console.log(`  ${res.status} GET ${p}`);
}
const v = await call('POST', '/sanction-orders/verify', { order_no: 'NONE', sha256: '0'.repeat(64) }, aud, { raw: true });
counts[v.status] = (counts[v.status] ?? 0) + 1;
console.log(`  ${routes.length + 1} AUDITOR routes: status counts ${JSON.stringify(counts)}; POST /sanction-orders/verify -> ${v.status}`);
console.log(`  AUDITOR_READ_ONLY denials before=${denBefore} after=${psql(`SELECT count(*) FROM authorization_denials WHERE denial_reason='AUDITOR_READ_ONLY';`)}`);
