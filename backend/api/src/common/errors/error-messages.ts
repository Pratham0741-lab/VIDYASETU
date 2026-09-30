import { ErrorCode } from './error-code.enum';

/**
 * Single home for every user-facing error message.
 *
 * TODO(i18n): later phases replace these English strings with i18n message
 * keys (e.g. 'errors.validation') resolved per request locale. Because every
 * message is looked up here by ErrorCode, that conversion is a change to this
 * file (and the lookup helper) only.
 */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  [ErrorCode.VALIDATION_ERROR]: 'The request contains invalid data.',
  [ErrorCode.BAD_REQUEST]: 'The request could not be processed.',
  [ErrorCode.UNAUTHORIZED]: 'Authentication is required.',
  [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action.',
  [ErrorCode.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCode.METHOD_NOT_ALLOWED]: 'This method is not allowed for the requested resource.',
  [ErrorCode.CONFLICT]: 'The request conflicts with the current state of the resource.',
  [ErrorCode.PAYLOAD_TOO_LARGE]: 'The request body is too large.',
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: 'The request content type is not supported.',
  [ErrorCode.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: 'A required service is temporarily unavailable.',
  [ErrorCode.INTERNAL_ERROR]: 'An unexpected error occurred.',
  [ErrorCode.DIGILOCKER_DOCUMENT_NOT_FOUND]:
    'DigiLocker has no document with this reference. Check the reference in your DigiLocker "Issued Documents", or upload a scanned copy instead.',
  [ErrorCode.DIGILOCKER_CONSENT_REQUIRED]:
    'VIDYASETU is not allowed to read this DigiLocker document. Grant access to it in DigiLocker and try again, or upload a scanned copy instead.',
  [ErrorCode.DIGILOCKER_DOCUMENT_TYPE_MISMATCH]:
    'This DigiLocker document is not the kind of document this checklist item needs.',
  [ErrorCode.INSUFFICIENT_BALANCE]:
    'The paying account does not have enough balance for this payment. It has not been sent; try again once funds are available.',
  [ErrorCode.REASON_REQUIRED]:
    'This decision needs a reason of at least 10 characters. Say what you checked and why you decided this way.',
  [ErrorCode.FRAUD_REVIEW_PENDING]:
    'This application has a high-severity fraud or duplicate flag awaiting review. Review the flag before moving the application forward.',
};

export function messageFor(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
