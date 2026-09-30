import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { toErrorResponse } from './common/filters/all-exceptions.filter';
import {
  REQUEST_ID_HEADER,
  RequestContextMiddleware,
  RequestIdMiddleware,
  requestIdOf,
} from './common/middleware/request-id.middleware';
import { AppConfigService } from './config/app-config.service';

/**
 * Body parsers run as plain Express middleware, outside Nest's exception
 * filters. This wrapper renders their errors (malformed JSON, body too large,
 * unsupported charset) in the standard error shape.
 */
function withStandardErrors(parser: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void parser(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }
      const requestId = requestIdOf(req);
      const { normalized, body } = toErrorResponse(err, requestId);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      res.status(normalized.status).json(body);
    });
  };
}

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so tests exercise the
 * production setup. The app must be created with `bodyParser: false`.
 *
 * Order matters:
 *   request ID -> helmet -> CORS -> body parsers -> request context -> Nest
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);
  app.useLogger(app.get(Logger));

  const requestId = new RequestIdMiddleware();
  app.use(requestId.use.bind(requestId));

  app.use(helmet());
  // Phase 17 (F2): API responses are per-user and may carry personal data
  // (JSON, PDFs, exports): never stored by a browser or an intermediary.
  app.use('/api', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: [...config.cors.origins],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Accept-Language',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  });

  const limit = config.http.bodyLimit;
  app.use(withStandardErrors(express.json({ limit })));
  app.use(withStandardErrors(express.urlencoded({ extended: false, limit })));

  const requestContext = new RequestContextMiddleware();
  app.use(requestContext.use.bind(requestContext));

  // TODO(deployment phase): set 'trust proxy' once the reverse proxy is known.
}
