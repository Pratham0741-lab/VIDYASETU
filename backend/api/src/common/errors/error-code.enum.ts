import { HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes returned in the `code` field of every error
 * response. Clients must branch on these, never on `message`.
 * (The ml service has its own, separate registry in ml/app/errors.py; the
 * api never passes ml codes through - ml failures map to
 * DEPENDENCY_UNAVAILABLE / INTERNAL_ERROR in src/ml-client.)
 */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  CONFLICT = 'CONFLICT',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // Integration adapters (Phase 10): failures of the external service's own
  // making, which the caller can act on. 422 (not 403/404): the request was
  // understood; the external system refused it.
  DIGILOCKER_DOCUMENT_NOT_FOUND = 'DIGILOCKER_DOCUMENT_NOT_FOUND',
  DIGILOCKER_CONSENT_REQUIRED = 'DIGILOCKER_CONSENT_REQUIRED',
  DIGILOCKER_DOCUMENT_TYPE_MISMATCH = 'DIGILOCKER_DOCUMENT_TYPE_MISMATCH',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  // Phase 11: a HIGH fraud flag holds forward actions until it is reviewed.
  FRAUD_REVIEW_PENDING = 'FRAUD_REVIEW_PENDING',
  REASON_REQUIRED = 'REASON_REQUIRED',
}

/** Default HTTP status for each error code. AppError may override it. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, HttpStatus>> = {
  [ErrorCode.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
  [ErrorCode.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.METHOD_NOT_ALLOWED]: HttpStatus.METHOD_NOT_ALLOWED,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  [ErrorCode.TOO_MANY_REQUESTS]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.DEPENDENCY_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.DIGILOCKER_DOCUMENT_NOT_FOUND]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.DIGILOCKER_CONSENT_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.DIGILOCKER_DOCUMENT_TYPE_MISMATCH]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.INSUFFICIENT_BALANCE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.FRAUD_REVIEW_PENDING]: HttpStatus.CONFLICT,
  [ErrorCode.REASON_REQUIRED]: HttpStatus.BAD_REQUEST,
};

/** Maps an HTTP status (e.g. from a framework HttpException) to an ErrorCode. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return ErrorCode.BAD_REQUEST;
    case 401:
      return ErrorCode.UNAUTHORIZED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 405:
      return ErrorCode.METHOD_NOT_ALLOWED;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
    case 429:
      return ErrorCode.TOO_MANY_REQUESTS;
    case 502:
    case 503:
    case 504:
      return ErrorCode.DEPENDENCY_UNAVAILABLE;
    default:
      return status >= 400 && status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL_ERROR;
  }
}
