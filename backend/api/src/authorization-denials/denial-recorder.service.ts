import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { RequestContext } from '../common/context/request-context';
import { requestIdOf } from '../common/middleware/request-id.middleware';
import { DenialTransactionRunner } from '../database/denial-transaction.runner';
import { SYSTEM } from '../workflow/vidyasetu-workflow';
import { classifyDenial, DenialDescriptor } from './denial-classifier';

type RequestWithActor = Request & { actor?: Actor };

export interface JobFailure {
  queue: string;
  jobId: string | null;
  attempt: number | null;
  requestId: string | null;
  subjectType: string | null;
  subjectId: string | null;
}

/**
 * Writes authorization_denials rows. One classifier (denial-classifier.ts),
 * one write path, two origins:
 *   - HTTP: called by the global AllExceptionsFilter for every error, before
 *     the response is sent;
 *   - background jobs: called from the worker's failure handler.
 * Call sites never decide what is a denial.
 *
 * The write is a FRESH transaction (DenialTransactionRunner), independent of
 * the refused request's own (which has rolled back, or for a guard rejection
 * was never opened), carrying the same app.actor_id / app.actor_role /
 * app.request_ip the request had - so record_authorization_denial() resolves
 * the actor exactly as the audit trigger does. A job is attributed to the
 * SYSTEM actor, as the worker itself runs.
 * Never throws: failing to record is logged at error level, and the refusal
 * the caller is about to return is unaffected.
 */
@Injectable()
export class DenialRecorder {
  constructor(
    private readonly tx: DenialTransactionRunner,
    @InjectPinoLogger(DenialRecorder.name) private readonly logger: PinoLogger,
  ) {}

  /** For the global exception filter. Resolves once the row is written (or skipped). */
  async recordHttp(exception: unknown, req: Request): Promise<void> {
    const route = (req as { route?: { path?: unknown } }).route?.path;
    const denial = classifyDenial(exception, {
      kind: 'http',
      method: req.method,
      route: typeof route === 'string' ? `${req.baseUrl ?? ''}${route}` : null,
      params: stringParams(req.params),
    });
    if (!denial) return;

    const actor = (req as RequestWithActor).actor;
    const requestId = requestIdOf(req);
    const ip = req.ip ?? req.socket?.remoteAddress ?? null;
    await this.write(denial, (work) =>
      this.tx.run(
        actor ? { kind: 'actor', accountId: actor.accountId, role: actor.role } : { kind: 'none' },
        ip,
        requestId,
        work,
      ),
    );
  }

  /** For a background worker's failure handler. */
  async recordJob(exception: unknown, job: JobFailure): Promise<void> {
    const denial = classifyDenial(exception, {
      kind: 'job',
      queue: job.queue,
      jobId: job.jobId,
      attempt: job.attempt,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
    });
    if (!denial) return;
    await this.write(denial, (work) =>
      this.tx.run({ kind: 'system', role: SYSTEM }, null, job.requestId ?? '', work),
    );
  }

  private async write(
    denial: DenialDescriptor,
    inFreshTransaction: (work: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    try {
      await inFreshTransaction(async () => {
        const db = RequestContext.db()!;
        await db.$queryRaw`SELECT record_authorization_denial(
          ${denial.action_attempted}, ${denial.subject_type}, ${denial.subject_id},
          ${denial.denial_reason}, ${JSON.stringify(denial.details)}::jsonb,
          ${RequestContext.requestId() ?? ''}
        )::text AS id`;
      });
    } catch (err) {
      this.logger.error(
        {
          err,
          denial_reason: denial.denial_reason,
          action_attempted: denial.action_attempted,
          subject_type: denial.subject_type,
          subject_id: denial.subject_id,
        },
        'authorization denial could not be recorded',
      );
    }
  }
}

function stringParams(params: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
  }
  return out;
}
