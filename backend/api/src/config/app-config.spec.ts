import { ConfigValidationError, validateEnv } from './app-config';

const VALID_ENV = {
  CORS_ORIGINS: 'http://localhost:5173, https://vidyasetu.example.gov.in',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/vidyasetu?schema=public',
  REDIS_HOST: 'redis',
  MINIO_ENDPOINT: 'minio',
  MINIO_ACCESS_KEY: 'vidyasetu-api',
  MINIO_SECRET_KEY: 'supersecret',
  MINIO_BUCKET_DOCUMENTS: 'documents',
  ML_BASE_URL: 'http://ml:8000/',
  JWT_ACCESS_SECRET: 'unit-test-secret-at-least-32-characters-long',
  FRAUD_MATCH_KEY: Buffer.alloc(32, 9).toString('base64'),
};

function invalidVariablesOf(env: Record<string, string | undefined>): string[] {
  try {
    validateEnv(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigValidationError);
    return (err as ConfigValidationError).invalidVariables.map((v) => v.variable).sort();
  }
  throw new Error('expected validation to fail');
}

describe('validateEnv', () => {
  it('builds a typed config with defaults applied', () => {
    const config = validateEnv(VALID_ENV);

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.cors.origins).toEqual([
      'http://localhost:5173',
      'https://vidyasetu.example.gov.in',
    ]);
    expect(config.redis).toEqual({ host: 'redis', port: 6379, password: undefined });
    expect(config.storage.useSSL).toBe(false);
    expect(config.ml.baseUrl).toBe('http://ml:8000');
  });

  it('coerces numeric and boolean strings', () => {
    const config = validateEnv({ ...VALID_ENV, API_PORT: '8080', MINIO_USE_SSL: 'true' });

    expect(config.port).toBe(8080);
    expect(config.storage.useSSL).toBe(true);
  });

  it('reports every missing required variable at once', () => {
    expect(invalidVariablesOf({})).toEqual([
      'CORS_ORIGINS',
      'DATABASE_URL',
      'FRAUD_MATCH_KEY',
      'JWT_ACCESS_SECRET',
      'MINIO_ACCESS_KEY',
      'MINIO_BUCKET_DOCUMENTS',
      'MINIO_ENDPOINT',
      'MINIO_SECRET_KEY',
      'ML_BASE_URL',
      'REDIS_HOST',
    ]);
  });

  it('reports invalid values by variable name', () => {
    expect(
      invalidVariablesOf({
        ...VALID_ENV,
        API_PORT: 'abc',
        LOG_LEVEL: 'loud',
        DATABASE_URL: 'mysql://x',
      }),
    ).toEqual(['API_PORT', 'DATABASE_URL', 'LOG_LEVEL']);
  });

  it.each(['*', 'http://localhost:3000,*', 'https://*.gov.in', 'not-a-url', 'http://a.com/path'])(
    'rejects CORS_ORIGINS=%s',
    (value) => {
      expect(invalidVariablesOf({ ...VALID_ENV, CORS_ORIGINS: value })).toEqual(['CORS_ORIGINS']);
    },
  );

  it('never includes secret values in the error', () => {
    try {
      validateEnv({ ...VALID_ENV, MINIO_SECRET_KEY: 'short' });
      throw new Error('expected validation to fail');
    } catch (err) {
      expect(JSON.stringify((err as ConfigValidationError).invalidVariables)).not.toContain(
        'short"',
      );
      expect((err as ConfigValidationError).invalidVariables[0].variable).toBe('MINIO_SECRET_KEY');
    }
  });
});
