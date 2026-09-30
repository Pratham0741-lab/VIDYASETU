import { StreamableFile } from '@nestjs/common';
import { toCsv } from './csv';
import { toPdf } from './pdf-report';
import { SECONDARY_SUPPRESSED, SMALL_COUNT_THRESHOLD, SUPPRESSED } from './suppression';
import { toXlsx } from './xlsx';

/**
 * One export per analytics view (Phase 16): CSV, XLSX and PDF are built
 * from the SAME table - the columns and rows the view's JSON response
 * already carries after scoping and suppression - so no format can hold more
 * than the JSON. Generated on demand, returned, never stored.
 */
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export interface ExportTable {
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

const SUPPRESSION_NOTE = `Suppressed cells appear as "${SUPPRESSED}" (a true count of 1-${SMALL_COUNT_THRESHOLD - 1}) or "${SECONDARY_SUPPRESSED}" (hidden so that a "${SUPPRESSED}" cell cannot be worked out by subtraction; its true value may be any size).`;

const NOTE_KEYS = [
  'meaning',
  'identification',
  'overrides',
  'handling_time',
  'bulk_actions',
  'selected_means',
  'institution_type',
];

/** The facts every export states: window, scope, fixture setting, threshold. */
export function exportFacts(
  meta: Record<string, unknown>,
  callerRole: string,
): Array<[string, string]> {
  const s = (v: unknown): string =>
    v === null || v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v);
  const facts: Array<[string, string]> = [['view', s(meta.view)]];
  if (meta.from !== undefined)
    facts.push(['window', `${s(meta.from)} to ${s(meta.to)} (end exclusive, UTC)`]);
  if (meta.scheme !== undefined) facts.push(['scheme', s(meta.scheme)]);
  if (meta.academic_year !== undefined) facts.push(['academic_year', s(meta.academic_year)]);
  facts.push(['scope', `${s(meta.scope)}; caller role ${callerRole}`]);
  facts.push(['fixtures', s(meta.fixtures)]);
  facts.push(['small_count_threshold', s(meta.small_count_threshold)]);
  facts.push(['suppression', `${s(meta.suppression ?? '')} ${SUPPRESSION_NOTE}`.trim()]);
  facts.push(['generated_at', s(meta.generated_at)]);
  return facts;
}

export async function exportView(
  format: ExportFormat,
  name: string,
  title: string,
  meta: Record<string, unknown>,
  table: ExportTable,
  callerRole: string,
): Promise<StreamableFile> {
  const file = `vidyasetu-${name}.${format}`;
  if (format === 'csv') {
    return new StreamableFile(Buffer.from(toCsv(table.columns, table.rows), 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file}"`,
    });
  }
  const facts = exportFacts(meta ?? {}, callerRole);
  const notes = NOTE_KEYS.filter((k) => typeof meta?.[k] === 'string').map(
    (k) => `${k}: ${String(meta[k])}`,
  );
  if (format === 'xlsx') {
    const body = toXlsx([
      { name: 'data', columns: table.columns, rows: table.rows },
      {
        name: 'metadata',
        columns: ['key', 'value'],
        rows: [...facts, ...notes.map((n): [string, string] => ['note', n])].map(
          ([key, value]) => ({
            key,
            value,
          }),
        ),
      },
    ]);
    return new StreamableFile(body, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${file}"`,
    });
  }
  const pdf = await toPdf(
    {
      title,
      notes,
      footer: facts.filter(([k]) => k !== 'view').map(([k, v]) => `${k}: ${v}`),
    },
    table.columns,
    table.rows,
  );
  return new StreamableFile(pdf, {
    type: 'application/pdf',
    disposition: `attachment; filename="${file}"`,
  });
}
