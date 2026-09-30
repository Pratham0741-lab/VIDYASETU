import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';
import {
  RequestContextMiddleware,
  RequestIdMiddleware,
  resolveRequestId,
} from './request-id.middleware';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function run(headers: Record<string, string | string[] | undefined>) {
  const req = { headers } as unknown as Request;
  const res = { setHeader: jest.fn() };
  const next = jest.fn() as NextFunction;
  new RequestIdMiddleware().use(req, res as unknown as Response, next);
  return { req, res, next };
}

describe('RequestIdMiddleware', () => {
  it('generates a UUID v4 when no X-Request-ID is supplied', () => {
    const { req, res, next } = run({});

    expect(req.id).toMatch(UUID_V4);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a different ID for each request', () => {
    expect(run({}).req.id).not.toEqual(run({}).req.id);
  });

  it('preserves a supplied X-Request-ID', () => {
    const { req, res, next } = run({ 'x-request-id': 'client-trace-42' });

    expect(req.id).toBe('client-trace-42');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'client-trace-42');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsafe supplied ID (header injection, oversize) with a UUID', () => {
    expect(resolveRequestId('bad id\r\nX-Evil: 1')).toMatch(UUID_V4);
    expect(resolveRequestId('a'.repeat(129))).toMatch(UUID_V4);
    expect(resolveRequestId('')).toMatch(UUID_V4);
  });

  it('uses the first value when the header is repeated', () => {
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });
});

describe('RequestContextMiddleware', () => {
  it('exposes the request ID through RequestContext for downstream code', () => {
    const req = { id: 'ctx-id-1', headers: {} } as unknown as Request;
    let seen: string | undefined;

    new RequestContextMiddleware().use(req, {} as Response, () => {
      seen = RequestContext.requestId();
    });

    expect(seen).toBe('ctx-id-1');
    expect(RequestContext.requestId()).toBeUndefined();
  });
});
