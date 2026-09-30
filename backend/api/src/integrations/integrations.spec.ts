import type { PinoLogger } from 'nestjs-pino';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import type { AppConfigService } from '../config/app-config.service';
import type { IntegrationAdapter } from './integration-adapter';
import {
  createAadhaarAdapter,
  createDigiLockerAdapter,
  createNspAdapter,
  createPfmsAdapter,
} from './integrations.module';
import { MOCK_DIGILOCKER_RECORDS } from './digilocker/digilocker.adapter';
import { nameKey } from './nsp/nsp.adapter';
import { PFMS_MOCK_PENDING_MS, PfmsDisbursementRequest } from './pfms/pfms.adapter';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
const config = (mode: 'mock' | 'real', scenarios: Record<string, string> = {}) =>
  ({
    integrations: {
      digilocker: { mode },
      pfms: { mode, mockScenarios: scenarios },
      nsp: { mode },
      aadhaar: { mode },
    },
  }) as unknown as AppConfigService;
const all = (mode: 'mock' | 'real', scenarios?: Record<string, string>) => ({
  digilocker: createDigiLockerAdapter(config(mode, scenarios), logger),
  pfms: createPfmsAdapter(config(mode, scenarios), logger),
  nsp: createNspAdapter(config(mode, scenarios), logger),
  aadhaar: createAadhaarAdapter(config(mode, scenarios), logger),
});
const request = (application_no: string): PfmsDisbursementRequest => ({
  disbursement_id: 'd-1',
  application_no,
  amount: 41000,
  currency: 'INR',
  beneficiary_type: 'STUDENT_DBT',
  payment_mode: 'PFMS_DBT',
});
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    return err instanceof AppError ? `${err.code} ${JSON.stringify(err.details)}` : String(err);
  }
};

describe('IntegrationAdapter shape (every adapter, both modes)', () => {
  it.each(['mock', 'real'] as const)('%s mode', async (mode) => {
    const adapters: Record<string, IntegrationAdapter> = all(mode);
    for (const [name, a] of Object.entries(adapters)) {
      expect(a.service).toBe(name);
      expect(await a.checkAvailability()).toEqual({ available: mode === 'mock', mode });
    }
  });

  it('real mode fails closed: every operation is DEPENDENCY_UNAVAILABLE (not configured)', async () => {
    const { digilocker, pfms, nsp, aadhaar } = all('real');
    const expected = `${ErrorCode.DEPENDENCY_UNAVAILABLE} {"service":"%s","reason":"integration_not_configured","mode":"real"}`;
    expect(await codeOf(digilocker.verifyDocument('x'))).toBe(expected.replace('%s', 'digilocker'));
    expect(await codeOf(pfms.initiateDisbursement(request('A')))).toBe(
      expected.replace('%s', 'pfms'),
    );
    expect(await codeOf(pfms.checkStatus('r'))).toBe(expected.replace('%s', 'pfms'));
    expect(
      await codeOf(
        nsp.checkDuplicateScholarship({ full_name: 'x', dob: '2000-01-01', gender: null }),
      ),
    ).toBe(expected.replace('%s', 'nsp'));
    expect(
      await codeOf(aadhaar.authenticate({ uid: '099900000017', name: 'x', consent: true })),
    ).toBe(expected.replace('%s', 'aadhaar'));
  });
});

describe('DigiLocker mock', () => {
  const { digilocker } = all('mock');

  it('verified: issuer, verified_at, typed data and the issued XML', async () => {
    const r = await digilocker.verifyDocument('in.gov.jharkhand.edistrict-INCER-JH2026000451');
    expect(r.status).toBe('VERIFIED');
    if (r.status !== 'VERIFIED') return;
    expect(r.document).toMatchObject({
      document_type: 'INCOME_CERTIFICATE',
      issuer_id: 'in.gov.jharkhand.edistrict',
      holder_name: 'Kavya Oraon',
      data: { applicant_name: 'Kavya Oraon', family_income_annual: 180000 },
    });
    expect(Date.parse(r.document.verified_at)).not.toBeNaN();
    expect(r.document.file.mime_type).toBe('application/xml');
    expect(r.document.file.content.toString()).toContain('MOCK DIGILOCKER DOCUMENT');
  });

  it('not found and consent-not-granted are distinct results', async () => {
    expect(await digilocker.verifyDocument('in.gov.nowhere-XX-000')).toEqual({
      status: 'NOT_FOUND',
      reference: 'in.gov.nowhere-XX-000',
    });
    const ref = 'in.gov.jharkhand.edistrict-CASTE-JH2026000999';
    expect(MOCK_DIGILOCKER_RECORDS[ref].consent_granted).toBe(false);
    expect(await digilocker.verifyDocument(ref)).toMatchObject({
      status: 'CONSENT_NOT_GRANTED',
      reference: ref,
    });
  });
});

describe('PFMS mock', () => {
  afterEach(() => jest.restoreAllMocks());

  it('default is exactly Phase 9: PFMS-MOCK-<uuid>, SUCCESS, deterministic MOCKUTR', async () => {
    const { pfms } = all('mock');
    const { reference } = await pfms.initiateDisbursement(request('VS-X'));
    expect(reference).toMatch(/^PFMS-MOCK-[0-9a-f-]{36}$/);
    const s1 = await pfms.checkStatus(reference);
    const s2 = await pfms.checkStatus(reference);
    expect(s1).toMatchObject({ status: 'SUCCESS', failure_reason: null });
    expect(s1.utr_number).toMatch(/^MOCKUTR[0-9A-F]{12}$/);
    expect(s2.utr_number).toBe(s1.utr_number);
  });

  it('INSUFFICIENT_BALANCE and TIMEOUT refuse the submission (nothing sent)', async () => {
    const { pfms } = all('mock', { 'VS-BAL': 'INSUFFICIENT_BALANCE', 'VS-TO': 'TIMEOUT' });
    expect(await codeOf(pfms.initiateDisbursement(request('VS-BAL')))).toMatch(
      /^INSUFFICIENT_BALANCE /,
    );
    expect(await codeOf(pfms.initiateDisbursement(request('VS-TO')))).toMatch(
      /^DEPENDENCY_UNAVAILABLE .*"reason":"bank_server_timeout"/,
    );
  });

  it('ACCOUNT_INVALID is accepted, then reports FAILED with a reason', async () => {
    const { pfms } = all('mock', { 'VS-AC': 'ACCOUNT_INVALID' });
    const { reference } = await pfms.initiateDisbursement(request('VS-AC'));
    expect(await pfms.checkStatus(reference)).toMatchObject({
      status: 'FAILED',
      utr_number: null,
      failure_reason: 'BENEFICIARY_ACCOUNT_CLOSED_OR_INVALID',
    });
  });

  it('PENDING stays PROCESSING, then settles as SUCCESS', async () => {
    const { pfms } = all('mock', { 'VS-P': 'PENDING' });
    const t0 = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(t0);
    const { reference } = await pfms.initiateDisbursement(request('VS-P'));
    expect((await pfms.checkStatus(reference)).status).toBe('PROCESSING');
    jest.spyOn(Date, 'now').mockReturnValue(t0 + PFMS_MOCK_PENDING_MS + 1);
    expect(await pfms.checkStatus(reference)).toMatchObject({ status: 'SUCCESS' });
  });
});

describe('NSP mock', () => {
  const { nsp } = all('mock');

  it('normalises names: case, punctuation, honorifics, word order', () => {
    expect(nameKey('MINZ, Rekha')).toBe(nameKey('Rekha Minz'));
    expect(nameKey('Smt. Rekha  Minz')).toBe(nameKey('rekha minz'));
    expect(nameKey('Rekha Minz')).not.toBe(nameKey('Rekha Mink'));
  });

  it('matches on name + date of birth; a same-name different-DOB record does not match', async () => {
    const r = await nsp.checkDuplicateScholarship({
      full_name: 'Rekha Minz',
      dob: '2003-08-21',
      gender: 'FEMALE',
    });
    expect(r.duplicate_found).toBe(true);
    expect(r.matches.map((m) => m.nsp_application_id).sort()).toEqual([
      'JH2025-PMS-ST-0112903',
      'OD2026-PMS-ST-0048817',
    ]);
    expect(r.matches.every((m) => m.gender_matches === true)).toBe(true);
  });

  it('a genuinely unique applicant has no match', async () => {
    const r = await nsp.checkDuplicateScholarship({
      full_name: 'Kavya Oraon',
      dob: '2006-05-02',
      gender: 'FEMALE',
    });
    expect(r).toMatchObject({ duplicate_found: false, matches: [] });
  });
});
