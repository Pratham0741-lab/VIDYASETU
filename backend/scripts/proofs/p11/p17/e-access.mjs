// Phase 17 Part E proofs: document views / downloads / crop views are logged (who, which document,
// when, route - no personal data); refused accesses are authorization denials.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const API = 'http://127.0.0.1:3000/api/v1';
const get = async (path, token) => {
  const res = await fetch(API + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const type = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  let code = '';
  if (type.includes('json')) try { code = JSON.parse(buf.toString()).code ?? ''; } catch { /* body */ }
  return { status: res.status, code, type: type.split(';')[0], bytes: buf.length };
};
const line = (label, r) => console.log(`${label.padEnd(72)} HTTP ${r.status} ${r.code || r.type}${r.bytes && !r.code ? ` (${r.bytes} bytes)` : ''}`);
const asUser = (email, role, sql) => {
  const actor = email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''";
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], {
    cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu',
    input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${actor}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\n${sql}; ROLLBACK;`,
  });
  return (r.stdout.toString().trim().replace(/\n/g, ' | ') || r.stderr.toString().trim().split('\n')[0]) || '(no rows)';
};

const P1 = state.P17.PV1;
const app1 = P1.applicationId;
const doc1 = psql(`SELECT id FROM documents WHERE application_id='${app1}' ORDER BY created_at DESC LIMIT 1;`);
const crop = psql(`SELECT i.id||' '||i.application_id||' '||(SELECT a2.email FROM applicants a2 WHERE a2.id=a.applicant_id) FROM deficiency_items i JOIN applications a ON a.id=i.application_id WHERE i.crop_ref IS NOT NULL ORDER BY i.id LIMIT 1;`).split(' ');
const so = psql(`SELECT s.id||' '||(SELECT p.email FROM applicants p WHERE p.id=a.applicant_id)||' '||a.jurisdiction_district FROM sanction_orders s JOIN applications a ON a.id=s.application_id ORDER BY s.id LIMIT 1;`).split(' ');
const startLog = psql('SELECT count(*) FROM document_access_log;');
const startDen = psql(`SELECT coalesce(max(occurred_at), now())::text FROM authorization_denials;`);
const startSeq = psql('SELECT max(seq) FROM audit_logs;');
console.log(`fixtures: PV1 application ${app1}, document ${doc1}; crop item ${crop[0]} (owner ${crop[2]}); sanction order ${so[0]} (owner ${so[1]}, ${so[2]})`);

const pv1 = await login(P1.email);
const pv2 = await login(state.P17.PV2.email);
const inoR = await login('ino.ranchi.p11@example.org');
const inoD = await login('ino.dumka.p11@example.org');
const dnoR = await login('dno.ranchi.p11@example.org');
const com = await login('committee.ranchi.p11@example.org');
const aud = await login('auditor.jharkhand.p11@example.org');
const cropOwner = await login(crop[2]);
const soOwner = await login(so[1]);

console.log('\n=== 1. Successful views, downloads and crop views (each should add one log row)');
line('PV1 (owner) GET /applications/:id/documents', await get(`/applications/${app1}/documents`, pv1));
line('PV1 (owner) GET /documents/:id', await get(`/documents/${doc1}`, pv1));
line('INO Ranchi GET /applications/:id/documents', await get(`/applications/${app1}/documents`, inoR));
line('INO Ranchi GET /documents/:id', await get(`/documents/${doc1}`, inoR));
line('crop owner GET /applications/:id/deficiencies/items/:itemId/crop', await get(`/applications/${crop[1]}/deficiencies/items/${crop[0]}/crop`, cropOwner));
line('DNO Ranchi GET .../crop', await get(`/applications/${crop[1]}/deficiencies/items/${crop[0]}/crop`, dnoR));
line('sanction owner GET /sanction-orders/:id', await get(`/sanction-orders/${so[0]}`, soOwner));
line('sanction owner GET /sanction-orders/:id/pdf', await get(`/sanction-orders/${so[0]}/pdf`, soOwner));
line('INO Ranchi GET /sanction-orders/:id/pdf', await get(`/sanction-orders/${so[0]}/pdf`, inoR));
console.log(`  new document_access_log rows: ${Number(psql('SELECT count(*) FROM document_access_log;')) - Number(startLog)}`);

console.log('\n=== 2. Refused accesses (no log row; an authorization denial each)');
line('INO Dumka GET /documents/:id (other district)', await get(`/documents/${doc1}`, inoD));
line('PV2 GET PV1 /documents/:id (another applicant)', await get(`/documents/${doc1}`, pv2));
line('PV2 GET PV1 /applications/:id/documents', await get(`/applications/${app1}/documents`, pv2));
line('INO Dumka GET .../crop (other district)', await get(`/applications/${crop[1]}/deficiencies/items/${crop[0]}/crop`, inoD));
line('PV2 GET /sanction-orders/:id/pdf (not theirs)', await get(`/sanction-orders/${so[0]}/pdf`, pv2));
line('INO Ranchi GET /documents/:id (nonexistent id)', await get('/documents/00000000-0000-4000-8000-00000000e404', inoR));
line('COMMITTEE GET /documents/:id (role not permitted)', await get(`/documents/${doc1}`, com));
line('AUDITOR GET /documents/:id (role not permitted)', await get(`/documents/${doc1}`, aud));
line('no token GET /documents/:id', await get(`/documents/${doc1}`));
line('INO Ranchi GET /documents/not-a-uuid (validation)', await get('/documents/not-a-uuid', inoR));
console.log(`  document_access_log rows after refusals: ${Number(psql('SELECT count(*) FROM document_access_log;')) - Number(startLog)} (unchanged)`);
console.log('  denials recorded since the start:');
console.log(psql(`SELECT '    '||d.denial_reason||' | '||d.action_attempted||' | subject '||coalesce(d.subject_type,'-')||' | '||coalesce(a.email, '-')||' ('||coalesce(d.actor_role,'-')||')' FROM authorization_denials d LEFT JOIN accounts a ON a.id=d.actor_user_id WHERE d.occurred_at > '${startDen}'::timestamptz ORDER BY d.occurred_at;`));

console.log('\n=== 3. The log rows (all columns; ids, route and actor only)');
console.log('  columns: ' + psql(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='document_access_log';`));
console.log(psql(`SELECT '  '||to_char(l.accessed_at,'HH24:MI:SS')||' '||l.access_kind||' '||l.resource_type||' doc='||coalesce(left(l.document_id::text,8),'-')||' app='||left(l.application_id::text,8)||' '||l.route||' by '||a.email||' ('||l.actor_role||') '||coalesce(l.jurisdiction_district,'-') FROM document_access_log l JOIN accounts a ON a.id=l.actor_account_id ORDER BY l.accessed_at DESC LIMIT 9;`));
const names = psql(`SELECT count(*) FROM document_access_log l, applicants p WHERE p.id IN (SELECT applicant_id FROM applications WHERE id=l.application_id) AND (row_to_json(l)::text ILIKE '%'||p.first_name||'%' OR row_to_json(l)::text ILIKE '%'||p.email||'%');`);
console.log(`  rows containing the applicant's first name or email: ${names}`);
console.log('  audit rows for them: ' + psql(`SELECT count(*)||' document_access_log INSERT rows in audit_logs since seq '||${startSeq} FROM audit_logs WHERE table_name='document_access_log' AND seq > ${startSeq};`));

console.log('\n=== 4. The log table as app_user');
console.log('  PV1 (applicant) SELECT:        ' + asUser(P1.email, 'APPLICANT', 'SELECT count(*) FROM document_access_log'));
console.log('  INO Ranchi SELECT:             ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', "SELECT count(*)||' rows, districts '||coalesce(string_agg(DISTINCT jurisdiction_district, '/'),'-') FROM document_access_log"));
console.log('  INO Dumka SELECT:              ' + asUser('ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER', "SELECT count(*)||' rows, districts '||coalesce(string_agg(DISTINCT jurisdiction_district, '/'),'-') FROM document_access_log"));
console.log('  AUDITOR SELECT:                ' + asUser('auditor.jharkhand.p11@example.org', 'AUDITOR', 'SELECT count(*) FROM document_access_log'));
console.log('  no actor SELECT:               ' + asUser(null, '', 'SELECT count(*) FROM document_access_log'));
console.log('  INO Ranchi UPDATE:             ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', "UPDATE document_access_log SET route = route"));
console.log('  INO Ranchi DELETE:             ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', 'DELETE FROM document_access_log'));
const ins = (actorEmail) => `INSERT INTO document_access_log (actor_account_id, actor_role, access_kind, resource_type, resource_id, application_id, route) VALUES ((SELECT id FROM accounts WHERE email='${actorEmail}'), 'INSTITUTE_NODAL_OFFICER', 'VIEW', 'document', '${doc1}', '${app1}', 'GET /api/v1/documents/:id')`;
console.log('  INO Ranchi INSERT as INO Dumka:' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', ins('ino.dumka.p11@example.org')));
console.log('  INO Ranchi INSERT as itself:   ' + asUser('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER', ins('ino.ranchi.p11@example.org')) + ' (rolled back)');
console.log('  AUDITOR INSERT as itself:      ' + asUser('auditor.jharkhand.p11@example.org', 'AUDITOR', ins('auditor.jharkhand.p11@example.org').replace("'INSTITUTE_NODAL_OFFICER'", "'AUDITOR'")) + ' (rolled back; no AUDITOR trigger here by design)');

console.log('\n=== 5. GET /document-access');
let r = await call('GET', `/document-access?document_id=${doc1}`, undefined, aud, { raw: true });
console.log(`  AUDITOR  HTTP ${r.status} ${r.body.accesses?.length} rows for the document; keys ${Object.keys(r.body.accesses?.[0] ?? {}).join(',')}`);
writeFileSync('responses/p17/e-document-access.json', JSON.stringify(r, null, 1));
r = await call('GET', '/document-access', undefined, await login('dno.dumka.p11@example.org'), { raw: true });
console.log(`  DNO Dumka HTTP ${r.status} ${r.body.accesses?.length} rows, districts ${JSON.stringify([...new Set((r.body.accesses ?? []).map((a) => a.jurisdiction_district))])}`);
r = await call('GET', '/document-access', undefined, inoR, { raw: true });
console.log(`  INO Ranchi HTTP ${r.status} ${r.body.code ?? ''}`);
r = await call('GET', '/document-access', undefined, pv1, { raw: true });
console.log(`  PV1       HTTP ${r.status} ${r.body.code ?? ''}`);

console.log('\n=== 6. Both chains verify');
r = await call('GET', '/audit/verify', undefined, await login('admin.p11@example.org'), { raw: true });
console.log(`  GET /audit/verify HTTP ${r.status} ok=${r.body.ok} audit rows=${r.body.chain?.rows} denials ok=${r.body.denials?.ok}`);
