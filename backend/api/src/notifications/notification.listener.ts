import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RequestContext } from '../common/context/request-context';
import { DbContext } from '../database/db-context';
import {
  DOMAIN_EVENTS,
  DeficiencyIssuedEvent,
  SelectionListPublishedEvent,
  DocumentConsistencyEvaluatedEvent,
  DocumentEligibilityMismatchEvent,
  DocumentNeedsReviewEvent,
  DocumentQualityRejectedEvent,
  GrievanceStatusChangedEvent,
  SelectionRunCompletedEvent,
  SlaBreachedEvent,
  CorrectionDecidedEvent,
  WorkflowTransitionEvent,
} from '../events/domain-events';
import { NotificationDispatcher } from './notification-dispatcher';
import {
  consistencyIntents,
  deficiencyIntents,
  grievanceIntents,
  mismatchIntents,
  needsReviewIntents,
  NotificationIntent,
  qualityRejectedIntents,
  selectionIntents,
  selectionListIntents,
  slaBreachIntents,
  correctionIntents,
  workflowIntents,
} from './notification-intents';

const ASYNC = { async: true, promisify: true, suppressErrors: true } as const;

const CONSISTENCY_STATUS_OF: Record<string, 'CONSISTENT' | 'INCONSISTENT' | 'UNCERTAIN'> = {
  'officer.documents_inconsistent': 'INCONSISTENT',
  'officer.documents_consistency_uncertain': 'UNCERTAIN',
  'officer.documents_now_consistent': 'CONSISTENT',
};

/**
 * Consumes domain events; never touches the services that emit them.
 * Async and error-suppressing: a notification failure can never affect the
 * write that caused it (which has already committed).
 */
@Injectable()
export class NotificationListener {
  constructor(
    private readonly dispatcher: NotificationDispatcher,
    private readonly db: DbContext,
    @InjectPinoLogger(NotificationListener.name) private readonly logger: PinoLogger,
  ) {}

  @OnEvent(DOMAIN_EVENTS.WORKFLOW_TRANSITION, ASYNC)
  onTransition(e: WorkflowTransitionEvent) {
    return this.send(workflowIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, ASYNC)
  onQualityRejected(e: DocumentQualityRejectedEvent) {
    return this.send(qualityRejectedIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.DOCUMENT_NEEDS_REVIEW, ASYNC)
  onNeedsReview(e: DocumentNeedsReviewEvent) {
    return this.send(needsReviewIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.DOCUMENT_CONSISTENCY_EVALUATED, ASYNC)
  onConsistency(e: DocumentConsistencyEvaluatedEvent) {
    return this.send(consistencyIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH, ASYNC)
  onMismatch(e: DocumentEligibilityMismatchEvent) {
    return this.send(mismatchIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.SELECTION_RUN_COMPLETED, ASYNC)
  onSelection(e: SelectionRunCompletedEvent) {
    return this.send(selectionIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.DEFICIENCY_ISSUED, ASYNC)
  onDeficiency(e: DeficiencyIssuedEvent) {
    return this.send(deficiencyIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.SELECTION_LIST_PUBLISHED, ASYNC)
  onSelectionList(e: SelectionListPublishedEvent) {
    return this.send(selectionListIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.CORRECTION_DECIDED, ASYNC)
  onCorrection(e: CorrectionDecidedEvent) {
    return this.send(correctionIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.SLA_BREACHED, ASYNC)
  onSlaBreach(e: SlaBreachedEvent) {
    return this.send(slaBreachIntents(e));
  }

  @OnEvent(DOMAIN_EVENTS.GRIEVANCE_STATUS_CHANGED, ASYNC)
  onGrievance(e: GrievanceStatusChangedEvent) {
    return this.send(grievanceIntents(e));
  }

  /**
   * Runs in a FRESH request context (no actor, no transaction): an event
   * flushed after a request would otherwise inherit that request's context,
   * whose transaction client is already closed.
   */
  private send(intents: NotificationIntent[]): Promise<void> {
    const requestId = RequestContext.requestId() ?? '';
    return RequestContext.run({ requestId }, async () => {
      for (const intent of intents) {
        try {
          if (await this.isDuplicateConsistency(intent)) continue;
          await this.dispatcher.dispatch(intent);
        } catch (err) {
          this.logger.error({ err, template: intent.template_key }, 'notification dispatch failed');
        }
      }
    });
  }

  /**
   * Consistency de-duplication (Phase 8 decision 1), using the notifications
   * table as the record: compare with the most recent consistency
   * notification for this application.
   *   INCONSISTENT / UNCERTAIN: skip if the last one had the same status.
   *   CONSISTENT: send "now consistent" only if the last one was an alert.
   */
  private async isDuplicateConsistency(intent: NotificationIntent): Promise<boolean> {
    if (!intent.consistency_status || !intent.application_id) return false;
    const last = await this.db.client.notification.findFirst({
      where: {
        application_id: intent.application_id,
        event_type: DOMAIN_EVENTS.DOCUMENT_CONSISTENCY_EVALUATED,
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { template_key: true },
    });
    const lastStatus = last ? CONSISTENCY_STATUS_OF[last.template_key] : null;
    const duplicate =
      intent.consistency_status === 'CONSISTENT'
        ? lastStatus !== 'INCONSISTENT' && lastStatus !== 'UNCERTAIN'
        : lastStatus === intent.consistency_status;
    if (duplicate) {
      this.logger.info(
        { applicationId: intent.application_id, status: intent.consistency_status, lastStatus },
        'consistency notification suppressed (no status change since the last one sent)',
      );
    }
    return duplicate;
  }
}
