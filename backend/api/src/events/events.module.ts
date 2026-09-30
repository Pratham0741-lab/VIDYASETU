import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventsInterceptor } from './domain-events.interceptor';
import { DomainEvents } from './domain-events.service';

/**
 * Domain events. Import BEFORE DatabaseModule in AppModule: its global
 * interceptor must wrap the actor-transaction interceptor (see
 * DomainEventsInterceptor and test/domain-events.e2e-spec.ts).
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false })],
  providers: [DomainEvents, { provide: APP_INTERCEPTOR, useClass: DomainEventsInterceptor }],
  exports: [DomainEvents],
})
export class EventsModule {}
