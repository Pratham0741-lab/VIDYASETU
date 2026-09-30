// Full api pipeline: real upload by an applicant whose declared income matches the forgery.
import { call, login, save, state, uploadFile, waitProcessed, PW } from '../.mlreal-proof/lib.mjs';
const tag = process.argv[2];                         // e.g. BEFORE / AFTER
const V = JSON.parse(process.env.VERSIONS);
const key = `ATK_${tag}`;
if (!state[key]) {
  const email = `rakesh.${tag.toLowerCase()}.mlsec@example.org`;
  await call('POST', '/auth/register', { email, password: PW, first_name: 'Rakesh', last_name: 'Toppo', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-${tag}01`, annual_income: '50000.00', bank_account: 'SBIN0001234:3009900' + tag.length, gender: 'MALE', dob: '2006-01-15' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: process.env.POST_LEVEL } }, await login(email));
  state[key] = { email, applicationId: app.id }; save();
  console.log(`attacker applicant (declared income Rs 50,000): application ${app.id} -> ${app.current_stage}`);
}
const t = await login(state[key].email);
for (const f of ['attack_blank_description.png', 'attack_ruled_ocr_text.png']) {
  const r = await uploadFile(t, state[key].applicationId, 'Family Income Certificate', 'D:/PROJECTS/SIH_FELLOWSHIP/.mlsec/img/' + f);
  console.log(`\n[${tag}] upload ${f}: HTTP ${r.status} status=${r.body.status} ml_mode=${r.body.ml_mode} quality=${JSON.stringify(r.body.quality)}`);
  if (r.status !== 202) continue;
  const d = await waitProcessed(t, r.body.document_id);
  const e = d.extraction;
  console.log(`  -> state=${d.state} classification=${JSON.stringify({ type: e?.classification.type, confidence: e?.classification.confidence, matches_slot: e?.classification.matches_slot })}`);
  for (const x of e?.fields ?? []) console.log(`     ${x.name.padEnd(22)} value=${JSON.stringify(x.value).padEnd(24)} confidence=${x.confidence} review=${x.review}`);
  console.log(`  eligibility_mismatches=${JSON.stringify(e?.eligibility_mismatches)}`);
}
