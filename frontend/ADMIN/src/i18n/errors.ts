import { ApiError } from '../api/client';
import type { I18n } from './index';

/**
 * User-facing text for an error. Order: the backend's message key
 * (details.message_key), its structured reason (details.reason), the error
 * code; unknown ones fall back to the backend's raw (English) message.
 */
export function errorText(err: unknown, i18n: I18n): string {
  if (err instanceof ApiError) {
    const vars: Record<string, string> = {};
    const d = err.details;
    if (d && !Array.isArray(d)) {
      if (typeof d.min_length === 'number') vars.min = String(d.min_length);
      if (typeof d.field === 'string') vars.field = d.field;
    }
    if (err.messageKey) {
      const text = i18n.tk(`api.${err.messageKey}`, '', vars);
      if (text) return text;
    }
    if (err.reason) {
      const text = i18n.tk(`reason.${err.reason}`, '', vars);
      if (text) return text;
    }
    return i18n.tk(`code.${err.code}`, err.message, vars);
  }
  return i18n.t('code.UNKNOWN');
}

/** The backend request id of an error, for support ("quote this reference"). */
export function errorRequestId(err: unknown): string | null {
  return err instanceof ApiError ? err.requestId : null;
}

/** True for a 403 (role or stage not permitted). */
export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}
