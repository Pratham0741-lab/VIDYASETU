import { readFileSync } from 'node:fs';
import { routeByConfidence } from '../vidyasetu/api/src/documents/review-routing';
import { canonicalTypeForSlot } from '../vidyasetu/api/src/documents/document-types';
// A checklist slot for each canonical type (seeded slot text); generic docs go to unmapped slots.
const SLOT: Record<string, string> = {
  CASTE_CERTIFICATE: 'caste_certificate', INCOME_CERTIFICATE: 'income_certificate', MARKSHEET: 'marksheet',
  FEE_RECEIPT: 'Fee Receipt', BANK_PASSBOOK: 'Scanned copy of the bank passbook', BONAFIDE: 'bonafide_certificate',
  DISABILITY_CERT: 'Disability certificate (if applicable)', OFFER_LETTER: 'admission_offer_letter',
};
const GENERIC_SLOT = ['Aadhar Number', 'Domicile certificate', 'Scanned copy of the passport size photograph',
  'institution_verification', 'Scanned copy of certificates, diploma, degree etc. in respect of all examinations passed', 'Aadhaar Number / Card'];
const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let g = 0; const tally: Record<string, number> = {};
for (const r of rows) {
  const slot = r.type ? SLOT[r.type] : GENERIC_SLOT[g++];
  if (!r.quality.usable) { tally.QUALITY_REJECTED = (tally.QUALITY_REJECTED ?? 0) + 1; console.log(`${r.id.padEnd(17)} QUALITY_REJECTED (${r.quality.issues})`); continue; }
  const routing = routeByConfidence(r.extract.confidence, 0.85,
    { type: r.classify.value, confidence: r.classify.confidence }, canonicalTypeForSlot(slot));
  tally[routing.review_status] = (tally[routing.review_status] ?? 0) + 1;
  const low = Object.entries(r.extract.confidence as Record<string, number>).filter(([, c]) => c < 0.85).map(([k, c]) => `${k}=${JSON.stringify(r.extract.value[k])}@${c}`);
  console.log(`${r.id.padEnd(17)} ${routing.review_status.padEnd(13)} ${routing.reasons.join('; ')}${low.length ? ' | fields<0.85: ' + low.join(', ') : ''}`);
}
console.log('\nTOTAL', rows.length, JSON.stringify(tally));
