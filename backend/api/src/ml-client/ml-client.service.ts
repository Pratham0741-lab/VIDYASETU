import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { RequestContext } from '../common/context/request-context';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { REQUEST_ID_HEADER } from '../common/middleware/request-id.middleware';
import {
  ClassificationResult,
  ConsistencyResult,
  CropResult,
  ExtractionResult,
  FieldBox,
  ML_DOCUMENT_PATHS,
  QualityResult,
  RESPONSE_SHAPES,
} from './document-api';

/** Response of the ml service's GET /health. */
export interface MlHealth {
  status: string;
  service: string;
  version: string;
  modelsDirExists: boolean;
  modelsPresent: boolean;
}

export interface MlRequestOptions {
  body?: unknown;
  /** Overrides ML_TIMEOUT_MS for this call (e.g. long OCR jobs). */
  timeoutMs?: number;
  /** Explicit request ID; defaults to the ID of the current HTTP request. */
  requestId?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * HTTP client for the internal ml service. Every call forwards the current
 * request ID in X-Request-ID so logs on both services can be correlated.
 * Failures surface as AppError(DEPENDENCY_UNAVAILABLE) so callers and the
 * exception filter handle them uniformly.
 *
 * Document intelligence (Phase 7): checkQuality / classifyDocument /
 * extractFields / checkConsistency call the ml service's document endpoints
 * (contract: document-api.ts). Which implementation is injected - this one
 * or MockMlService - is decided in exactly one place, the provider factory in
 * ml-client.module.ts, from ML_MODE.
 */
/** Extraction's own ceiling: the ml time budget plus the pass in flight. */
const EXTRACT_TIMEOUT_MS = 45_000;

@Injectable()
export class MlClientService {
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs: number;

  constructor(
    config: AppConfigService,
    @InjectPinoLogger(MlClientService.name) protected readonly logger: PinoLogger,
  ) {
    this.baseUrl = config.ml.baseUrl;
    this.defaultTimeoutMs = config.ml.timeoutMs;
  }

  getHealth(options: Omit<MlRequestOptions, 'body'> = {}): Promise<MlHealth> {
    return this.request<MlHealth>('GET', '/health', options);
  }

  checkQuality(image: Buffer): Promise<QualityResult> {
    return this.document('quality', { image_base64: image.toString('base64') });
  }

  classifyDocument(image: Buffer): Promise<ClassificationResult> {
    return this.document('classify', { image_base64: image.toString('base64') });
  }

  /** documentType: a canonical type, or null to let the ml service classify. */
  extractFields(image: Buffer, documentType: string | null): Promise<ExtractionResult> {
    // Best-effort OCR runs several preprocessing passes (ml: ocr_time_budget_s = 20 s).
    return this.document(
      'extract',
      {
        image_base64: image.toString('base64'),
        ...(documentType === null ? {} : { document_type: documentType }),
      },
      Math.max(this.defaultTimeoutMs, EXTRACT_TIMEOUT_MS),
    );
  }

  checkConsistency(extractions: Record<string, unknown>[]): Promise<ConsistencyResult> {
    return this.document('consistency', { extractions });
  }

  /**
   * Phase 13D: the region of a stored image around a field box, plus a
   * margin (the ml service refuses a region over half the page). Pure image
   * work, so the mock inherits it: it always reaches the real ml service.
   */
  cropImage(image: Buffer, box: FieldBox, margin: number): Promise<CropResult> {
    return this.document('crop', {
      image_base64: image.toString('base64'),
      page: box.page,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      margin,
    });
  }

  /** Implementation label recorded with every result (overridden by the mock). */
  get engineLabel(): string {
    return 'ML_SERVICE';
  }

  private async document<K extends keyof typeof ML_DOCUMENT_PATHS>(
    kind: K,
    body: unknown,
    timeoutMs?: number,
  ): Promise<
    K extends 'quality'
      ? QualityResult
      : K extends 'classify'
        ? ClassificationResult
        : K extends 'extract'
          ? ExtractionResult
          : K extends 'crop'
            ? CropResult
            : ConsistencyResult
  > {
    const result = await this.request<unknown>('POST', ML_DOCUMENT_PATHS[kind], {
      body,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    if (!RESPONSE_SHAPES[kind](result)) {
      this.logger.warn({ path: ML_DOCUMENT_PATHS[kind] }, 'ml returned a malformed response');
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'ml', reason: 'invalid_response' },
      });
    }
    return result as never;
  }

  async request<T>(method: HttpMethod, path: string, options: MlRequestOptions = {}): Promise<T> {
    const requestId = options.requestId ?? RequestContext.requestId() ?? randomUUID();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      [REQUEST_ID_HEADER]: requestId,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
          ? 'timeout'
          : 'unreachable';
      this.logger.warn({ err, method, path, requestId, reason }, 'ml request failed');
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'ml', reason },
        cause: err,
      });
    }

    const payload = await this.readJson(response);

    if (!response.ok) {
      const upstreamCode =
        payload && typeof payload === 'object' && 'code' in payload
          ? String(payload.code)
          : undefined;
      this.logger.warn(
        { method, path, requestId, status: response.status, upstreamCode },
        'ml returned an error response',
      );
      // 5xx: ml is unhealthy. 4xx: the api sent something ml rejected (our bug).
      throw response.status >= 500
        ? new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
            details: { service: 'ml', upstreamStatus: response.status, upstreamCode },
          })
        : new AppError(ErrorCode.INTERNAL_ERROR, {
            status: 502,
            details: { service: 'ml', upstreamStatus: response.status, upstreamCode },
          });
    }

    return payload as T;
  }

  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length === 0) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (!response.ok) return null;
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'ml', reason: 'invalid_response' },
      });
    }
  }
}
