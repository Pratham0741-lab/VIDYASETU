import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../../auth/actor';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code.enum';
import { AppConfigService } from '../../config/app-config.service';
import { DbContext } from '../../database/db-context';
import { MATCH_KEY_VERSION, normalizeIdentifier } from '../../fraud/fraud-match';
import { AadhaarAdapter } from './aadhaar.adapter';
import { AADHAAR_MESSAGES } from './aadhaar-messages';
import { verhoeffValid } from './verhoeff';

const en = (key: string) => AADHAAR_MESSAGES.en[key] ?? key;

/**
 * The Aadhaar number, normalised the way the fraud index normalises every
 * identifier (fraud-match.ts: NFKC, any script's digits to ASCII, separators
 * removed - so "0999 0000 0017" and "0999-0000-0017" are one number), then
 * checked: 12 digits and a valid Verhoeff check digit. Null when invalid.
 */
export function normaliseAadhaar(input: string): string | null {
  const n = normalizeIdentifier('certificate_number', input); // the field is not used by the normaliser
  return /^[0-9]{12}$/.test(n) && verhoeffValid(n) ? n : null;
}

/**
 * Keyed hash of the normalised number: HMAC-SHA256(FRAUD_MATCH_KEY,
 * "aadhaar" || 0x00 || number) - the fraud index's construction and key,
 * with its own field prefix so it can never equal another field's hash.
 * Keyed, not plain: 12 digits are brute-forceable from a plain hash.
 */
export function aadhaarHmac(keyBase64: string, uid: string): string {
  return createHmac('sha256', Buffer.from(keyBase64, 'base64'))
    .update(`aadhaar\u0000${uid}`, 'utf8')
    .digest('hex');
}

const SELECT = {
  id: true,
  outcome: true,
  error_code: true,
  uid_last4: true,
  adapter_mode: true,
  txn_id: true,
  consent_given_at: true,
  created_at: true,
} as const;

/**
 * Aadhaar authentication of the calling applicant (Phase 14 loose ends,
 * Part E), through the AadhaarAdapter interface only (AADHAAR_MODE, default
 * mock; real is not configured and fails closed).
 *
 * The Aadhaar number is never stored, returned or logged: it lives in this
 * request's memory only. What is stored (aadhaar_authentications, owner-only
 * RLS, audited) is the outcome, the keyed hash of the normalised number, its
 * last four digits (the UIDAI masked form) and the transaction id.
 */
@Injectable()
export class AadhaarAuthenticationService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    private readonly adapter: AadhaarAdapter,
    @InjectPinoLogger(AadhaarAuthenticationService.name) private readonly logger: PinoLogger,
  ) {}

  private async applicant(actor: Actor) {
    const a = await this.db.client.applicant.findUnique({
      where: { user_id: actor.accountId },
      select: { id: true, first_name: true, last_name: true },
    });
    if (!a) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_applicant_profile' } });
    }
    return a;
  }

  async authenticate(actor: Actor, aadhaarNumber: string, consent: boolean) {
    if (consent !== true) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'consent',
            message_key: 'aadhaar.consent_required',
            constraints: { consent: en('aadhaar.consent_required') },
          },
        ],
      });
    }
    const uid = normaliseAadhaar(aadhaarNumber);
    if (!uid) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'aadhaar_number',
            message_key: 'aadhaar.invalid_number',
            constraints: { aadhaar: en('aadhaar.invalid_number') },
          },
        ],
      });
    }
    const a = await this.applicant(actor);
    const consentAt = new Date();
    let result;
    try {
      result = await this.adapter.authenticate({
        uid,
        name: `${a.first_name} ${a.last_name}`,
        consent: true,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.DEPENDENCY_UNAVAILABLE) {
        const d = (err.details ?? {}) as Record<string, unknown>;
        this.logger.warn({ reason: d.reason ?? null, mode: d.mode ?? null }, 'aadhaar unavailable');
        throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
          details: {
            ...d,
            message_key: d.reason === 'timeout' ? 'aadhaar.timeout' : 'aadhaar.unavailable',
            stored: false,
          },
        });
      }
      throw err;
    }
    const row = await this.db.client.aadhaarAuthentication.create({
      data: {
        applicant_id: a.id,
        outcome: result.status,
        error_code: result.status === 'NOT_AUTHENTICATED' ? result.error_code : null,
        uid_hmac: aadhaarHmac(this.config.fraud.matchKeyBase64, uid),
        uid_last4: uid.slice(-4),
        hmac_key_version: MATCH_KEY_VERSION,
        adapter_mode: this.config.integrations.aadhaar.mode,
        txn_id: result.txn_id,
        consent_given_at: consentAt,
      },
      select: SELECT,
    });
    this.logger.info(
      { aadhaarAuthenticationId: row.id, outcome: row.outcome },
      'aadhaar authentication',
    );
    return this.view(row);
  }

  async latest(actor: Actor) {
    const a = await this.applicant(actor);
    const row = await this.db.client.aadhaarAuthentication.findFirst({
      where: { applicant_id: a.id },
      select: SELECT,
      orderBy: { created_at: 'desc' },
    });
    return row ? this.view(row) : { authentication: null };
  }

  private view(row: {
    id: string;
    outcome: string;
    error_code: string | null;
    uid_last4: string;
    adapter_mode: string;
    txn_id: string;
    consent_given_at: Date;
    created_at: Date;
  }) {
    const key = row.error_code
      ? `aadhaar.error.${row.error_code}`
      : `aadhaar.outcome.${row.outcome}`;
    return {
      authentication: {
        id: row.id,
        outcome: row.outcome,
        error_code: row.error_code,
        message_key: key,
        message: en(key),
        aadhaar_masked: `XXXX XXXX ${row.uid_last4}`,
        adapter_mode: row.adapter_mode,
        txn_id: row.txn_id,
        consent_given_at: row.consent_given_at.toISOString(),
        at: row.created_at.toISOString(),
      },
    };
  }
}
