import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import type { AppConfigService } from '../../config/app-config.service';
import { bodyShape, redactForLog, scrubMessage, urlShape } from './redaction';

function requestIdFrom(req: IncomingMessage): string {
  const id: unknown = req.id;
  return typeof id === 'string' && id.length > 0 ? id : randomUUID();
}

/**
 * Structured JSON logging. `requestId` is attached to every log line written
 * while handling a request (HTTP access logs and any PinoLogger call).
 */
export function buildLoggerOptions(config: AppConfigService): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      base: { service: 'vidyasetu-api' },
      timestamp: stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        // Phase 17: every logged object loses personal data (redaction.ts).
        log: (obj) => redactForLog(obj) as Record<string, unknown>,
      },
      // Phase 17: the message string too (a Prisma error event passes its
      // whole invocation text as the message).
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((a) => (typeof a === 'string' ? scrubMessage(a) : a));
          return method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
      serializers: {
        // The request as method, path, query parameter NAMES, params and the
        // body's field names and sizes - never a value.
        req: (req: {
          id?: unknown;
          method?: string;
          url?: string;
          params?: unknown;
          raw?: { body?: unknown };
          remoteAddress?: string;
        }) => ({
          id: req.id,
          method: req.method,
          url: urlShape(req.url),
          params: req.params,
          body: bodyShape(req.raw?.body),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        err: (err: unknown) => redactForLog(err),
      },
      // RequestIdMiddleware has already set req.id; reuse it.
      genReqId: (req: IncomingMessage) => requestIdFrom(req),
      // Bind the ID as `requestId` on the per-request child logger, which
      // nestjs-pino uses for every PinoLogger call during the request.
      customAttributeKeys: { reqId: 'requestId' },
      quietReqLogger: true,
      customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url === '/health/live',
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
    },
  };
}
