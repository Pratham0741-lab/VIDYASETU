/**
 * Live proof for authorization_denials (proofs 4, 5, 7). NOT part of the e2e
 * suite (its name does not match test/jest-e2e.json's testRegex); run only
 * explicitly, against a real database:
 *   npx jest --config test/jest-e2e.json --testRegex 'denial-probe\.proof\.ts$'
 * Boots the real AppModule from process.env plus the test-only
 * DenialProbeController (the Phase 0 test-support pattern), logs in real
 * users over HTTP and prints every response. Records nothing itself.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DenialProbeController } from './support/denial-probe.controller';

const need = (k: string): string => {
  // Live probe of a real deployment: its inputs are the container's environment
  // (AppModule.forRoot() reads the same process.env for the app itself).
  // eslint-disable-next-line no-restricted-properties
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};

describe('authorization_denials live probe', () => {
  let app: NestExpressApplication;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot()],
      controllers: [DenialProbeController], // test-only; never in the production AppModule
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    for (const key of ['PROBE_OFFICER_EMAIL', 'PROBE_ADMIN_EMAIL']) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: need(key), password: need('PROBE_PASSWORD') });
      tokens[key] = res.body.access_token as string;
    }
  }, 60_000);

  afterAll(() => app.close());

  const post = async (label: string, path: string, who: string) => {
    const t0 = Date.now();
    const res = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('x-request-id', `probe-${label}`);
    console.log(
      `[${label}] POST ${path} as ${need(who)} -> HTTP ${res.status} in ${Date.now() - t0} ms\n` +
        `  body: ${JSON.stringify(res.body)}`,
    );
    return res;
  };

  it('proof 7: a new guarded route refuses the wrong role (and allows the right one)', async () => {
    const denied = await post(
      'p7-wrong-role',
      '/test/denial-probe/role-guarded',
      'PROBE_OFFICER_EMAIL',
    );
    expect(denied.status).toBe(403);
    const allowed = await post(
      'p7-control',
      '/test/denial-probe/role-guarded',
      'PROBE_ADMIN_EMAIL',
    );
    expect(allowed.status).toBe(200);
  });

  it('proof 4: workflow_system_transition bypass attempt (real actor_id, role SYSTEM)', async () => {
    const id = need('PROBE_APPLICATION_ID');
    const res = await post(
      'p4-workflow',
      `/test/denial-probe/applications/${id}/workflow-system-transition`,
      'PROBE_OFFICER_EMAIL',
    );
    expect(res.status).toBe(500);
  });

  it('proof 5: document_system_flag_application bypass attempt (real actor_id, role SYSTEM)', async () => {
    const id = need('PROBE_APPLICATION_ID');
    const res = await post(
      'p5-document',
      `/test/denial-probe/applications/${id}/document-flag`,
      'PROBE_OFFICER_EMAIL',
    );
    expect(res.status).toBe(500);
  });
});
