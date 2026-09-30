import { DEFAULT_LOCALE, fillTemplate } from '../notifications/templates';

/**
 * Phase 13C: the deficiency notice, built only from notice_templates rows
 * (seeded in English and Hindi) - the notice frame, one line per item, and
 * the message-key texts for each problem, fix and document name. Pure: the
 * rows are passed in.
 *
 * Language: the applicant's preferred language if EVERY piece the notice
 * needs exists in it; otherwise the whole notice is English (never a mix),
 * and the caller records the fallback (notifications.requested_locale).
 */
export const NOTICE_CODE = 'DEFICIENCY_NOTICE';
export const NOTICE_ITEM_CODE = 'DEFICIENCY_NOTICE_ITEM';
/** Phase 13D: the line linking an item to its crop (served, never embedded). */
export const NOTICE_CROP_CODE = 'DEFICIENCY_NOTICE_CROP';

export interface TemplateRow {
  code: string;
  locale: string;
  subject_template: string | null;
  body_template: string;
}

export interface NoticeItem {
  document_slot: string | null;
  document_type: string | null;
  problem_code: string;
  fix_code: string;
  deadline_at: string; // ISO
  /** Phase 13D: the crop link for this item, when it has one. */
  crop_url?: string | null;
}

export interface RenderedNotice {
  requested_locale: string;
  locale: string;
  fell_back: boolean;
  subject: string;
  body: string;
}

export class MissingNoticeTemplateError extends Error {}

/** The template codes a notice for these items needs. */
export function codesNeeded(items: readonly NoticeItem[]): string[] {
  const codes = new Set<string>([NOTICE_CODE, NOTICE_ITEM_CODE]);
  for (const i of items) {
    if (i.crop_url) codes.add(NOTICE_CROP_CODE);
    codes.add(i.problem_code);
    codes.add(i.fix_code);
    codes.add(documentCode(i));
  }
  return [...codes].sort();
}

const documentCode = (i: NoticeItem) =>
  i.document_slot === null ? 'document.ALL' : `document.${i.document_type ?? 'UNKNOWN'}`;

/** YYYY-MM-DD in India Standard Time. */
export function noticeDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function renderDeficiencyNotice(
  rows: readonly TemplateRow[],
  requested: string,
  applicationNo: string,
  items: readonly NoticeItem[],
): RenderedNotice {
  const table = (locale: string) =>
    new Map(rows.filter((r) => r.locale === locale).map((r) => [r.code, r]));
  // A document without a document.<TYPE> row (no canonical type) is named by
  // its slot text; it does not force a fallback.
  const required = codesNeeded(items).filter((c) => c !== 'document.UNKNOWN');
  const complete = (t: Map<string, TemplateRow>) => required.every((c) => t.has(c));

  let locale = requested;
  let t = table(requested);
  if (!complete(t)) {
    locale = DEFAULT_LOCALE;
    t = table(DEFAULT_LOCALE);
    if (!complete(t)) {
      const missing = required.filter((c) => !t.has(c));
      throw new MissingNoticeTemplateError(`notice templates missing: ${missing.join(', ')}`);
    }
  }
  const text = (code: string) => t.get(code)!.body_template;
  const cropLine = (url: string) => fillTemplate(text(NOTICE_CROP_CODE), { crop_url: url }, false);
  const lines = items.map((i, idx) =>
    [itemLine(i, idx), ...(i.crop_url ? [cropLine(i.crop_url)] : [])].join('\n'),
  );
  function itemLine(i: NoticeItem, idx: number) {
    return fillTemplate(
      text(NOTICE_ITEM_CODE),
      {
        n: idx + 1,
        document: t.get(documentCode(i))?.body_template ?? i.document_slot ?? '-',
        problem: text(i.problem_code),
        fix: text(i.fix_code),
        deadline: noticeDate(i.deadline_at),
      },
      false,
    );
  }
  const earliest = items.map((i) => i.deadline_at).sort()[0];
  const params = {
    application_no: applicationNo,
    item_count: items.length,
    deadline: earliest ? noticeDate(earliest) : '-',
    items: lines.join('\n'),
  };
  const frame = t.get(NOTICE_CODE)!;
  return {
    requested_locale: requested,
    locale,
    fell_back: locale !== requested,
    subject: fillTemplate(frame.subject_template ?? '', params, false),
    body: fillTemplate(frame.body_template, params, false),
  };
}
