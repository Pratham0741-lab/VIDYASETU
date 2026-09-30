import { ApiError } from '../api/client';
import type { I18n } from './index';

/**
 * User-facing text for an error. HTTP 429 always gives the rate-limit
 * message. Otherwise, in order: the backend's message key
 * (details.message_key), its structured reason (details.reason), the error
 * code; unknown ones fall back to the backend's raw (English) message.
 */
export function errorText(err: unknown, i18n: I18n): string {
  if (err instanceof ApiError) {
    // Rate limit (throttled routes, e.g. 30 or 60 per minute per IP): one message, whatever the body says.
    if (err.status === 429 || err.code === 'TOO_MANY_REQUESTS') return i18n.t('code.TOO_MANY_REQUESTS');
    const vars: Record<string, string> = {};
    const d = err.details;
    if (d && !Array.isArray(d)) {
      if (Array.isArray(d.missing_purposes)) vars.purposes = d.missing_purposes.join(', ');
      if (Array.isArray(d.allowed_slots)) vars.slots = d.allowed_slots.join(', ');
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
