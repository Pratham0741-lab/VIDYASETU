import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DomainEvents, PendingDomainEvent } from './domain-events.service';

/**
 * Gives each HTTP request a domain-event buffer and flushes it only when the
 * rest of the pipeline completes successfully.
 *
 * It must be the OUTER of the two global interceptors, wrapping Phase 2's
 * ActorTransactionInterceptor (unchanged): then "the inner observable
 * completed" means "the actor transaction committed". EventsModule is
 * therefore imported before DatabaseModule, and
 * test/domain-events.e2e-spec.ts asserts the real registered order.
 * next.handle() is called inside the buffer's AsyncLocalStorage context so
 * the inner interceptor and the handler run within it.
 */
@Injectable()
export class DomainEventsInterceptor implements NestInterceptor {
  constructor(private readonly events: DomainEvents) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const buffer: PendingDomainEvent[] = [];
    return new Observable((subscriber) => {
      const subscription = this.events.withBuffer(buffer, () =>
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err: unknown) => {
            this.events.discard(buffer);
            subscriber.error(err);
          },
          complete: () => {
            this.events.flush(buffer);
            subscriber.complete();
          },
        }),
      );
      return () => subscription.unsubscribe();
    });
  }
}
