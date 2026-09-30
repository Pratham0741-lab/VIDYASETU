import { Controller, Get, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Actor } from '../src/auth/actor';
import { Roles } from '../src/auth/decorators';
import { AppRole } from '../src/auth/roles';
import { RequestContext } from '../src/common/context/request-context';
import { ActorTransactionRunner } from '../src/database/actor-transaction.runner';
import { DOMAIN_EVENTS, DocumentQualityRejectedEvent } from '../src/events/domain-events';
import { DomainEvents } from '../src/events/domain-events.service';
import { TEST_ENV } from './support/create-test-app';

/**
 * Proves, with the REAL global interceptor registration (Phase 2's
 * ActorTransactionInterceptor unchanged, only its runner stubbed to model
 * commit timing), that a domain event recorded inside a request reaches
 * listeners only after the transaction has committed, and never when the
 * request fails.
 */
let committed = false;
const timeline: string[] = [];

@Controller('test-events')
class EventTestController {
  constructor(private readonly events: DomainEvents) {}

  @Get('ok')
  @Roles(AppRole.APPLICANT)
  ok() {
    this.events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, {
      document_id: 'ok',
    } as DocumentQualityRejectedEvent);
    timeline.push('recorded');
    return { ok: true };
  }

  @Get('fail')
  @Roles(AppRole.APPLICANT)
  fail() {
    this.events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, {
      document_id: 'fail',
    } as DocumentQualityRejectedEvent);
    throw new Error('handler failed after recording');
  }
}

@Module({ controllers: [EventTestController] })
class EventTestModule {}

describe('domain events are emitted only after the actor transaction commits (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  const received: string[] = [];

  beforeAll(async () => {
    const runner = {
      run: async <T>(actor: Actor, _ip: string | null, work: () => Promise<T>) => {
        committed = false;
        const result = await RequestContext.run({ requestId: 't', actor }, work);
        await new Promise((r) => setTimeout(r, 25)); // the commit takes time
        committed = true;
        timeline.push('committed');
        return result;
      },
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot({ env: TEST_ENV }), EventTestModule],
    })
      .overrideProvider(ActorTransactionRunner)
      .useValue(runner)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    app
      .get(EventEmitter2)
      .on(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, (p: { document_id: string }) => {
        timeline.push(`emitted:${p.document_id}:committed=${committed}`);
        received.push(p.document_id);
      });
    token = app.get(JwtService).sign({
      sub: 'a0000000-0000-4000-8000-000000000001',
      role: AppRole.APPLICANT,
      officer_id: null,
      jurisdiction_state: null,
      jurisdiction_district: null,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('flushes after commit on success', async () => {
    timeline.length = 0;
    const res = await request(app.getHttpServer())
      .get('/test-events/ok')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(timeline).toEqual(['recorded', 'committed', 'emitted:ok:committed=true']);
  });

  it('never emits when the request fails (transaction rolled back)', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-events/fail')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(received).not.toContain('fail');
  });
});
