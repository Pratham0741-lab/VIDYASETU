import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

export const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Incoming IDs are echoed into logs and headers, so accept only a safe,
 * bounded charset (covers UUIDs, ULIDs and typical tracing IDs).
 * Anything else is replaced by a fresh UUID v4.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (candidate && SAFE_REQUEST_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

/** Returns the request ID assigned by RequestIdMiddleware. */
export function requestIdOf(req: Request): string {
  const id: unknown = req.id;
  return typeof id === 'string' && id.length > 0
    ? id
    : resolveRequestId(req.headers['x-request-id']);
}

/**
 * Assigns the request ID (reusing X-Request-ID when supplied) to `req.id`
 * and the X-Request-ID response header. Registered as the very first
 * middleware, so even requests rejected by the body parser carry an ID.
 * pino-http reuses `req.id`, which puts the ID on every request log line.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req.headers['x-request-id']);
    req.id = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

/**
 * Binds the request ID into AsyncLocalStorage for the rest of the request.
 * Registered after the body parsers, because body parsing resumes on stream
 * events and would otherwise lose the async context.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    RequestContext.run({ requestId: requestIdOf(req) }, next);
  }
}
