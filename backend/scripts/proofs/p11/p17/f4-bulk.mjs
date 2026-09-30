// Phase 17 F4: bulk decisions carry a batch id, and the workload view counts them (bulk_actions).
// Six tagged fixture applicants in Ranchi (bk1-bk6) apply; INO Ranchi verifies five with one bulk
// action and one individually (INO_VERIFIED is the institute officer's stage). Analytics excludes
// tagged fixtures unless SUPER_ADMIN asks for them (include_fixtures=true).
import { writeFileSync } from 'node:fs';
import { call, login, save, state, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const line = (label, r, extra = '') => console.log(`${label.padEnd(64)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
state.P17.BULK ??= {};
const B = state.P17.BULK;
for (let i = 1; i <= 6; i++) {
  const key = `bk${i}`;
  if (B[key]?.applicationId) continue;
  const email = `${key}.bulk.p11@example.org`;
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: `Bulk${i}`, last_name: 'Fixture', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-17B${i}01`, annual_income: '100000.00', bank_account: `SBIN0004455:17B0${i}010`, gender: 'MALE', dob: '2003-06-0' + i, preferred_language: 'en' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`${key} ${JSON.stringify(reg.body)}`);
  const t = await login(email);
  for (const purpose of ['application_processing', 'government_verification'])
    await call('POST', '/applicants/me/consents', { purpose, status: 'GIVEN', notice_version: '2026-10-v1', language: 'en' }, t);
  const app = await call('POST', '/applications', { scheme_version_id: V.TOP_CLASS, academic_year: '2026-27', declared: { education_level: LVL.TOP_CLASS } }, t, { raw: true });
  line(`${key} applies`, app, ` ${app.body.application_no} stage=${app.body.current_stage}`);
  B[key] = { email, applicationId: app.body.id };
  save();
}
const ids = Object.values(B).map((b) => b.applicationId);
console.log('stages: ' + psql(`SELECT string_agg(current_stage, ',' ORDER BY application_no) FROM applications WHERE id IN (${ids.map((x) => `'${x}'`).join(',')});`));

const ino = await login('ino.ranchi.p11@example.org');
const sa = await login('admin.p11@example.org');
const workload = async () => {
  const r = await call('GET', '/analytics/workload?from=2026-04-01&to=2027-04-01&include_fixtures=true', undefined, sa, { raw: true });
  return r.body.actions.find((a) => a.role === 'INSTITUTE_NODAL_OFFICER' && a.level === 'DISTRICT');
};
const before = await workload();
console.log(`workload before (INO, DISTRICT level): actions_total=${before?.actions_total} verify=${before?.verify} bulk_actions=${before?.bulk_actions}`);

let r = await call('POST', '/applications/bulk-actions', { action: 'VERIFY', application_ids: ids.slice(0, 5), dry_run: true }, ino, { raw: true });
line('INO Ranchi bulk VERIFY x5, dry run', r, ` would_change=${r.body.would_change} batch=${r.body.batch_id}`);
r = await call('POST', '/applications/bulk-actions', { action: 'VERIFY', application_ids: ids.slice(0, 5) }, ino, { raw: true });
line('INO Ranchi bulk VERIFY x5', r, ` changed=${r.body.changed} batch=${r.body.batch_id}`);
writeFileSync('responses/p17/f4-bulk.json', JSON.stringify(r, null, 1));
const batch = r.body.batch_id;
r = await call('POST', `/applications/${ids[5]}/verify`, { remarks: 'Individually verified: documents in order.' }, ino, { raw: true });
line('INO Ranchi verifies the sixth individually', r, ` stage=${r.body.current_stage ?? r.body.transition?.to_stage ?? ''}`);

console.log('\ndecision_records for the six (bulk_batch_id):');
console.log(psql(`SELECT '  '||a.application_no||' '||d.decision||' by '||(SELECT email FROM officers WHERE id=d.officer_id)||' batch='||coalesce(d.bulk_batch_id::text, 'NULL (individual)') FROM decision_records d JOIN applications a ON a.id=d.application_id WHERE a.id IN (${ids.map((x) => `'${x}'`).join(',')}) ORDER BY a.application_no;`));
console.log(`  rows with this response's batch id: ${psql(`SELECT count(*) FROM decision_records WHERE bulk_batch_id='${batch}';`)}`);
console.log(`  decision rows with / without a batch id overall: ${psql(`SELECT count(*) FILTER (WHERE bulk_batch_id IS NOT NULL)||' / '||count(*) FILTER (WHERE bulk_batch_id IS NULL) FROM decision_records;`)}`);
console.log(`  the setting after the request (a new transaction): '${psql(`SELECT coalesce(current_setting('app.bulk_batch_id', true), '(unset)');`)}'`);
console.log(`  audit rows for the bulk decisions (actor, batch in row_data): ${psql(`SELECT count(*)||' rows, actor_role '||string_agg(DISTINCT actor_role, ',')||', row_data has bulk_batch_id: '||bool_and(row_data->>'bulk_batch_id' = '${batch}') FROM audit_logs WHERE table_name='decision_records' AND row_data->>'bulk_batch_id' = '${batch}';`)}`);

const after = await workload();
console.log(`\nworkload after (INO, DISTRICT level): actions_total=${after?.actions_total} verify=${after?.verify} bulk_actions=${after?.bulk_actions}`);
const csv = await fetch('http://127.0.0.1:3000/api/v1/analytics/workload/export.csv?from=2026-04-01&to=2027-04-01&include_fixtures=true', { headers: { Authorization: `Bearer ${sa}` } }).then((x) => x.text());
const [head, ...rows] = csv.trim().split('\n');
console.log('workload CSV header: ' + head);
console.log('workload CSV INO row: ' + rows.find((x) => x.includes('INSTITUTE_NODAL_OFFICER,DISTRICT')));
const meta = await call('GET', '/analytics/workload?from=2026-04-01&to=2027-04-01&include_fixtures=true', undefined, sa, { raw: true });
console.log('meta.bulk_actions: ' + meta.body.meta.bulk_actions);
