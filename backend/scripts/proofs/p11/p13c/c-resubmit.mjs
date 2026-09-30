// Phase 13C proofs 3 and 4: resubmission re-runs only the checks the changed documents feed.
import { writeFileSync } from 'node:fs';
import { call, login, state, upload, waitProcessed } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { marker } from './c-setup.mjs';

const saveR = (n, r) => writeFileSync(`responses/p13c/${n}.json`, JSON.stringify(r, null, 1));
const stage = (P) => psql(`SELECT current_stage FROM applications WHERE id='${P.applicationId}';`);
const items = (P) => psql(`SELECT string_agg(check_code||'/'||status||'/'||problem_code||coalesce(' (was '||previous_problem_code||')',''), '; ' ORDER BY created_at) FROM deficiency_items WHERE deficiency_id='${P.deficiencyId}';`);
function report(label, r) {
  const b = r.body;
  console.log(`${label}: HTTP ${r.status}${b.code ? ' ' + b.code + ' ' + JSON.stringify(b.details) : ''}`);
  if (!b.checks_run) return;
  console.log(`   changed_slots: ${JSON.stringify(b.changed_slots)}`);
  console.log(`   checks RUN (${b.checks_run.length}):`);
  for (const c of b.checks_run) console.log(`     + ${c.check}${c.rules ? '[' + c.rules.join(',') + ']' : ''} slot="${c.slot ?? '(all)'}" -> ${c.outcome}${c.problem_code ? ' ' + c.problem_code : ''}${c.note ? ' (' + c.note + ')' : ''}`);
  const byReason = {};
  for (const s of b.checks_skipped) (byReason[s.reason] ??= []).push(`${s.check}@${s.slot === null ? '(all)' : s.slot.slice(0, 28)}`);
  console.log(`   checks SKIPPED (${b.checks_skipped.length}):`);
  for (const [k, v] of Object.entries(byReason)) console.log(`     - ${k} (${v.length}): ${v.slice(0, 6).join(', ')}${v.length > 6 ? ', ...' : ''}`);
  console.log(`   items: ${b.items.map((i) => `${i.status} ${i.problem_code}${i.previous_problem_code ? ' (was ' + i.previous_problem_code + ')' : ''}`).join('; ')}`);
  console.log(`   resubmitted=${b.resubmitted} transition=${JSON.stringify(b.transition)}`);
}
const INCOME = 'Family Income Certificate';

console.log('=== proof 3: H1 replaces the one document named in its open item');
const H1 = state.P.H1;
const th = await login(H1.email);
let r = await upload(th, H1.applicationId, 'Domicile certificate', marker('Phulmani', 'Kisku'));
console.log(`upload a document NOT named in an open item (Domicile certificate): HTTP ${r.status} ${r.body.code} ${JSON.stringify(r.body.details)}`);
r = await call('POST', `/applications/${H1.applicationId}/deficiencies/${H1.deficiencyId}/resubmit`, undefined, th, { raw: true });
saveR('c3-H1-resubmit-before-upload', r);
report('resubmit BEFORE uploading anything', r);
console.log(`   stage=${stage(H1)}`);
r = await upload(th, H1.applicationId, INCOME, marker('Phulmani', 'Kisku', ';issue_date=2026-05-01;family_income_annual=180000'));
console.log(`upload a current income certificate (issued 2026-05-01): HTTP ${r.status} ${r.body.status}; item now: ${items(H1)}`);
await waitProcessed(th, r.body.document_id);
await new Promise((res) => setTimeout(res, 3000)); // consistency re-evaluation is async too
r = await call('POST', `/applications/${H1.applicationId}/deficiencies/${H1.deficiencyId}/resubmit`, undefined, th, { raw: true });
saveR('c3-H1-resubmit', r);
report('resubmit', r);
console.log(`   stage=${stage(H1)}; items in DB: ${items(H1)}; deficiency status: ${psql(`SELECT status||' resolved_at set: '||(resolved_at IS NOT NULL) FROM deficiencies WHERE id='${H1.deficiencyId}';`)}`);
console.log(`   workflow transitions for H1: ${psql(`SELECT string_agg(from_stage||'->'||to_stage||' ('||trigger_action||')', ', ' ORDER BY created_at) FROM workflow_transitions WHERE application_id='${H1.applicationId}';`)}`);

console.log('\n=== proof 4: E1 resubmits invalid documents - the item stays OPEN');
const E1 = state.P.E1;
const te = await login(E1.email);
r = await upload(te, E1.applicationId, INCOME, 'quality_fail');
console.log(`upload an unreadable scan: HTTP ${r.status} ${r.body.status}`);
r = await call('POST', `/applications/${E1.applicationId}/deficiencies/${E1.deficiencyId}/resubmit`, undefined, te, { raw: true });
saveR('c4-E1-resubmit-unreadable', r);
report('resubmit', r);
console.log(`   stage=${stage(E1)}`);
r = await upload(te, E1.applicationId, INCOME, marker('Rohit', 'Lakra', ';issue_date=2023-01-15;family_income_annual=180000'));
await waitProcessed(te, r.body.document_id);
console.log(`upload another expired certificate (issued 2023-01-15): HTTP ${r.status} ${r.body.status}`);
r = await call('POST', `/applications/${E1.applicationId}/deficiencies/${E1.deficiencyId}/resubmit`, undefined, te, { raw: true });
saveR('c4-E1-resubmit-expired', r);
report('resubmit', r);
console.log(`   stage=${stage(E1)}; items in DB: ${items(E1)}`);

console.log('\n=== S1: an officer-added (manual) item and an automatic one');
const S1 = state.P.S1;
const ts = await login(S1.email);
const caste = S1.checklist.find((s) => /^ST certificate/.test(s));
r = await upload(ts, S1.applicationId, INCOME, marker('Sumitra', 'Murmu', ';issue_date=2026-06-10;family_income_annual=180000'));
await waitProcessed(ts, r.body.document_id);
r = await upload(ts, S1.applicationId, caste, marker('Sumitra', 'Murmu'));
await waitProcessed(ts, r.body.document_id);
await new Promise((res) => setTimeout(res, 3000));
r = await call('POST', `/applications/${S1.applicationId}/deficiencies/${S1.deficiencyId}/resubmit`, undefined, ts, { raw: true });
saveR('c3-S1-resubmit', r);
report('resubmit', r);
console.log(`   stage=${stage(S1)}; items in DB: ${items(S1)}`);
