import PDFDocument from 'pdfkit';
import { fontFor } from '../common/pdf/fonts';

/**
 * PDF export of one analytics view (Phase 16), drawn with pdfkit - the
 * library the sanction order already uses (pure JS, built-in Helvetica,
 * nothing fetched at runtime). One table, the same columns and rows as the
 * CSV export (never more than the JSON view), and on every page a footer
 * stating the date window, scope, fixture setting and suppression
 * threshold. Suppressed cells print exactly as in the JSON: "<5" or
 * "suppressed". Phase 17: text with Devanagari is drawn with the embedded
 * Devanagari font (common/pdf/fonts.ts); everything else as before.
 */
export interface ReportMeta {
  title: string;
  /** Footer facts, e.g. window, scope, fixtures, threshold. */
  footer: string[];
  /** Notes printed under the title (what the view means / does not mean). */
  notes?: string[];
}

const text = (v: unknown): string =>
  v === null || v === undefined
    ? ''
    : typeof v === 'string'
      ? v
      : typeof v === 'number' || typeof v === 'boolean'
        ? String(v)
        : JSON.stringify(v);

export async function toPdf(
  meta: ReportMeta,
  columns: string[],
  rows: Array<Record<string, unknown>>,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, left: 36, right: 36, bottom: 70 },
    bufferPages: true,
    info: { Title: meta.title, Author: 'VIDYASETU analytics' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const colWidth = width / Math.max(columns.length, 1);
  const fontSize = columns.length > 10 ? 6.5 : 7.5;

  doc
    .font(fontFor(doc, meta.title, 'Helvetica-Bold'))
    .fontSize(13)
    .text(meta.title);
  doc.font('Helvetica').fontSize(8);
  for (const n of meta.notes ?? []) doc.font(fontFor(doc, n, 'Helvetica')).text(n, { width });
  doc.moveDown(0.5);

  const base = (bold: boolean) => (bold ? 'Helvetica-Bold' : 'Helvetica');
  const rowHeight = (cells: string[], bold: boolean) => {
    doc.font(base(bold)).fontSize(fontSize);
    return (
      Math.max(
        ...cells.map((c) =>
          doc.font(fontFor(doc, c, base(bold))).heightOfString(c || ' ', { width: colWidth - 4 }),
        ),
      ) + 4
    );
  };
  const drawRow = (cells: string[], bold: boolean) => {
    const h = rowHeight(cells, bold);
    if (doc.y + h > bottom()) {
      doc.addPage();
      drawRow(columns, true);
    }
    const y = doc.y;
    doc.font(base(bold)).fontSize(fontSize);
    cells.forEach((c, i) => {
      doc
        .font(fontFor(doc, c, base(bold)))
        .text(c, left + i * colWidth + 2, y + 2, { width: colWidth - 4, lineBreak: true });
    });
    doc
      .moveTo(left, y + h)
      .lineTo(left + width, y + h)
      .lineWidth(0.3)
      .strokeColor('#999999')
      .stroke();
    doc.x = left;
    doc.y = y + h;
  };
  drawRow(columns, true);
  if (rows.length === 0) {
    doc
      .font('Helvetica')
      .fontSize(fontSize)
      .text('(no rows in this scope)', left, doc.y + 4);
  }
  for (const r of rows)
    drawRow(
      columns.map((c) => text(r[c])),
      false,
    );

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footer = [...meta.footer, `Page ${i - range.start + 1} of ${range.count}`].join('  |  ');
    doc
      .font(fontFor(doc, footer, 'Helvetica'))
      .fontSize(6.5)
      .fillColor('#333333');
    doc.text(footer, left, doc.page.height - saved + 12, { width, lineBreak: true });
    doc.page.margins.bottom = saved;
    doc.fillColor('black');
  }
  doc.end();
  return done;
}
