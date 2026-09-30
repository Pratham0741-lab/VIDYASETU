import type { I18n } from './index';

/** "ST_OTHERS" -> "St others": fallback text for a code that has no i18n key (underscores to spaces, sentence case). */
export function humanise(raw: string): string {
  const text = raw.replace(/[_-]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : raw;
}

/**
 * Label for a backend code under an i18n prefix, e.g. codeLabel(i18n,
 * 'category', 'ST_OTHERS'): the key `category.ST_OTHERS` when it exists,
 * else the humanised code.
 */
export function codeLabel(i18n: Pick<I18n, 'tk'>, prefix: string, code: string): string {
  return i18n.tk(`${prefix}.${code}`, humanise(code));
}

/** Applicant category or vertical category / seat pool (ST, PVTG, ST_OTHERS, ...). */
export const categoryLabel = (i18n: Pick<I18n, 'tk'>, code: string) => codeLabel(i18n, 'category', code);

/** Horizontal reservation a seat was filled under (FEMALE, PWD, ...). */
export const reservationLabel = (i18n: Pick<I18n, 'tk'>, code: string) => codeLabel(i18n, 'reservation', code);
