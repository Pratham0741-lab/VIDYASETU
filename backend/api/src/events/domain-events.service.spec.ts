import { EventEmitter2 } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, DocumentQualityRejectedEvent } from './domain-events';
import { DomainEvents, PendingDomainEvent } from './domain-events.service';

const payload = { document_id: 'd1' } as DocumentQualityRejectedEvent;

describe('DomainEvents', () => {
  let emitter: EventEmitter2;
  let events: DomainEvents;
  let received: unknown[];
  beforeEach(() => {
    emitter = new EventEmitter2();
    events = new DomainEvents(emitter, { debug: jest.fn(), error: jest.fn() } as never);
    received = [];
    emitter.on(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, (p: unknown) => received.push(p));
  });

  it('inside a request buffer: nothing is emitted until flush', () => {
    const buffer: PendingDomainEvent[] = [];
    events.withBuffer(buffer, () =>
      events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, payload),
    );
    expect(received).toEqual([]);
    events.flush(buffer);
    expect(received).toEqual([payload]);
    events.flush(buffer); // flushed once only
    expect(received).toHaveLength(1);
  });

  it('a discarded buffer (failed request, rolled back) never emits', () => {
    const buffer: PendingDomainEvent[] = [];
    events.withBuffer(buffer, () =>
      events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, payload),
    );
    events.discard(buffer);
    events.flush(buffer);
    expect(received).toEqual([]);
  });

  it('outside any request (the worker, after its commit) emits immediately', () => {
    events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, payload);
    expect(received).toEqual([payload]);
  });

  it('a throwing listener never propagates to the writer', () => {
    emitter.on(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, () => {
      throw new Error('listener bug');
    });
    expect(() => events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, payload)).not.toThrow();
  });
});
