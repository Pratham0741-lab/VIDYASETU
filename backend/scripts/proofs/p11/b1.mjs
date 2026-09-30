import { call, login, state } from './lib.mjs';
import { applicant } from './setup.mjs';
import { psql } from './psql.mjs';
const extra = [['Sukra', 'Bhengra', '1996-01-07'], ['Mangri', 'Toppo', '1994-06-18'], ['Budhu', 'Surin', '1993-09-29'], ['Jitni', 'Dungdung', '1992-02-15'], ['Phagu', 'Barla', '1991-05-26']];
let k = state.B1n ?? 0;
const add = async () => { const [f, l, d] = extra[k]; const a = await applicant([`U-SURGE-01-X${k}`, f, l, d, k % 2 ? 'FEMALE' : 'MALE', 'Ranchi', `SBIN0004455:7719${k}001`, `JH-ST-2026-97${k}001`, 'U-SURGE-01']); k += 1; state.B1n = k; await new Promise((r) => setTimeout(r, 2500)); return a; };
const show = (label) => {
  console.log(`--- ${label}`);
  console.log(psql(`SELECT count(*) AS surge_flags_for_U_SURGE_01, max(status) AS status, max(evidence->>'window_count') AS evidence_window_count, max(cardinality(related_application_ids)) AS related_ids, max(summary) AS summary, bool_and(reviewed_by_officer_id IS NOT NULL) AS reviewed, max(review_notes) AS review_notes, max(to_char(reviewed_at,'HH24:MI:SS.MS')) AS reviewed_at, max(to_char(updated_at,'HH24:MI:SS.MS')) AS updated_at FROM fraud_flags WHERE flag_type='INSTITUTION_SURGE' AND institution_code='U-SURGE-01';`, ['-x', '-P', 'pager=off']));
  console.log(`  U-SURGE-01 applications submitted in the last 7 days: ${psql(`SELECT count(*) FROM applications WHERE institution_code='U-SURGE-01' AND submitted_at >= now() - interval '7 days';`)}`);
};
const step = process.argv[2];
if (step === 'before') show('BEFORE (flag raised in Phase 11 at the 5th arrival; never updated)');
if (step === 'one') { const a = await add(); console.log(`added ${a.application_no} (U-SURGE-01)`); show('AFTER one more arrival'); }
if (step === 'disposition') {
  const id = psql(`SELECT id FROM fraud_flags WHERE flag_type='INSTITUTION_SURGE' AND institution_code='U-SURGE-01';`);
  const r = await call('POST', `/fraud-flags/${id}/disposition`, { status: 'NEEDS_MORE_INFO', notes: 'Asked the institute for its admission register for this week.' }, await login('ino.ranchi.p11@example.org'), { raw: true });
  console.log(`ino.ranchi dispositions the surge flag NEEDS_MORE_INFO: HTTP ${r.status} status=${r.body.status}`);
  show('AFTER disposition');
}
if (step === 'two') { for (let i = 0; i < 2; i++) { const a = await add(); console.log(`added ${a.application_no} (U-SURGE-01)`); } show('AFTER two more arrivals (disposition must survive)'); }
if (step === 'audit') {
  console.log(psql(`SELECT a.action, a.actor_role, coalesce(a.actor_user_id::text,'-') AS actor_user, a.row_data->>'status' AS status, a.row_data->'evidence'->>'window_count' AS window_count, to_char(a.created_at,'HH24:MI:SS') AS at FROM audit_logs a JOIN fraud_flags f ON f.id = a.record_id WHERE a.table_name='fraud_flags' AND f.flag_type='INSTITUTION_SURGE' ORDER BY a.created_at;`, ['-P', 'pager=off']));
}
import('./lib.mjs').then(({ save }) => save());
