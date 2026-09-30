// Runs the four Phase 7 proof scenarios through the real HTTP upload flow.
//   node run.mjs mock   -> applicant M, MOCK fixture PNGs (documented marker)
//   node run.mjs real   -> applicant R, real rendered scans (no marker), ML_MODE=real
import { call, enc, login, save, state, upload, uploadFile, waitProcessed } from './lib.mjs';

const mode = process.argv[2];
const only = process.argv[3]; // optional: run a single scenario (1-4)
if (!['mock', 'real'].includes(mode)) throw new Error('usage: node run.mjs mock|real [scenario]');
const key = process.env.KEY ?? (mode === 'mock' ? 'M' : 'R');
const holder = mode === 'mock' ? 'Kavya Oraon' : 'Anita Lakra';
const IMG = 'D:/PROJECTS/SIH_FELLOWSHIP/.mlreal-proof/img/';
const t = await login(state[key].email);
const appId = state[key].applicationId;
const ENGINE = mode === 'mock' ? 'MOCK ML' : 'REAL ML';

const send = (slot, mock, file) =>
  mode === 'mock' ? upload(t, appId, slot, mock) : uploadFile(t, appId, slot, IMG + file);

function show(d, ms) {
  const e = d.extraction;
  console.log(`  processed in ${ms} ms -> state=${d.state}  quality=${JSON.stringify(d.quality)}`);
  if (!e) return;
  console.log(`  engine=${e.engine} status=${e.status}${e.error_code ? ' error_code=' + e.error_code : ''} review_threshold=${e.review_threshold}`);
  console.log(`  classification=${JSON.stringify({ type: e.classification.type, confidence: e.classification.confidence, matches_slot: e.classification.matches_slot })}`);
  for (const f of e.fields)
    console.log(`    field ${f.name.padEnd(22)} value=${JSON.stringify(f.value).slice(0, 44).padEnd(44)} conf=${String(f.confidence).padEnd(5)} review=${String(f.review).padEnd(13)} sensitive=${f.sensitive}`);
  if (e.eligibility_mismatches) console.log(`  eligibility_mismatches=${JSON.stringify(e.eligibility_mismatches)}`);
}

async function scenario(n, title, slot, mock, file) {
  console.log(`\n=== [${ENGINE}] ${n}. ${title} - slot "${slot}"`);
  const t0 = Date.now();
  const r = await send(slot, mock, file);
  console.log(`  upload: HTTP ${r.status} in ${Date.now() - t0} ms  body=${JSON.stringify(r.body)}`);
  if (r.status !== 202) return null;
  const t1 = Date.now();
  const d = await waitProcessed(t, r.body.document_id);
  show(d, Date.now() - t1);
  return d;
}

const INCOME = 'Family Income Certificate';
const ST = 'ST certificate issued by competent authority of State/UT';

if (!only || only === '1')
  await scenario(1, 'quality-fail', INCOME, `quality_fail;type=${enc(INCOME)}`, 'quality_fail.png');
if (!only || only === '2')
  await scenario(2, 'clean', ST, `clean;type=${enc(ST)};holder_name=${enc(holder)};caste_cert_number=JH-ST-2026-M7731`, 'clean_caste.png');
if (!only || only === '3')
  await scenario(3, 'low-confidence', INCOME,
    `low_confidence_field;low=certificate_number;type=${enc(INCOME)};holder_name=${enc(holder)};family_income_annual=180000;certificate_number=JH-INC-2026-0O42`,
    'low_income.png');

if (!only || only === '4') {
  // Real scans for the remaining checklist slots; 'marksheet' carries another person's name.
  const FILES = {
    'Aadhar Number': 'aadhaar.png',
    'Domicile certificate': 'domicile.png',
    'Scanned copy of certificates, diploma, degree etc. in respect of all examinations passed': 'certificates.png',
    'Last qualified marks [percentage/Equivalent percentage in case of CGPA/OGPA etc.]': 'marksheet.png',
    'Disability certificate (if applicable)': 'disability.png',
    'Scanned copy of the passport size photograph': 'photo.png',
    income_certificate: 'income_full.png',
    caste_certificate: 'clean_caste.png',
    marksheet: 'marksheet_other_person.png',
    bonafide_certificate: 'bonafide.png',
    institution_verification: 'institution.png',
  };
  console.log(`\n=== [${ENGINE}] 4. consistency-fail - every remaining slot; slot "marksheet" names Sunita Munda`);
  const list = await call('GET', `/applications/${appId}/documents`, undefined, t);
  const done = new Set(list.slots.filter((s) => ['AUTO_ACCEPTED', 'NEEDS_REVIEW', 'OFFICER_CONFIRMED'].includes(s.state)).map((s) => s.slot));
  console.log(`  checklist (${list.checklist.length} slots, Phase 3 derivation); already processed: ${done.size}`);
  for (const slot of list.checklist) {
    if (done.has(slot)) continue;
    const name = slot === 'marksheet' ? 'Sunita Munda' : holder;
    if (mode === 'real' && !FILES[slot]) throw new Error(`no real scan for slot ${slot}`);
    const t0 = Date.now();
    const r = await send(slot, `clean;type=${enc(slot)};holder_name=${enc(name)}`, FILES[slot]);
    const d = r.status === 202 ? await waitProcessed(t, r.body.document_id) : null;
    const e = d?.extraction;
    const nameField = e?.fields.find((f) => /name$/.test(f.name));
    console.log(`  ${r.status} ${slot.slice(0, 44).padEnd(44)} ${String(Date.now() - t0).padStart(5)}ms -> ${String(d?.state ?? JSON.stringify(r.body)).padEnd(13)} ` +
      (e ? `class=${e.classification.type}@${e.classification.confidence} match=${e.classification.matches_slot} ${nameField ? nameField.name + '=' + JSON.stringify(nameField.value) + '@' + nameField.confidence : '(no name field)'}` : `quality=${JSON.stringify(d?.quality)}`));
  }
  for (let i = 0; i < 30; i++) {
    const l = await call('GET', `/applications/${appId}/documents`, undefined, t);
    if (l.flags.document_consistency_status) { console.log(`\n  flags after the last upload (${ENGINE} consistency): ${JSON.stringify(l.flags)}`); break; }
    if (i === 29) console.log(`\n  no consistency flag recorded; slots: ${JSON.stringify(l.slots.map((s) => [s.slot.slice(0, 20), s.state]))}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
save();
