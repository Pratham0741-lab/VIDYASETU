/**
 * CSV for analytics exports, built only from the rows the JSON response
 * already carries (so an export can never hold more than the JSON view).
 * RFC 4180 quoting; a cell starting with = + - @ (a spreadsheet formula) is
 * prefixed with ' so it is shown, never evaluated.
 */
export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s =
      typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : JSON.stringify(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))]
    .join('\r\n')
    .concat('\r\n');
}
