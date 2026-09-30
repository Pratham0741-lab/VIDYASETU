import { crc32, inflateSync } from 'node:zlib';
import { exportFacts } from './exports';
import { toPdf } from './pdf-report';
import { toXlsx } from './xlsx';

/** Reads a stored (uncompressed) ZIP, checking every CRC. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const data = buf.subarray(i + 30 + nameLen, i + 30 + nameLen + size);
    expect([name, method, crc32(data) === crc]).toEqual([name, 0, true]);
    out[name] = data.toString('utf8');
    i += 30 + nameLen + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  return out;
}

/** The text runs of a pdfkit PDF (one per BT ... ET block). */
export function pdfText(buf: Buffer): string[] {
  const runs: string[] = [];
  const s = buf.toString('latin1');
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const bt of content.matchAll(/BT([\s\S]*?)ET/g)) {
      const hex = [...bt[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]).join('');
      if (hex) runs.push(Buffer.from(hex, 'hex').toString('latin1'));
    }
  }
  return runs;
}

describe('XLSX export (Phase 16, no dependency)', () => {
  const rows = [
    { metric: 'submitted', count: 12, note: '<5' },
    { metric: '=HYPERLINK("x")', count: 'suppressed', note: 'a & b' },
  ];
  it('is a valid ZIP of the spreadsheet parts; numbers numeric, text inline, never a formula', () => {
    const files = unzip(
      toXlsx([
        { name: 'data', columns: ['metric', 'count', 'note'], rows },
        {
          name: 'metadata',
          columns: ['key', 'value'],
          rows: [{ key: 'fixtures', value: 'excluded' }],
        },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<t xml:space="preserve">&lt;5</t>');
    expect(sheet).toContain('<t xml:space="preserve">suppressed</t>');
    expect(sheet).toContain('=HYPERLINK(&quot;x&quot;)');
    expect(sheet).not.toContain('<f>');
    expect(files['xl/workbook.xml']).toContain('<sheet name="metadata" sheetId="2" r:id="rId2"/>');
  });

  it('the same input gives the same bytes (no timestamps)', () => {
    const a = toXlsx([{ name: 'data', columns: ['metric'], rows }]);
    const b = toXlsx([{ name: 'data', columns: ['metric'], rows }]);
    expect(a.equals(b)).toBe(true);
  });
});

describe('PDF export (Phase 16, pdfkit)', () => {
  it('prints every cell and the footer on every page', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      k: `row-${i}`,
      v: i % 7 === 0 ? '<5' : i,
    }));
    const pdf = await toPdf(
      { title: 'Test view', footer: ['window: 2026-01-01 to 2027-01-01', 'fixtures: excluded'] },
      ['k', 'v'],
      rows,
    );
    const runs = pdfText(pdf);
    for (const r of rows) {
      expect(runs).toContain(r.k);
      expect(runs).toContain(String(r.v));
    }
    const footers = runs.filter((t) => t.startsWith('window: 2026-01-01 to 2027-01-01'));
    expect(footers.length).toBeGreaterThan(1);
    footers.forEach((f, i) => expect(f).toContain(`Page ${i + 1} of ${footers.length}`));
  });
});

describe('export facts', () => {
  it('state window, scope, fixtures, threshold and the suppression markers', () => {
    const facts = Object.fromEntries(
      exportFacts(
        {
          view: 'funnel',
          from: '2026-01-01',
          to: '2027-01-01',
          scope: 'rows visible to the caller under database row-level security',
          fixtures: 'excluded',
          small_count_threshold: 5,
          generated_at: 'now',
        },
        'AUDITOR',
      ),
    );
    expect(facts.window).toBe('2026-01-01 to 2027-01-01 (end exclusive, UTC)');
    expect(facts.scope).toContain('caller role AUDITOR');
    expect(facts.fixtures).toBe('excluded');
    expect(facts.small_count_threshold).toBe('5');
    expect(facts.suppression).toContain('"<5"');
    expect(facts.suppression).toContain('"suppressed"');
  });
});
