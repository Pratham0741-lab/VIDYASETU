// Phase 17 D (M32): an AUDITOR write attempted THROUGH APPLICATION CODE is refused by the
// database, and the refusal is recorded as an authorization denial. Runs inside the api
// container against the compiled app: the real ActorTransactionRunner (the same one the
// global interceptor uses) + the real NotificationsService / OfficerPreferencesService
// (routes the API already closes to AUDITOR - this simulates a guard that let it through).
// Control: the same calls as the SNO succeed.
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('/app/dist/app.module');
const { ActorTransactionRunner } = require('/app/dist/database/actor-transaction.runner');
const { NotificationsService } = require('/app/dist/notifications/notifications.service');
const { DenialRecorder } = require('/app/dist/authorization-denials/denial-recorder.service');
const { PrismaService } = require('/app/dist/prisma/prisma.service');
const { DbContext } = require('/app/dist/database/db-context');

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(), { logger: false });
  const prisma = app.get(PrismaService, { strict: false });
  const runner = app.get(ActorTransactionRunner, { strict: false });
  const notifications = app.get(NotificationsService, { strict: false });
  const denials = app.get(DenialRecorder, { strict: false });
  const db = app.get(DbContext, { strict: false });

  const actorFor = async (email) => {
    const o = await prisma.officer.findFirst({
      where: { email },
      select: { id: true, user_id: true, jurisdiction_state: true, jurisdiction_district: true, role: { select: { name: true } } },
    });
    return { accountId: o.user_id, role: o.role.name, officerId: o.id, jurisdictionState: o.jurisdiction_state, jurisdictionDistrict: o.jurisdiction_district };
  };
  const auditor = await actorFor('auditor.jharkhand.p11@example.org');
  const sno = await actorFor('sno.jharkhand.p11@example.org');
  // Ids / filters that match no row: nothing is changed by the control, and the statement-level
  // trigger still fires for the AUDITOR (it refuses the statement, not rows).
  const noteOf = async () => '00000000-0000-4000-8000-00000000d17d';

  for (const [who, actor] of [['SNO (control)', sno], ['AUDITOR', auditor]]) {
    const id = await noteOf(actor);
    try {
      const r = await runner.run(actor, '127.0.0.1', () => notifications.markRead(actor.accountId, id));
      console.log(`${who.padEnd(14)} markRead via ActorTransactionRunner -> OK ${JSON.stringify(r)}`);
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        console.log(`${who.padEnd(14)} markRead via ActorTransactionRunner -> passed the database, AppError NOT_FOUND (no such notification)`);
      } else {
      const text = String(err.message).split('\n').filter((l) => /AUDITOR_READ_ONLY|Code:/.test(l)).join(' | ');
      console.log(`${who.padEnd(14)} markRead via ActorTransactionRunner -> REFUSED ${err.constructor.name} code=${err.code ?? '-'} :: ${text}`);
      // What the global exception filter does with it (same method, fake request).
      await denials.recordHttp(err, {
        method: 'POST', baseUrl: '', route: { path: '/api/v1/notifications/:id/read' },
        params: { id }, headers: {}, ip: '127.0.0.1', actor, id: 'p17-d-auditor-app',
      });
      }
    }
    try {
      await runner.run(actor, '127.0.0.1', () =>
        db.client.officerPreference.updateMany({ where: { officer_id: actor.officerId, preferred_language: 'none' }, data: { preferred_language: 'en' } }));
      console.log(`${who.padEnd(14)} officer_preferences updateMany    -> OK (0 rows matched)`);
    } catch (err) {
      console.log(`${who.padEnd(14)} officer_preferences updateMany    -> REFUSED ${(String(err.message).match(/AUDITOR_READ_ONLY[^\n"]*/) ?? ['?'])[0]}`);
    }
  }
  // Denial rows are counted by the caller as the DB owner (authorization_denials has RLS).
  await app.close();
  process.exit(0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
