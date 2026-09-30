// Phase 17.2: database scoping of every new route, as app_user (each in a rolled-back transaction),
// for the owner, another applicant, officers in and out of jurisdiction, AUDITOR, COMMITTEE, SYSTEM
// and with NO actor set.
import { asUser } from './h.mjs';

const DOC = '2be5e2e8-e0fb-4562-9bee-09a38f630f5b'; // PV1 (Ranchi) document
const APP = 'a36b992b-eb89-4bef-a9b9-d9a4777059b3'; // PV1 (Ranchi) application
const LIST_RUN = `(SELECT selection_run_id FROM selection_lists WHERE id='8992147d-eb3c-48af-980e-34ca8a87e7f7')`; // NFST 2032-33, objections from Ranchi

const ACTORS = [
  ['PV1 (owner, Ranchi)', 'pv1.rinki.p11@example.org', 'APPLICANT'],
  ['PV2 (another applicant, Dumka)', 'pv2.mary.p11@example.org', 'APPLICANT'],
  ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['INO Dumka', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'],
  ['DNO Dumka', 'dno.dumka.p11@example.org', 'DISTRICT_NODAL_OFFICER'],
  ['SNO Jharkhand', 'sno.jharkhand.p11@example.org', 'STATE_NODAL_OFFICER'],
  ['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org', 'COMMITTEE'],
  ['COMMITTEE Dumka', 'committee.dumka.p11@example.org', 'COMMITTEE'],
  ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org', 'AUDITOR'],
  ['SYSTEM (no actor id)', null, 'SYSTEM'],
  ['no actor', null, ''],
];
const run = (title, sql, note = '') => {
  console.log(`\n=== ${title}${note ? `  (${note})` : ''}`);
  for (const [label, email, role] of ACTORS) console.log(`  ${label.padEnd(32)} ${asUser(email, role, sql)}`);
};

run('A  GET /documents/:id/file - documents RLS (the route reads the row first)', `SELECT count(*)||' document row(s)' FROM documents WHERE id='${DOC}'`,
  'the API additionally refuses AUDITOR, COMMITTEE and SUPER_ADMIN by role (least privilege)');
run('B  GET /applications/:id/history - application_history view (security_invoker)', `SELECT count(*)||' history row(s)' FROM application_history WHERE application_id='${APP}'`);
console.log(`  base table for contrast, no actor: ${asUser(null, '', `SELECT count(*)||' workflow_transitions rows visible (no RLS, M64; the route never reads it directly)' FROM workflow_transitions WHERE application_id='${APP}'`)}`);
console.log(`  view columns: ${asUser(null, '', `SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='application_history'`)}`);
run('D  GET /selection-lists/:id/objections - grievances RLS', `SELECT count(*)||' objection(s)' FROM grievances WHERE subject_type='SELECTION_OBJECTION' AND selection_run_id=${LIST_RUN}`);
run('E  GET /auth/me - current_officer_profile()', `SELECT coalesce(string_agg(coalesce(name,'-')||' / '||coalesce(institution_code,'no institution'), '; '), 'no row') FROM current_officer_profile()`);
console.log(`  officers base table for contrast, no actor: ${asUser(null, '', `SELECT count(*)||' officer rows visible (no RLS, M64; the route never reads it directly)' FROM officers`)}`);
run('F  GET /schemes (public by design) - active, non-fixture versions',
  `SELECT count(*)||' active: '||string_agg(s.code||' v'||v.version_no, ', ' ORDER BY s.code) FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE v.status='active' AND NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='scheme' AND f.entity_id=s.id)`,
  'public data: same for every actor');
console.log(`  not listed (no actor): ${asUser(null, '', `SELECT string_agg(DISTINCT v.status, ',')||' versions: '||count(*) FROM scheme_versions v WHERE v.status<>'active'`)}; fixture schemes with an active version: ${asUser(null, '', `SELECT coalesce(string_agg(s.code, ','), 'none') FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id WHERE v.status='active' AND EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='scheme' AND f.entity_id=s.id)`)}`);
