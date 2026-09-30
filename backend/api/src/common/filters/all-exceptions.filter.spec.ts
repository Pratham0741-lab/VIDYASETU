import type { DenialRecorder } from '../../authorization-denials/denial-recorder.service';
import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { IsEmail, IsInt, Min } from 'class-validator';
import type { PinoLogger } from 'nestjs-pino';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-code.enum';
import { ERROR_MESSAGES } from '../errors/error-messages';
import { validationExceptionFactory } from '../errors/validation-errors';
import { AllExceptionsFilter } from './all-exceptions.filter';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsInt()
  @Min(1)
  count!: number;
}

interface MockResponse {
  headersSent: boolean;
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
}

function createMocks(requestId = 'req-123') {
  const req = {
    id: requestId,
    method: 'POST',
    originalUrl: '/things',
    url: '/things',
    headers: {},
  };
  const res: MockResponse = {
    headersSent: false,
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const logger = { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() };
  // Records denials before the response is sent; a stub here (the recorder has its own spec).
  const denials = { recordHttp: jest.fn().mockResolvedValue(undefined) };
  const filter = new AllExceptionsFilter(
    logger as unknown as PinoLogger,
    denials as unknown as DenialRecorder,
  );
  return { req, res, host, logger, filter, denials };
}

function sentBody(res: MockResponse): Record<string, unknown> {
  expect(res.json).toHaveBeenCalledTimes(1);
  return res.json.mock.calls[0][0] as Record<string, unknown>;
}

function expectStandardShape(body: Record<string, unknown>): void {
  expect(Object.keys(body).sort()).toEqual(['code', 'details', 'message', 'requestId']);
  expect(typeof body.code).toBe('string');
  expect(typeof body.message).toBe('string');
  expect(typeof body.requestId).toBe('string');
}

describe('AllExceptionsFilter', () => {
  it('renders an AppError with its code, status, message and details', async () => {
    const { res, host, filter } = createMocks();
    const error = new AppError(ErrorCode.CONFLICT, {
      message: 'Already exists.',
      details: { field: 'email' },
    });

    await filter.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'req-123');
    const body = sentBody(res);
    expectStandardShape(body);
    expect(body).toEqual({
      code: 'CONFLICT',
      message: 'Already exists.',
      details: { field: 'email' },
      requestId: 'req-123',
    });
  });

  it('uses the default status and catalogue message for a bare AppError', async () => {
    const { res, host, filter } = createMocks();

    await filter.catch(new AppError(ErrorCode.FORBIDDEN), host);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sentBody(res)).toEqual({
      code: 'FORBIDDEN',
      message: ERROR_MESSAGES[ErrorCode.FORBIDDEN],
      details: null,
      requestId: 'req-123',
    });
  });

  it('renders validation errors as 400 VALIDATION_ERROR with field-level details', async () => {
    const { res, host, filter } = createMocks();
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: validationExceptionFactory,
    });

    let thrown: unknown;
    try {
      await pipe.transform(
        { email: 'not-an-email', count: 0, extra: 'x' },
        { type: 'body', metatype: SampleDto },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);

    await filter.catch(thrown, host);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = sentBody(res);
    expectStandardShape(body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.requestId).toBe('req-123');
    const details = body.details as Array<{ field: string; constraints: Record<string, string> }>;
    const byField = Object.fromEntries(details.map((d) => [d.field, d.constraints]));
    expect(Object.keys(byField).sort()).toEqual(['count', 'email', 'extra']);
    expect(byField.email).toHaveProperty('isEmail');
    expect(byField.count).toHaveProperty('min');
    expect(byField.extra).toHaveProperty('whitelistValidation');
  });

  it('maps framework HttpExceptions to catalogue codes and messages', async () => {
    const { res, host, filter } = createMocks();

    await filter.catch(new NotFoundException('Cannot GET /secret-internal-path'), host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sentBody(res)).toEqual({
      code: 'NOT_FOUND',
      message: ERROR_MESSAGES[ErrorCode.NOT_FOUND],
      details: null,
      requestId: 'req-123',
    });
  });

  it('maps a generic 400 HttpException to BAD_REQUEST', async () => {
    const { res, host, filter } = createMocks();

    await filter.catch(new BadRequestException('driver said something'), host);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sentBody(res).code).toBe('BAD_REQUEST');
  });

  it('renders unknown errors as 500 INTERNAL_ERROR without leaking internals', async () => {
    const { res, host, filter, logger } = createMocks();
    const error = new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');

    await filter.catch(error, host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = sentBody(res);
    expectStandardShape(body);
    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: ERROR_MESSAGES[ErrorCode.INTERNAL_ERROR],
      details: null,
      requestId: 'req-123',
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain(error.stack!.split('\n')[1].trim());
    expect(serialized).not.toMatch(/at .+\(.+:\d+:\d+\)/);

    // ...but the full error is logged server-side.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, status: 500, code: 'INTERNAL_ERROR' }),
      'Unhandled exception',
    );
  });

  it('treats thrown non-Error values as unknown errors', async () => {
    const { res, host, filter } = createMocks();

    await filter.catch('a plain string', host);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(sentBody(res).code).toBe('INTERNAL_ERROR');
  });

  it('records a possible denial before the response is sent', async () => {
    const { req, res, host, filter, denials } = createMocks();
    const order: string[] = [];
    denials.recordHttp.mockImplementation(() => {
      order.push('recorded');
      return Promise.resolve();
    });
    res.json.mockImplementation(() => {
      order.push('responded');
      return res;
    });
    const error = new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'role_not_permitted' } });
    await filter.catch(error, host);
    expect(denials.recordHttp).toHaveBeenCalledWith(error, req);
    expect(order).toEqual(['recorded', 'responded']);
  });

  it('does not write a response when headers were already sent', async () => {
    const { res, host, filter, logger } = createMocks();
    res.headersSent = true;

    await filter.catch(new Error('late failure'), host);

    expect(res.json).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
