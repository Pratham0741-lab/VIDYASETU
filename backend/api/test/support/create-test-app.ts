import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { ValidationTestController } from './validation-test.controller';

/**
 * Every dependency points at 127.0.0.1:1, where nothing listens, so
 * connections fail fast. This proves the app boots and serves traffic with
 * all dependencies down, and lets readiness be asserted as 503.
 */
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  CORS_ORIGINS: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/vidyasetu_test?connect_timeout=1',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_PORT: '1',
  MINIO_ACCESS_KEY: 'test-access',
  MINIO_SECRET_KEY: 'test-secret-key',
  MINIO_BUCKET_DOCUMENTS: 'documents',
  ML_BASE_URL: 'http://127.0.0.1:1',
  ML_TIMEOUT_MS: '1000',
  HEALTH_CHECK_TIMEOUT_MS: '2000',
  JWT_ACCESS_SECRET: 'e2e-test-secret-at-least-32-characters-long',
  // Test-only fraud match key (32 bytes, base64); never a real key.
  FRAUD_MATCH_KEY: Buffer.alloc(32, 7).toString('base64'),
  // No Redis in e2e: the document pipeline worker must not start.
  DOCUMENT_WORKER_ENABLED: 'false',
  SLA_SWEEP_ENABLED: 'false',
};

export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot({ env: TEST_ENV })],
    // Test-only route; never part of the production AppModule.
    controllers: [ValidationTestController],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}
