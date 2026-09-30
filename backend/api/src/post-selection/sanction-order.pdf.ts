import PDFDocument from 'pdfkit';
import { toBuffer as qrToBuffer } from 'qrcode';
import { fontFor } from '../common/pdf/fonts';

/**
 * Renders a sanction order PDF (pdfkit: pure JS, CommonJS, built-in
 * Helvetica - no native build; Phase 17: a value containing Devanagari, e.g.
 * a name written in Hindi, is drawn with the embedded Devanagari font,
 * common/pdf/fonts.ts). The content hash is printed
 * and encoded in a QR code for independent verification. The PDF bytes are
 * NOT the hashed artefact (they embed a creation date); the canonical
 * content is (canonical.ts).
 */
export interface SanctionOrderContent {
  format: string;
  sanction_order_id: string;
  sanction_date: string;
  selection_id: string;
  selection_run_id: string;
  application_id: string;
  application_no: string;
  applicant_name: string;
  scheme_code: string;
  scheme_name: string;
  scheme_version_id: string;
  scheme_version_no: number;
  academic_year: string;
  vertical_category: string;
  horizontal_reservation: string | null;
  merit_rank: number | null;
  selection_basis: string;
  annual_entitlement: Array<{
    currency: string;
    beneficiary_type: string;
    payment_mode: string;
    amount: number;
    lines: Array<{ benefit_id: string; amount_annual: number; currency: string }>;
  }>;
  unschedulable_benefits: Array<{ benefit_id: string; reason: string }>;
  not_applicable_benefits: Array<{ benefit_id: string; condition: string }>;
  issued_by_officer_id: string;
}

/**
 * Phase 14 loose ends (D2): the audit-chain record of the sanction event -
 * the audit_logs row the database wrote when this order was inserted (its
 * seq and record_hash). It exists only after the insert, so it is not part
 * of the hashed content; it is printed next to it and carried in the QR code.
 */
export interface AuditChainRef {
  seq: string;
  record_hash: string;
}

export function qrPayload(orderId: string, hash: string, chain?: AuditChainRef | null): string {
  const base = `VIDYASETU-SANCTION:${orderId}:sha256:${hash}`;
  return chain ? `${base}:audit-seq:${chain.seq}:audit-hash:${chain.record_hash}` : base;
}

export async function renderSanctionOrderPdf(
  c: SanctionOrderContent,
  hash: string,
  chain: AuditChainRef | null = null,
): Promise<Buffer> {
  const qr = await qrToBuffer(qrPayload(c.sanction_order_id, hash, chain), {
    type: 'png',
    margin: 1,
    width: 150,
  });
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: `Sanction order ${c.application_no}`,
      Author: 'VIDYASETU',
      // Machine-readable copy of the printed references (plain PDF metadata).
      Subject: chain
        ? `sha256:${hash}; audit-seq:${chain.seq}; audit-hash:${chain.record_hash}`
        : `sha256:${hash}`,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  doc.font('Helvetica-Bold').fontSize(16).text('SANCTION ORDER', { align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .text('Ministry of Tribal Affairs - VIDYASETU', { align: 'center' });
  doc.moveDown();
  const row = (k: string, v: string) =>
    doc
      .font('Helvetica-Bold')
      .text(`${k}: `, { continued: true })
      .font(fontFor(doc, v, 'Helvetica'))
      .text(v);
  row('Sanction order', c.sanction_order_id);
  row('Sanction date', c.sanction_date);
  row('Applicant', c.applicant_name);
  row('Application', c.application_no);
  row('Scheme', `${c.scheme_name} (${c.scheme_code}), version ${c.scheme_version_no}`);
  row('Academic year', c.academic_year);
  row(
    'Selection',
    `${c.selection_basis}; seat ${c.vertical_category}${c.horizontal_reservation ? `, ${c.horizontal_reservation} reservation` : ''}; merit rank ${c.merit_rank ?? 'not ranked'}`,
  );
  row('Selection run', c.selection_run_id);
  doc.moveDown();
  doc.font('Helvetica-Bold').text('Sanctioned annual entitlement');
  if (c.annual_entitlement.length === 0)
    doc.font('Helvetica').text('None schedulable from the scheme data (see below).');
  for (const e of c.annual_entitlement) {
    doc
      .font('Helvetica')
      .text(
        `${e.currency} ${e.amount.toLocaleString('en-IN')} - ${e.beneficiary_type} via ${e.payment_mode}`,
      );
    for (const l of e.lines)
      doc.text(`    ${l.benefit_id}: ${l.currency} ${l.amount_annual.toLocaleString('en-IN')}`);
  }
  if (c.unschedulable_benefits.length > 0) {
    doc
      .moveDown(0.5)
      .font('Helvetica-Bold')
      .text('Benefit lines not scheduled (reported, not guessed)');
    for (const u of c.unschedulable_benefits)
      doc.font('Helvetica').text(`    ${u.benefit_id}: ${u.reason}`);
  }
  doc.moveDown();
  doc.font('Helvetica-Bold').text('Content hash (SHA-256 of the canonical order data)');
  doc.font('Courier').fontSize(9).text(hash);
  if (chain) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10).text('Audit chain record of this sanction');
    doc.font('Courier').fontSize(9).text(`seq ${chain.seq}`).text(chain.record_hash);
  }
  doc
    .font('Helvetica')
    .fontSize(8)
    .text(
      "Verify: recompute the SHA-256 of the canonical JSON of this order's data and compare, or scan the QR code. POST /api/v1/sanction-orders/verify also checks that the audit chain record exists, is this order's creation and verifies.",
    );
  doc.image(qr, { fit: [120, 120] });
  doc.end();
  return done;
}
