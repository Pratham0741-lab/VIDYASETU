import { enc, login, save, state, upload, waitProcessed } from './p7.mjs';
const t = await login(state.A.email);
const slot = 'ST certificate issued by competent authority of State/UT';
const r = await upload(t, state.A.applicationId, slot, `clean;type=${enc(slot)};holder_name=Kavya%20Oraon;caste_cert_number=JH-ST-2026-A7731`);
console.log(`upload: HTTP ${r.status} status=${r.body.status} document_id=${r.body.document_id} poll=${r.body.poll}`);
const d = await waitProcessed(t, r.body.document_id);
console.log(`after processing (MOCK ML): state=${d.state} engine=${d.extraction.engine} classification=${JSON.stringify(d.extraction.classification)}`);
for (const f of d.extraction.fields) console.log(`  field ${f.name.padEnd(18)} value=${JSON.stringify(f.value).padEnd(22)} confidence=${f.confidence} review=${f.review} sensitive=${f.sensitive}`);
state.cleanDoc = r.body.document_id; save();
