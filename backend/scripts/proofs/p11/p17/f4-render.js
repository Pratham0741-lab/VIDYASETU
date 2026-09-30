// Phase 17 F4: renders the analytics PDF / XLSX / CSV and a sanction-order PDF from the compiled
// app with the clock pinned (PDF and XLSX embed a creation time), for ASCII-only content and for
// Devanagari content. Run in the api container: before the font change (old image) and after
// (new image); the ASCII artefacts must be byte-identical. Prints sha256 per artefact and, with
// OUT set, writes the files (base64 on stdout, the container is read-only).
const FIXED = Date.parse('2026-10-01T00:00:00.000Z');
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [FIXED]));
  }
  static now() {
    return FIXED;
  }
}
global.Date = FixedDate;
const { createHash } = require('node:crypto');
const { toPdf } = require('/app/dist/analytics/pdf-report');
const { toXlsx } = require('/app/dist/analytics/xlsx');
const { toCsv } = require('/app/dist/analytics/csv');
const { renderSanctionOrderPdf } = require('/app/dist/post-selection/sanction-order.pdf');

const cols = ['scheme', 'district', 'submitted', 'verified', 'note'];
const ascii = [
  { scheme: 'NFST', district: 'Ranchi', submitted: 12, verified: 9, note: 'ok' },
  { scheme: 'NOS', district: 'Dumka', submitted: '<5', verified: 'suppressed', note: 'small cell' },
];
const hindi = [
  { scheme: 'NFST', district: 'राँची', submitted: 12, verified: 9, note: 'सत्यापित' },
  { scheme: 'NOS', district: 'दुमका', submitted: '<5', verified: 'suppressed', note: 'क्षेत्र' },
];
const meta = (title) => ({ title, footer: ['Window 2026-04-01..2027-04-01', 'Scope Jharkhand'], notes: ['Counts only.'] });
const order = (name, scheme) => ({
  format: 'vidyasetu.sanction-order.v1', sanction_order_id: '00000000-0000-4000-8000-0000000000f4', sanction_date: '2026-10-01',
  selection_id: '00000000-0000-4000-8000-0000000000f5', selection_run_id: '00000000-0000-4000-8000-0000000000f6',
  application_id: '00000000-0000-4000-8000-0000000000f7', application_no: 'VS-2026-27-F4F4F4F4F4', applicant_name: name,
  scheme_code: 'NFST', scheme_name: scheme, scheme_version_id: '00000000-0000-4000-8000-0000000000f8', scheme_version_no: 5,
  academic_year: '2026-27', vertical_category: 'ST', horizontal_reservation: null, merit_rank: 3, selection_basis: 'MERIT',
  annual_entitlement: [{ currency: 'INR', beneficiary_type: 'STUDENT', payment_mode: 'DBT', amount: 120000, lines: [{ benefit_id: 'fellowship', amount_annual: 120000, currency: 'INR' }] }],
  unschedulable_benefits: [], not_applicable_benefits: [], issued_by_officer_id: '00000000-0000-4000-8000-0000000000f9',
});
const sha = (b) => createHash('sha256').update(b).digest('hex');

(async () => {
  const out = {};
  out['analytics-ascii.pdf'] = await toPdf(meta('Funnel'), cols, ascii);
  out['analytics-ascii.xlsx'] = toXlsx([{ name: 'Funnel', columns: cols, rows: ascii }]);
  out['analytics-ascii.csv'] = Buffer.from(toCsv(cols, ascii), 'utf8');
  out['sanction-ascii.pdf'] = await renderSanctionOrderPdf(order('Rinky Toppo', 'National Fellowship for ST Students'), 'a'.repeat(64), { seq: '42', record_hash: 'b'.repeat(64) });
  out['analytics-hindi.pdf'] = await toPdf(meta('फ़नल / Funnel'), cols, hindi);
  out['sanction-hindi.pdf'] = await renderSanctionOrderPdf(order('रिंकी टोप्पो', 'अनुसूचित जनजाति छात्रों के लिए राष्ट्रीय फ़ेलोशिप'), 'a'.repeat(64), { seq: '42', record_hash: 'b'.repeat(64) });
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k.padEnd(22)} ${String(v.length).padStart(7)} bytes sha256 ${sha(v)}`);
    if (process.env.OUT) console.log(`B64 ${k} ${v.toString('base64')}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
