import { crc32 } from 'node:zlib';

/**
 * A minimal XLSX (Office Open XML spreadsheet) writer for analytics exports
 * (Phase 16). No dependency: the file is a ZIP (stored, not compressed) of
 * a handful of XML parts, built in memory from the rows the JSON view
 * already carries, and never stored.
 *
 * Every text cell is an inline string, so nothing in a cell is ever
 * evaluated as a formula; numbers are numeric cells. Suppressed cells hold
 * the text "<5" or "suppressed", exactly as in the JSON.
 */
export interface Sheet {
  name: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 cannot carry.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

function cell(ref: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  const text = typeof v === 'string' ? v : typeof v === 'boolean' ? String(v) : JSON.stringify(v);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(s: Sheet): string {
  const header = s.columns.map((c, i) => cell(`${colName(i)}1`, c)).join('');
  const body = s.rows
    .map(
      (r, ri) =>
        `<row r="${ri + 2}">${s.columns.map((c, ci) => cell(`${colName(ci)}${ri + 2}`, r[c])).join('')}</row>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`
  );
}

/** ZIP (store method) of the given entries. */
function zip(entries: Array<[string, Buffer]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // A fixed DOS timestamp (1980-01-01): the bytes depend on the content only.
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

export function toXlsx(sheets: Sheet[]): Buffer {
  const safe = sheets.map((s, i) => ({
    ...s,
    name: xml(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) || `Sheet${i + 1}`,
  }));
  const b = (s: string) => Buffer.from(s, 'utf8');
  const entries: Array<[string, Buffer]> = [
    [
      '[Content_Types].xml',
      b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          safe
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          '</Types>',
      ),
    ],
    [
      '_rels/.rels',
      b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    ],
    [
      'xl/workbook.xml',
      b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          safe
            .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join('') +
          '</sheets></workbook>',
      ),
    ],
    [
      'xl/_rels/workbook.xml.rels',
      b(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          safe
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join('') +
          '</Relationships>',
      ),
    ],
    ...safe.map((s, i): [string, Buffer] => [`xl/worksheets/sheet${i + 1}.xml`, b(sheetXml(s))]),
  ];
  return zip(entries);
}
