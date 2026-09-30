import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code.enum';
import { AppConfigService } from '../../config/app-config.service';
import { AdapterAvailability, IntegrationAdapter, notConfigured } from '../integration-adapter';

/**
 * PFMS / DBT adapter (Phase 10) - formalises Phase 9's stand-in
 * (src/integrations/pfms-standin, now removed) with the same two operations
 * and the same boundary: no bank-account data crosses it; the beneficiary is
 * named by application only (the real PFMS resolves the payee from its own
 * beneficiary registration).
 */
export interface PfmsDisbursementRequest {
  /** Our disbursement id (idempotency key: a retried submission is the same payment). */
  disbursement_id: string;
  application_no: string;
  amount: number;
  currency: string;
  beneficiary_type: string;
  payment_mode: string;
}

export type PfmsStatus = 'PROCESSING' | 'SUCCESS' | 'FAILED';

/** The status report (PFMS status callback) - unchanged from Phase 9. */
export interface PfmsStatusReport {
  reference: string;
  status: PfmsStatus;
  utr_number: string | null;
  failure_reason: string | null;
  reported_at: string;
}

export abstract class PfmsAdapter implements IntegrationAdapter {
  readonly service = 'pfms';
  abstract checkAvailability(): Promise<AdapterAvailability>;
  /**
   * Submits a payment. Throws INSUFFICIENT_BALANCE (the paying account cannot
   * fund it; nothing was sent) or DEPENDENCY_UNAVAILABLE (PFMS / bank server
   * down or timed out; safe to retry with the same disbursement_id).
   */
  abstract initiateDisbursement(request: PfmsDisbursementRequest): Promise<{ reference: string }>;
  /** Current status. A payment the bank rejects later reports FAILED with a reason. */
  abstract checkStatus(reference: string): Promise<PfmsStatusReport>;
}

/** Mock scenarios, chosen per application_no by PFMS_MOCK_SCENARIOS; default SUCCESS. */
export const PFMS_MOCK_SCENARIOS = [
  'SUCCESS',
  'INSUFFICIENT_BALANCE',
  'ACCOUNT_INVALID',
  'TIMEOUT',
  'PENDING',
] as const;
export type PfmsMockScenario = (typeof PFMS_MOCK_SCENARIOS)[number];

/** How long a PENDING-scenario payment stays PROCESSING before it settles. */
export const PFMS_MOCK_PENDING_MS = 60_000;

const utrFor = (reference: string) =>
  `MOCKUTR${createHash('sha256').update(reference).digest('hex').slice(0, 12).toUpperCase()}`;

/**
 * MOCK: nothing leaves the process. The default scenario is exactly Phase 9's
 * stand-in (reference PFMS-MOCK-<uuid>, SUCCESS with a deterministic UTR).
 * Other scenarios are encoded in the reference, so status stays stateless
 * and survives restarts:
 *   INSUFFICIENT_BALANCE - initiate throws INSUFFICIENT_BALANCE (nothing sent)
 *   TIMEOUT              - initiate throws DEPENDENCY_UNAVAILABLE (bank server timeout)
 *   ACCOUNT_INVALID      - accepted; status FAILED (beneficiary account closed/invalid)
 *   PENDING              - accepted; PROCESSING for PFMS_MOCK_PENDING_MS, then SUCCESS
 */
@Injectable()
export class MockPfmsAdapter extends PfmsAdapter {
  constructor(
    private readonly config: AppConfigService,
    @InjectPinoLogger('MockPfmsAdapter') private readonly logger: PinoLogger,
  ) {
    super();
  }

  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: true, mode: 'mock' });
  }

  initiateDisbursement(request: PfmsDisbursementRequest): Promise<{ reference: string }> {
    const scenario = (this.config.integrations.pfms.mockScenarios[request.application_no] ??
      'SUCCESS') as PfmsMockScenario;
    if (scenario === 'INSUFFICIENT_BALANCE') {
      return Promise.reject(
        new AppError(ErrorCode.INSUFFICIENT_BALANCE, {
          details: { service: 'pfms', disbursement_id: request.disbursement_id, retryable: true },
        }),
      );
    }
    if (scenario === 'TIMEOUT') {
      return Promise.reject(
        new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
          details: {
            service: 'pfms',
            reason: 'bank_server_timeout',
            disbursement_id: request.disbursement_id,
            retryable: true,
          },
        }),
      );
    }
    const reference =
      scenario === 'ACCOUNT_INVALID'
        ? `PFMS-MOCK-ACINV-${randomUUID()}`
        : scenario === 'PENDING'
          ? `PFMS-MOCK-PEND-${Date.now()}-${randomUUID()}`
          : `PFMS-MOCK-${randomUUID()}`;
    this.logger.info(
      { pfms: { reference, disbursement_id: request.disbursement_id, currency: request.currency } },
      'MOCK PFMS payment accepted (no money moves)',
    );
    return Promise.resolve({ reference });
  }

  checkStatus(reference: string): Promise<PfmsStatusReport> {
    const reported_at = new Date().toISOString();
    if (reference.startsWith('PFMS-MOCK-ACINV-')) {
      return Promise.resolve({
        reference,
        status: 'FAILED',
        utr_number: null,
        failure_reason: 'BENEFICIARY_ACCOUNT_CLOSED_OR_INVALID',
        reported_at,
      });
    }
    const pending = /^PFMS-MOCK-PEND-(\d+)-/.exec(reference);
    if (pending && Date.now() - Number(pending[1]) < PFMS_MOCK_PENDING_MS) {
      return Promise.resolve({
        reference,
        status: 'PROCESSING',
        utr_number: null,
        failure_reason: null,
        reported_at,
      });
    }
    return Promise.resolve({
      reference,
      status: 'SUCCESS',
      utr_number: utrFor(reference),
      failure_reason: null,
      reported_at,
    });
  }
}

/** PFMS_MODE=real: not configured in this build (fails closed). */
@Injectable()
export class UnconfiguredPfmsAdapter extends PfmsAdapter {
  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: false, mode: 'real' });
  }
  initiateDisbursement(): Promise<{ reference: string }> {
    return Promise.reject(notConfigured(this.service));
  }
  checkStatus(): Promise<PfmsStatusReport> {
    return Promise.reject(notConfigured(this.service));
  }
}
