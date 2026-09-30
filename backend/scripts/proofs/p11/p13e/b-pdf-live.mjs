// Phase 13E proof 2 (api, ML_MODE=real): a PDF certificate goes through OCR, carries boxes,
// and the crop route serves its region; an encrypted PDF is a clean quality rejection.
import { readFileSync, writeFileSync } from 'node:fs';
import { call, login, save, state, waitProcessed } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { realApplicant } from '../p13d/a-crop.mjs';

const SLOT = 'Family Income Certificate';
const up = async (token, appId, file, type) => {
  const fd = new FormData();
  fd.append('document_type', SLOT);
  fd.append('file', new Blob([readFileSync(file)], { type }), file.split('/').pop());
  return call('POST', `/applications/${appId}/documents`, fd, token, { raw: true });
};
const P = await realApplicant('PD1', 'Karma', 'Oraon');
const t = await login(P.email);
let r = await up(t, P.applicationId, 'p13e/cert.pdf', 'application/pdf');
console.log(`upload cert.pdf (application/pdf): HTTP ${r.status} ${r.body.status}`);
await waitProcessed(t, r.body.document_id);
console.log('document (DB): ' + psql(`SELECT mime_type||' | intake='||intake_status||' | quality pdf='||coalesce((quality_result->'details'->'pdf')::text,'-') FROM documents WHERE id='${r.body.document_id}';`));
console.log('extraction (DB): ' + psql(`SELECT status||' engine='||extraction_engine||' issued_date='||coalesce(extracted_data->>'issued_date','-')||' box='||coalesce((field_boxes->'issued_date')::text,'null') FROM document_extractions WHERE document_id='${r.body.document_id}';`));
console.log(`true region of the date on the rasterised page: ${JSON.stringify(JSON.parse(readFileSync('p13e/pdfs.json', 'utf8')).date_region)}`);

const ino = await login('ino.ranchi.p11@example.org');
r = await call('POST', `/applications/${P.applicationId}/deficiencies`, { reason: 'The PDF income certificate is past the 12-month validity.', include_failed_checks: false, items: [{ document_slot: SLOT, check_code: 'DOCUMENT_VALIDITY' }] }, ino, { raw: true });
const item = r.body.items?.[0];
P.itemId = item?.id; save();
console.log(`issue: HTTP ${r.status} problem=${item?.problem_code} crop_ref=${JSON.stringify(item?.crop_ref)}`);
for (const [label, email] of [['owner', P.email], ['INO Ranchi', 'ino.ranchi.p11@example.org'], ['INO Dumka', 'ino.dumka.p11@example.org']]) {
  const res = await fetch(`http://localhost:3000/api/v1/applications/${P.applicationId}/deficiencies/items/${P.itemId}/crop`, { headers: { Authorization: `Bearer ${await login(email)}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.status === 200) writeFileSync(`responses/p13e/pdf-crop-${label.replace(/\W+/g, '-')}.png`, buf);
  console.log(`  crop as ${label.padEnd(10)} HTTP ${res.status} ${res.headers.get('content-type')} ${res.status === 200 ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)} px` : ''}`);
}

console.log('\nencrypted PDF:');
const Q = await realApplicant('PD2', 'Somra', 'Toppo');
const tq = await login(Q.email);
r = await up(tq, Q.applicationId, 'p13e/encrypted.pdf', 'application/pdf');
console.log(`upload encrypted.pdf: HTTP ${r.status} status=${r.body.status} quality=${JSON.stringify(r.body.quality)}`);
await new Promise((res) => setTimeout(res, 4000));
console.log('retake notice (in-app): ' + psql(`SELECT body FROM notifications WHERE application_id='${Q.applicationId}' AND template_key='document.retake_required' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`).replace(/\n/g, ' / '));
