import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code.enum';
import { nameKey } from '../nsp/nsp.adapter';
import { AdapterAvailability, IntegrationAdapter, notConfigured } from '../integration-adapter';

/**
 * Aadhaar authentication (Phase 14 loose ends, Part E; plan Phase 15):
 * demographic authentication of a 12-digit Aadhaar number against the
 * holder's name, with the holder's consent - the yes / no answer an
 * authentication user agency receives. No e-KYC: no identity data comes back.
 *
 * The caller passes the NORMALISED number (12 ASCII digits, checksum
 * already verified) and never stores or logs it (AadhaarAuthenticationService).
 */
export interface AadhaarAuthRequest {
  uid: string;
  name: string;
  consent: true;
}

export type AadhaarAuthResult =
  | {
      status: 'AUTHENTICATED';
      txn_id: string;
      auth_code: string;
      responded_at: string;
    }
  | {
      status: 'NOT_AUTHENTICATED';
      txn_id: string;
      /** UIDAI-style error code: 100 demographic mismatch, 998 number not available. */
      error_code: '100' | '998';
      responded_at: string;
    };

export abstract class AadhaarAdapter implements IntegrationAdapter {
  readonly service = 'aadhaar';
  abstract checkAvailability(): Promise<AdapterAvailability>;
  /** Timeout / unreachable: DEPENDENCY_UNAVAILABLE (503), per the adapter contract. */
  abstract authenticate(req: AadhaarAuthRequest): Promise<AadhaarAuthResult>;
}

// ---------------------------------------------------------------------------
// MOCK: an in-process registry of SYNTHETIC numbers. Every one starts with 0
// or 1, which UIDAI never issues, so no real person's number can be in it,
// and the mock refuses any number that could be real (first digit 2-9).
// Holder names are invented. Nothing leaves the process.
// ---------------------------------------------------------------------------
type MockRecord =
  | { outcome: 'HOLDER'; holder_name: string }
  | { outcome: 'TIMEOUT' }
  | { outcome: 'NOT_AVAILABLE' };

export const MOCK_AADHAAR_RECORDS: Readonly<Record<string, MockRecord>> = {
  // Authenticates when the name matches; a different name is error 100.
  '099900000017': { outcome: 'HOLDER', holder_name: 'Test Holder One' },
  '099900000029': { outcome: 'HOLDER', holder_name: 'Test Holder Two' },
  // The UIDAI service does not answer in time.
  '099900000038': { outcome: 'TIMEOUT' },
  // A well-formed number that is not available for authentication (998).
  '099900000040': { outcome: 'NOT_AVAILABLE' },
};

/** Numbers UIDAI never issues (first digit 0 or 1): the only ones the mock accepts. */
export const isSyntheticAadhaar = (uid: string) => /^[01][0-9]{11}$/.test(uid);

@Injectable()
export class MockAadhaarAdapter extends AadhaarAdapter {
  constructor(@InjectPinoLogger('MockAadhaarAdapter') private readonly logger: PinoLogger) {
    super();
  }

  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: true, mode: 'mock' });
  }

  authenticate(req: AadhaarAuthRequest): Promise<AadhaarAuthResult> {
    if (!isSyntheticAadhaar(req.uid)) {
      // A number that could belong to a real person never enters the mock.
      return Promise.reject(
        new AppError(ErrorCode.VALIDATION_ERROR, {
          details: [
            {
              field: 'aadhaar_number',
              message_key: 'aadhaar.mock_synthetic_only',
              constraints: {
                syntheticOnly:
                  'The mock accepts only synthetic test numbers (first digit 0 or 1, never issued by UIDAI).',
              },
            },
          ],
        }),
      );
    }
    const r = Object.prototype.hasOwnProperty.call(MOCK_AADHAAR_RECORDS, req.uid)
      ? MOCK_AADHAAR_RECORDS[req.uid]
      : undefined;
    const txn_id = `MOCK-UIDAI-${randomUUID()}`;
    const responded_at = new Date().toISOString();
    // The outcome only: never the number, the name or the holder record.
    this.logger.info(
      { aadhaar: { txn_id, outcome: r?.outcome ?? 'UNKNOWN' } },
      'MOCK Aadhaar authentication',
    );
    if (r?.outcome === 'TIMEOUT') {
      return Promise.reject(
        new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
          details: { service: 'aadhaar', reason: 'timeout', mode: 'mock', txn_id },
        }),
      );
    }
    if (!r || r.outcome === 'NOT_AVAILABLE') {
      return Promise.resolve({
        status: 'NOT_AUTHENTICATED',
        txn_id,
        error_code: '998',
        responded_at,
      });
    }
    return Promise.resolve(
      nameKey(r.holder_name) === nameKey(req.name)
        ? {
            status: 'AUTHENTICATED',
            txn_id,
            auth_code: `MOCK-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`,
            responded_at,
          }
        : { status: 'NOT_AUTHENTICATED', txn_id, error_code: '100', responded_at },
    );
  }
}

/**
 * AADHAAR_MODE=real: no UIDAI endpoint is configured in this build (it needs
 * AUA/KUA onboarding, a licence key and the UIDAI public certificate). It
 * fails closed - never falls back to the mock.
 */
export class UnconfiguredAadhaarAdapter extends AadhaarAdapter {
  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: false, mode: 'real' });
  }

  authenticate(): Promise<AadhaarAuthResult> {
    return Promise.reject(notConfigured(this.service));
  }
}
