import { call, enc, login, save, state, upload, waitProcessed, PW, VERSIONS as V, LEVELS as LVL } from './p8lib.mjs';
// Consistency de-duplication proof (MOCK ML fixtures; consistency is computed from holder names).
const phase = process.argv[2];
if (!state.R) {
  await call('POST', '/auth/register', { email: 'rekha.p8@example.org', password: PW, first_name: 'Rekha', last_name: 'Minz', category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: 'JH-ST-2026-R8801', annual_income: '150000.00', bank_account: 'SBIN0001234:3008801R', dob: '2006-07-07' });
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login('rekha.p8@example.org'));
  state.R = { email: 'rekha.p8@example.org', applicationId: app.id, application_no: app.application_no }; save();
  console.log(`R Rekha Minz -> ${app.application_no}: gate ${app.eligibility_gate.outcome} -> ${app.current_stage}`);
}
const t = await login(state.R.email);
const put = async (slot, name) => {
  const r = await upload(t, state.R.applicationId, slot, `clean;type=${enc(slot)};holder_name=${enc(name)}`);
  return (await waitProcessed(t, r.body.document_id)).state;
};
const flags = async () => (await call('GET', `/applications/${state.R.applicationId}/documents`, undefined, t)).flags;
const settle = async (before) => {
  for (let i = 0; i < 20; i++) { const f = await flags(); if (f.document_consistency_checked_at !== before) return f; await new Promise((r) => setTimeout(r, 750)); }
  return flags();
};
const before = (await flags()).document_consistency_checked_at;
if (phase === 'first') {
  const list = await call('GET', `/applications/${state.R.applicationId}/documents`, undefined, t);
  for (const slot of list.checklist) await put(slot, slot === 'marksheet' ? 'Sunita Munda' : 'Rekha Minz');
  console.log(`uploaded all ${list.checklist.length} slots (marksheet names "Sunita Munda")`);
} else if (phase === 'again') {
  console.log(`re-upload marksheet naming "Anita Ekka" (still mismatched): ${await put('marksheet', 'Anita Ekka')}`);
} else if (phase === 'fixed') {
  console.log(`re-upload marksheet naming "Rekha Minz" (matches): ${await put('marksheet', 'Rekha Minz')}`);
}
const f = await settle(before);
console.log(`consistency now (MOCK): ${f.document_consistency_status}  checked_at=${f.document_consistency_checked_at}`);
