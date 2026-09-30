import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/errors/error-response';

export const API_VERSION = '0.1.0';
export const DOCS_PATH = 'docs';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('VIDYASETU API')
    .setDescription(
      'Scholarship and fellowship management platform, Ministry of Tribal Affairs.\n\n' +
        'Every error response has the shape `{ code, message, details, requestId }` ' +
        '(see ErrorResponseDto). Send `X-Request-ID` to correlate logs; it is echoed back.',
    )
    .setVersion(API_VERSION)
    .addTag('health', 'Liveness and readiness probes')
    .addTag('auth', 'Registration, login, token refresh and logout')
    .addTag('schemes', 'Scheme engine: eligibility, reverse eligibility, form schemas')
    .addBearerAuth()
    .build();

  return SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
  });
}

export function setupSwagger(app: INestApplication, document: OpenAPIObject): void {
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
  });
}
