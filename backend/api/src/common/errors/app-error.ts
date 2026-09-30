import { ERROR_HTTP_STATUS, ErrorCode } from './error-code.enum';
import { messageFor } from './error-messages';
import type { ErrorDetails } from './error-response';

export interface AppErrorOptions {
  /** Overrides the default message for the code. Must be safe to show users. */
  message?: string;
  /** Structured, client-safe extra information (field errors, ids, ...). */
  details?: ErrorDetails;
  /** Overrides the default HTTP status for the code. */
  status?: number;
  /** Underlying error; logged server-side, never sent to the client. */
  cause?: unknown;
}

/**
 * The error type application code throws. The global exception filter turns
 * it into the standard error response shape.
 *
 * @example
 *   throw new AppError(ErrorCode.CONFLICT, { details: { field: 'email' } });
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? messageFor(code), { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_HTTP_STATUS[code];
    this.details = options.details ?? null;
  }
}
