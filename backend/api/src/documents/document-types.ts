/**
 * Checklist slot -> the ml service's canonical document type.
 *
 * Checklist slots are the free text of each scheme version's
 * required_documents and doc_refs (Phase 3's derivation). The ml service
 * classifies into, and extracts by, a fixed set of canonical types - the
 * same list as documents.document_type in the Prisma schema. The api must
 * therefore (a) send a canonical type as `document_type`, never slot text
 * (the ml service rejects unknown types), and (b) compare the classifier's
 * canonical output with the slot's canonical type, not with slot text.
 * (Phase 7 compared raw slot text; only the mock, which echoed the slot,
 * made that pass.)
 *
 * Explicit table over every slot in the seeded active versions
 * (document-types.spec.ts fails if a seeded slot is missing). null = no
 * canonical type covers the slot unambiguously: extraction runs without a
 * document_type (the ml service auto-classifies) and classification cannot
 * confirm the slot, so the document is routed to review.
 */
export const CANONICAL_DOCUMENT_TYPES = [
  'CASTE_CERTIFICATE',
  'INCOME_CERTIFICATE',
  'MARKSHEET',
  'FEE_RECEIPT',
  'BANK_PASSBOOK',
  'BONAFIDE',
  'DISABILITY_CERT',
  'OFFER_LETTER',
] as const;
export type CanonicalDocumentType = (typeof CANONICAL_DOCUMENT_TYPES)[number];

export const SLOT_DOCUMENT_TYPE: Readonly<Record<string, CanonicalDocumentType | null>> = {
  // Income
  'Family Income Certificate': 'INCOME_CERTIFICATE',
  'Income Certificate for preceding FY (or Form-16 for salaried)': 'INCOME_CERTIFICATE',
  'Income Certificate for preceding financial year': 'INCOME_CERTIFICATE',
  income_certificate: 'INCOME_CERTIFICATE',
  // Caste / tribe
  'ST Certificate / PVTG Certificate': 'CASTE_CERTIFICATE',
  'ST certificate issued by competent authority': 'CASTE_CERTIFICATE',
  'ST certificate issued by competent authority of State': 'CASTE_CERTIFICATE',
  'ST certificate issued by competent authority of State/UT': 'CASTE_CERTIFICATE',
  'ST/PVTG certificate issued by competent authority': 'CASTE_CERTIFICATE',
  'PVTG certificate issued by competent authority (if applicable)': 'CASTE_CERTIFICATE',
  caste_certificate: 'CASTE_CERTIFICATE',
  // Marks
  'Graduation / Post-Graduation mark sheet with conversion formula': 'MARKSHEET',
  'Last qualified marks [percentage/Equivalent percentage in case of CGPA/OGPA etc.]': 'MARKSHEET',
  'Marksheet/Certificate of qualifying examination (12th for UG, Graduation for PG)': 'MARKSHEET',
  "Master's degree or 4-year Bachelor's degree with Research marksheet": 'MARKSHEET',
  '10th / Matriculation certificate in support of date of birth': 'MARKSHEET',
  '10th Certificate/Marksheet in support of Date of Birth': 'MARKSHEET',
  marksheet: 'MARKSHEET',
  // Institute
  'Bona fide Certificate issued from the Institute': 'BONAFIDE',
  bonafide_certificate: 'BONAFIDE',
  'Fee Receipt': 'FEE_RECEIPT',
  'Offer of admission in top 1,000 QS ranked foreign university': 'OFFER_LETTER',
  admission_offer_letter: 'OFFER_LETTER',
  // Bank / disability
  'Scanned copy of the bank passbook': 'BANK_PASSBOOK',
  'Disability certificate (if applicable)': 'DISABILITY_CERT',
  'Divyangjan certificate (if applicable)': 'DISABILITY_CERT',
  // No unambiguous canonical type.
  'Aadhaar Number / Card': null,
  'Aadhar Number': null,
  'Domicile certificate': null,
  'Scanned copy of certificates, diploma, degree etc. in respect of all examinations passed': null,
  'Scanned copy of the passport size photograph': null,
  'Self-certification for only one child in family and one-time assistance': null,
  'Ph.D Admission/Joining certificate from recognized University/Institute': null,
  'UGC-NET (JRF) or Joint CSIR-UGC NET qualifying scorecard': null,
  ugc_net_scorecard: null,
  dob_certificate: null,
  i20_or_cas_statement: null,
  institution_verification: null,
  research_progress_report: null,
};

/** The canonical type for a slot, or null (unmapped or unknown slot). */
export function canonicalTypeForSlot(slot: string): CanonicalDocumentType | null {
  return Object.prototype.hasOwnProperty.call(SLOT_DOCUMENT_TYPE, slot)
    ? SLOT_DOCUMENT_TYPE[slot]
    : null;
}
