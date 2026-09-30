import { AppError } from './errors/app-error';
import { ErrorCode } from './errors/error-code.enum';

/**
 * Phase 13B: every decision that overrides, corrects, rejects or otherwise
 * changes an outcome carries a reason - required here (API, one error:
 * REASON_REQUIRED) and again by the database (a CHECK on decision_records and
 * transition triggers on the other decision tables; migration
 * 20260928090000_decision_reasons). The reason is stored with the decision
 * and appears in its audit row; it is never logged and never reaches
 * analytics (it may contain personal detail).
 */
export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 2000;

/** Returns the trimmed reason, or throws REASON_REQUIRED (400). */
export function requireReason(
  value: unknown,
  field: string,
  maxLength = REASON_MAX_LENGTH,
): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < REASON_MIN_LENGTH || reason.length > maxLength) {
    throw new AppError(ErrorCode.REASON_REQUIRED, {
      details: { field, min_length: REASON_MIN_LENGTH, max_length: maxLength },
    });
  }
  return reason;
}
