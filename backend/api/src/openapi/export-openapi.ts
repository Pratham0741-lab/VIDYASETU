/**
 * Writes the OpenAPI document to a file without starting an HTTP server or
 * connecting to any dependency. Usage: node dist/openapi/export-openapi.js [out.json]
 *
 * The app is instantiated with placeholder configuration: the document only
 * depends on controllers and DTOs, and lifecycle hooks (DB/Redis connects)
 * never run because the app is not initialised or listening.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './swagger';

const PLACEHOLDER_ENV = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost',
  DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi',
  REDIS_HOST: 'localhost',
  MINIO_ENDPOINT: 'localhost',
  MINIO_ACCESS_KEY: 'openapi',
  MINIO_SECRET_KEY: 'openapi-export',
  MINIO_BUCKET_DOCUMENTS: 'documents',
  ML_BASE_URL: 'http://localhost:8000',
  JWT_ACCESS_SECRET: 'openapi-export-placeholder-secret-32-chars',
  // Required since Phase 11; a fixed placeholder (never used: nothing is hashed).
  FRAUD_MATCH_KEY: Buffer.alloc(32, 9).toString('base64'),
};

async function exportOpenApi(): Promise<void> {
  const outFile = resolve(process.argv[2] ?? 'openapi.json');
  const app = await NestFactory.create(AppModule.forRoot({ env: PLACEHOLDER_ENV }), {
    logger: false,
    bodyParser: false,
  });
  try {
    const document = buildOpenApiDocument(app);
    writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    process.stdout.write(`OpenAPI document written to ${outFile}\n`);
  } finally {
    await app.close();
  }
}

exportOpenApi().catch((err: unknown) => {
  process.stderr.write(
    `OpenAPI export failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
