import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './support/create-test-app';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function expectStandardErrorShape(body: Record<string, unknown>): void {
  expect(Object.keys(body).sort()).toEqual(['code', 'details', 'message', 'requestId']);
  expect(typeof body.code).toBe('string');
  expect(typeof body.message).toBe('string');
  expect(typeof body.requestId).toBe('string');
  expect((body.requestId as string).length).toBeGreaterThan(0);
}

describe('VIDYASETU API (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('returns 200 without checking dependencies', async () => {
      const res = await request(app.getHttpServer()).get('/health/live').expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['x-request-id']).toMatch(UUID_V4);
    });
  });

  describe('unknown routes', () => {
    it('return 404 in the standard error shape with a requestId', async () => {
      const res = await request(app.getHttpServer()).get('/does/not/exist').expect(404);

      expectStandardErrorShape(res.body);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.details).toBeNull();
      expect(res.body.requestId).toBe(res.headers['x-request-id']);
      expect(JSON.stringify(res.body)).not.toContain('/does/not/exist');
    });
  });

  describe('request IDs', () => {
    it('echo a supplied X-Request-ID in the response header', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/live')
        .set('X-Request-ID', 'e2e-trace-0001')
        .expect(200);

      expect(res.headers['x-request-id']).toBe('e2e-trace-0001');
    });

    it('echo a supplied X-Request-ID in error bodies too', async () => {
      const res = await request(app.getHttpServer())
        .get('/nope')
        .set('X-Request-ID', 'e2e-trace-0002')
        .expect(404);

      expect(res.headers['x-request-id']).toBe('e2e-trace-0002');
      expect(res.body.requestId).toBe('e2e-trace-0002');
    });
  });

  describe('validation (test-only route)', () => {
    const valid = {
      name: 'Asha',
      email: 'asha@example.org',
      quantity: 3,
      address: { pincode: '834001' },
    };

    it('accepts and transforms a valid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/__test__/validation')
        .send(valid)
        .expect(200);

      expect(res.body.received).toEqual(valid);
      expect(res.body.quantityType).toBe('number');
    });

    it('rejects an invalid body with 400 VALIDATION_ERROR and field-level details', async () => {
      const res = await request(app.getHttpServer())
        .post('/__test__/validation')
        .set('X-Request-ID', 'e2e-validation-1')
        .send({
          name: 'A',
          email: 'nope',
          quantity: 99,
          address: { pincode: '1' },
          isAdmin: true,
        })
        .expect(400);

      expectStandardErrorShape(res.body);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.requestId).toBe('e2e-validation-1');

      const details = res.body.details as Array<{
        field: string;
        constraints: Record<string, string>;
      }>;
      const byField = Object.fromEntries(details.map((d) => [d.field, d.constraints]));
      expect(Object.keys(byField).sort()).toEqual([
        'address.pincode',
        'email',
        'isAdmin',
        'name',
        'quantity',
      ]);
      expect(byField.email).toHaveProperty('isEmail');
      expect(byField.quantity).toHaveProperty('max');
      expect(byField['address.pincode']).toHaveProperty('minLength');
      expect(byField.isAdmin).toHaveProperty('whitelistValidation');
    });

    it('rejects malformed JSON in the standard shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/__test__/validation')
        .set('Content-Type', 'application/json')
        .set('X-Request-ID', 'e2e-bad-json')
        .send('{"name": ')
        .expect(400);

      expectStandardErrorShape(res.body);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.requestId).toBe('e2e-bad-json');
      expect(res.headers['x-request-id']).toBe('e2e-bad-json');
    });
  });

  describe('GET /health/ready', () => {
    it('returns 503 DEPENDENCY_UNAVAILABLE with per-dependency status when dependencies are down', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready').expect(503);

      expectStandardErrorShape(res.body);
      expect(res.body.code).toBe('DEPENDENCY_UNAVAILABLE');
      const details = res.body.details as Record<string, { status: string }>;
      expect(Object.keys(details).sort()).toEqual(['database', 'ml', 'redis', 'storage']);
      for (const name of Object.keys(details)) {
        expect(details[name].status).toBe('down');
      }
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    });
  });

  describe('security headers', () => {
    it('sets helmet headers and allows only configured CORS origins', async () => {
      const allowed = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', 'http://localhost:5173')
        .expect(200);
      expect(allowed.headers['x-content-type-options']).toBe('nosniff');
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

      const denied = await request(app.getHttpServer())
        .get('/health/live')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
