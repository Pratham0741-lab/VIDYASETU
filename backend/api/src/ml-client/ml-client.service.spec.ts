import type { PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../common/context/request-context';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { AppConfigService } from '../config/app-config.service';
import { MlClientService } from './ml-client.service';

const HEALTH = {
  status: 'ok',
  service: 'vidyasetu-ml',
  version: '0.1.0',
  modelsDirExists: true,
  modelsPresent: false,
};

function createClient() {
  const config = { ml: { baseUrl: 'http://ml:8000', timeoutMs: 1000 } } as AppConfigService;
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
  return new MlClientService(config, logger);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MlClientService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('forwards the current request ID in X-Request-ID', async () => {
    fetchMock.mockResolvedValue(jsonResponse(HEALTH));
    const client = createClient();

    const result = await RequestContext.run({ requestId: 'fwd-id-7' }, () => client.getHealth());

    expect(result).toEqual(HEALTH);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ml:8000/health');
    expect((init.headers as Record<string, string>)['X-Request-ID']).toBe('fwd-id-7');
  });

  it('generates a request ID when called outside a request', async () => {
    fetchMock.mockResolvedValue(jsonResponse(HEALTH));

    await createClient().getHealth();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Request-ID']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('raises DEPENDENCY_UNAVAILABLE when ml is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    await expect(createClient().getHealth()).rejects.toMatchObject({
      code: ErrorCode.DEPENDENCY_UNAVAILABLE,
      status: 503,
      details: { service: 'ml', reason: 'unreachable' },
    });
  });

  it('raises DEPENDENCY_UNAVAILABLE when ml answers 5xx', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: null, requestId: 'r' }, 500),
    );

    const error = (await createClient()
      .getHealth()
      .catch((e: unknown) => e)) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
    expect(error.details).toEqual({
      service: 'ml',
      upstreamStatus: 500,
      upstreamCode: 'INTERNAL_ERROR',
    });
  });
});
