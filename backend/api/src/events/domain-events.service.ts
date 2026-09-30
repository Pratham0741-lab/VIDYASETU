import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { DomainEventName, DomainEventPayloads } from './domain-events';

interface Pending {
  name: DomainEventName;
  payload: unknown;
}

/**
 * Records domain events so they are emitted only after the writing
 * transaction commits.
 *
 *   Inside an HTTP request: buffered in this service's own AsyncLocalStorage
 *   (not Phase 2's RequestContext) and flushed by DomainEventsInterceptor
 *   after the request's actor transaction has committed; discarded if the
 *   request fails (the transaction rolled back).
 *   Outside a request (the document pipeline worker): emitted at once; the
 *   worker records only after its SYSTEM transaction has returned.
 *
 * Emission never throws into the caller: listeners are async and a failing
 * listener is logged, not propagated.
 */
@Injectable()
export class DomainEvents {
  private readonly buffers = new AsyncLocalStorage<Pending[]>();

  constructor(
    private readonly emitter: EventEmitter2,
    @InjectPinoLogger(DomainEvents.name) private readonly logger: PinoLogger,
  ) {}

  record<N extends DomainEventName>(name: N, payload: DomainEventPayloads[N]): void {
    const buffer = this.buffers.getStore();
    if (buffer) buffer.push({ name, payload });
    else this.emit({ name, payload });
  }

  /** Runs `work` with a fresh buffer (used by DomainEventsInterceptor). */
  withBuffer<T>(buffer: Pending[], work: () => T): T {
    return this.buffers.run(buffer, work);
  }

  flush(buffer: Pending[]): void {
    for (const pending of buffer.splice(0)) this.emit(pending);
  }

  discard(buffer: Pending[]): void {
    const dropped = buffer.splice(0).map((p) => p.name);
    if (dropped.length > 0) {
      this.logger.debug({ dropped }, 'domain events discarded: request failed, nothing committed');
    }
  }

  private emit({ name, payload }: Pending): void {
    try {
      this.emitter.emit(name, payload);
    } catch (err) {
      this.logger.error({ err, event: name }, 'domain event listener failed');
    }
  }
}

export type { Pending as PendingDomainEvent };
