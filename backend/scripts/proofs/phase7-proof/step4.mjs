import { call, enc, login, save, state, upload, waitProcessed } from './p7.mjs';
const t = await login(state.A.email);
const slot = 'Family Income Certificate';
const r = await upload(t, state.A.applicationId, slot, `low_confidence_field;low=certificate_number;type=${enc(slot)};holder_name=Kavya%20Oraon;family_income_annual=180000;certificate_number=JH-INC-2026-0O42`);
console.log(`upload: HTTP ${r.status} status=${r.body.status} document_id=${r.body.document_id}`);
const d = await waitProcessed(t, r.body.document_id);
console.log(`after processing (MOCK ML): state=${d.state}, review_threshold=${d.extraction.review_threshold}`);
for (const f of d.extraction.fields) console.log(`  field ${f.name.padEnd(21)} value=${JSON.stringify(f.value).padEnd(20)} confidence=${f.confidence} review=${f.review}`);
state.lowDoc = r.body.document_id; save();

console.log('\n--- INO officer: GET /applications/:id/documents (jurisdiction-scoped)');
const ino = await login('ino.ranchi7@example.org');
const list = await call('GET', `/applications/${state.A.applicationId}/documents`, undefined, ino);
console.log(`ml_mode=${list.ml_mode} | mock_notice present=${!!list.mock_notice} | flags=${JSON.stringify(list.flags)}`);
for (const doc of list.documents) console.log(`  ${doc.document_type.padEnd(58)} state=${doc.state.padEnd(16)} ${doc.extraction ? 'needs-review fields: ' + JSON.stringify(doc.extraction.fields.filter(f => f.review === 'NEEDS_REVIEW').map(f => ({ name: f.name, value: f.value, confidence: f.confidence }))) : 'issues: ' + JSON.stringify(doc.quality.issues.map(i => i.split(':')[0]))}`);

console.log('\n--- INO officer: POST /documents/:id/confirm with a correction');
const c = await call('POST', `/documents/${state.lowDoc}/confirm`, { corrections: { certificate_number: 'JH-INC-2026-0042' }, remarks: 'Certificate number read against the original: 0042, not 0O42.' }, ino, { raw: true });
console.log(`HTTP ${c.status} state=${c.body.state} verification_status=${c.body.verification_status} confirmed_by=${c.body.extraction.confirmed_by_officer_id} at=${c.body.extraction.confirmed_at}`);
for (const f of c.body.extraction.fields) console.log(`  field ${f.name.padEnd(21)} value=${JSON.stringify(f.value).padEnd(20)} review=${f.review} corrected=${f.corrected}`);
console.log('\n--- confirming again (no longer needs review):');
const again = await call('POST', `/documents/${state.lowDoc}/confirm`, {}, ino, { raw: true });
console.log(`HTTP ${again.status} ${JSON.stringify(again.body)}`);
