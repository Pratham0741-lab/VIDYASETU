import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DenialRecorder } from '../../authorization-denials/denial-recorder.service';
import { AppError } from '../errors/app-error';
import { ErrorCode, errorCodeForStatus } from '../errors/error-code.enum';
import { messageFor } from '../errors/error-messages';
import { buildErrorResponse, ErrorDetails, ErrorResponseBody } from '../errors/error-response';
import { REQUEST_ID_HEADER, requestIdOf } from '../middleware/request-id.middleware';

export interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details: ErrorDetails;
  /** True when the error is unexpected: log it in full, reveal nothing. */
  unexpected: boolean;
}

/** Errors from Express internals / body-parser (http-errors objects). */
interface HttpErrorLike {
  status?: unknown;
  statusCode?: unknown;
  expose?: unknown;
}

function clientHttpErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const candidate = exception as HttpErrorLike;
  const status = candidate.status ?? candidate.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500 && candidate.expose === true) {
    return status;
  }
  return undefined;
}

/**
 * Converts anything thrown into a client-safe description. Only AppError may
 * choose its own message and details; everything else gets the catalogue
 * message for its code, so framework or driver internals never leak.
 */
export function normalizeException(exception: unknown): NormalizedError {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      details: exception.details,
      unexpected: false,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = errorCodeForStatus(status);
    return {
      status,
      code,
      message: messageFor(code),
      details: null,
      unexpected: status >= 500,
    };
  }

  const clientStatus = clientHttpErrorStatus(exception);
  if (clientStatus !== undefined) {
    const code = errorCodeForStatus(clientStatus);
    return {
      status: clientStatus,
      code,
      message: messageFor(code),
      details: null,
      unexpected: false,
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message: messageFor(ErrorCode.INTERNAL_ERROR),
    details: null,
    unexpected: true,
  };
}

export function toErrorResponse(
  exception: unknown,
  requestId: string,
): { normalized: NormalizedError; body: ErrorResponseBody } {
  const normalized = normalizeException(exception);
  return {
    normalized,
    body: buildErrorResponse(normalized.code, normalized.message, normalized.details, requestId),
  };
}

/**
 * Global filter: every error leaves the API in the standard error shape.
 * Refused privileged actions (the set denial-classifier.ts recognises) are
 * recorded in authorization_denials BEFORE the response is sent, in a fresh
 * transaction - for every route, with no per-route code.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
    private readonly denials: DenialRecorder,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    if (host.getType() !== 'http') {
      // TODO(queues phase): non-HTTP contexts (queue workers) get their own handling.
      this.logger.error({ err: exception }, 'Unhandled exception outside HTTP context');
      return;
    }

    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = requestIdOf(req);
    const { normalized, body } = toErrorResponse(exception, requestId);

    this.log(exception, normalized, req);

    // Never throws (a failed write is logged); awaited so the row exists
    // before the client sees the refusal.
    await this.denials.recordHttp(exception, req);

    if (res.headersSent) {
      return;
    }
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(normalized.status).json(body);
  }

  private log(exception: unknown, normalized: NormalizedError, req: Request): void {
    // requestId is already bound to this request's logger by pino-http.
    const context = {
      method: req.method,
      path: req.originalUrl ?? req.url,
      status: normalized.status,
      code: normalized.code,
    };

    if (normalized.unexpected) {
      // Full error (including stack) goes to the logs only.
      this.logger.error({ ...context, err: exception }, 'Unhandled exception');
    } else if (normalized.status >= 500) {
      const cause = exception instanceof Error ? exception.cause : undefined;
      this.logger.warn({ ...context, details: normalized.details, cause }, normalized.message);
    } else {
      this.logger.debug({ ...context, details: normalized.details }, normalized.message);
    }
  }
}
