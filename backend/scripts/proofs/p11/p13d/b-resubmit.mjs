// Phase 13D proof 3 (ML_MODE=real): the original resubmit route with open deficiency items
// behaves exactly like the itemised path; with no open items it behaves as before.
import { writeFileSync } from 'node:fs';
import { call, login, save, state, waitProcessed } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { realApplicant, uploadFile } from './a-crop.mjs';

const SLOT = 'Family Income Certificate';
const ino = await login('ino.ranchi.p11@example.org');
const norm = (b) => ({
  status_code: b.__status,
  resubmitted: b.resubmitted,
  transition: b.transition,
  changed_slots: b.changed_slots,
  checks_run: (b.checks_run ?? []).map((c) => `${c.check}${c.rules ? '[' + c.rules + ']' : ''}:${c.outcome}${c.problem_code ? ':' + c.problem_code : ''}`),
  checks_skipped: (b.checks_skipped ?? []).length,
  items: (b.items ?? []).map((i) => `${i.status}:${i.problem_code}${i.previous_problem_code ? '<-' + i.previous_problem_code : ''}`),
});
const stage = (P) => psql(`SELECT current_stage FROM applications WHERE id='${P.applicationId}';`);
const crop = (P) => psql(`SELECT coalesce((crop_ref->>'document_id')::text,'null') FROM deficiency_items WHERE deficiency_id='${P.deficiencyId}';`);

const pair = [];
for (const [key, first, last, file] of [['RS1', 'Mangal', 'Oraon', 'expired'], ['RS2', 'Sunil', 'Bara', 'expired2']]) {
  const P = await realApplicant(key, first, last);
  const t = await login(P.email);
  const r = await uploadFile(t, P.applicationId, SLOT, `p13d/${file}.png`);
  await waitProcessed(t, r.body.document_id);
  const i = await call('POST', `/applications/${P.applicationId}/deficiencies`, { reason: 'Income certificate is past the 12-month validity.', include_failed_checks: false, items: [{ document_slot: SLOT, check_code: 'DOCUMENT_VALIDITY' }] }, ino, { raw: true });
  P.deficiencyId = i.body.deficiency_id; save();
  pair.push([key, P, t, file]);
  console.log(`${key} ${P.application_no}: issue HTTP ${i.status} stage=${i.body.current_stage} crop_ref document=${crop(P).slice(0, 8)}`);
}
const [[, A, ta, fileA], [, B, tb, fileB]] = pair;
const oldRoute = async () => { const r = await call('POST', `/applications/${A.applicationId}/resubmit`, {}, ta, { raw: true }); return { ...r.body, __status: r.status }; };
const newRoute = async () => { const r = await call('POST', `/applications/${B.applicationId}/deficiencies/${B.deficiencyId}/resubmit`, undefined, tb, { raw: true }); return { ...r.body, __status: r.status }; };
async function step(label) {
  const a = norm(await oldRoute());
  const b = norm(await newRoute());
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log(`\n--- ${label}\n  RS1 via POST /applications/:id/resubmit          : ${JSON.stringify(a)}\n  RS2 via POST .../deficiencies/:defId/resubmit      : ${JSON.stringify(b)}\n  identical: ${same}; stages RS1=${stage(A)} RS2=${stage(B)}`);
  writeFileSync(`responses/p13d/b-${label.replace(/\W+/g, '-')}.json`, JSON.stringify({ old: a, new: b }, null, 1));
}
await step('1 resubmit before uploading anything');
for (const [P, t, f] of [[A, ta, fileA], [B, tb, fileB]]) { const r = await uploadFile(t, P.applicationId, SLOT, `p13d/${f}.png`); await waitProcessed(t, r.body.document_id); }
await new Promise((r) => setTimeout(r, 3000));
await step('2 after uploading ANOTHER expired certificate');
console.log(`  crop_ref now points at the new document: RS1 ${crop(A).slice(0, 8)}, RS2 ${crop(B).slice(0, 8)}`);
for (const [P, t, f] of [[A, ta, 'valid'], [B, tb, 'valid2']]) { const r = await uploadFile(t, P.applicationId, SLOT, `p13d/${f}.png`); await waitProcessed(t, r.body.document_id); }
await new Promise((r) => setTimeout(r, 3000));
await step('3 after uploading a current certificate');

console.log('\n--- no open items: an application marked defective the plain (Phase 4) way');
const C = await realApplicant('RS3', 'Budhu', 'Minz');
let r = await call('POST', `/applications/${C.applicationId}/mark-defective`, { remarks: 'Photograph page missing from the upload.', code: 'DEF_PHOTO_MISSING', title: 'Photograph missing', description: 'Upload a recent photograph.' }, ino, { raw: true });
console.log(`  mark-defective: HTTP ${r.status} -> ${r.body.application?.current_stage}; itemised deficiencies: ${psql(`SELECT count(*) FROM deficiencies WHERE application_id='${C.applicationId}' AND code='DEF_ITEMISED';`)}`);
r = await call('POST', `/applications/${C.applicationId}/resubmit`, {}, await login(C.email), { raw: true });
console.log(`  old resubmit route: HTTP ${r.status} response keys=[${Object.keys(r.body).join(', ')}] transition=${r.body.transition?.from_stage}->${r.body.transition?.to_stage} (${r.body.transition?.trigger_action}); stage now ${stage(C)}`);
