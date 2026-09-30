import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { PinoLogger } from 'nestjs-pino';
import { AppError } from '../../common/errors/app-error';
import { matchHmac } from '../../fraud/fraud-match';
import {
  AadhaarAdapter,
  MOCK_AADHAAR_RECORDS,
  MockAadhaarAdapter,
  UnconfiguredAadhaarAdapter,
} from './aadhaar.adapter';
import {
  aadhaarHmac,
  AadhaarAuthenticationService,
  normaliseAadhaar,
} from './aadhaar-authentication.service';
import { AADHAAR_MESSAGES } from './aadhaar-messages';
import { verhoeffCheckDigit, verhoeffValid } from './verhoeff';

const KEY = Buffer.alloc(32, 7).toString('base64');
const logs: unknown[] = [];
const logger = {
  info: (...a: unknown[]) => logs.push(a),
  warn: (...a: unknown[]) => logs.push(a),
  error: (...a: unknown[]) => logs.push(a),
} as unknown as PinoLogger;
const outcome = async (p: Promise<unknown>) => {
  try {
    return await p;
  } catch (err) {
    return err instanceof AppError ? { thrown: err.code, details: err.details } : String(err);
  }
};

describe('Verhoeff and normalisation (Phase 14 loose ends, Part E)', () => {
  it('matches the published check-digit examples', () => {
    expect(verhoeffCheckDigit('236')).toBe('3');
    expect(verhoeffCheckDigit('12345')).toBe('1');
    expect(verhoeffValid('2363')).toBe(true);
    expect(verhoeffValid('2364')).toBe(false);
  });

  it('every synthetic mock number is well-formed and starts with 0 or 1 (never issued)', () => {
    for (const uid of Object.keys(MOCK_AADHAAR_RECORDS)) {
      expect([uid, verhoeffValid(uid), /^[01]/.test(uid)]).toEqual([uid, true, true]);
    }
  });

  it('normalises the fraud-index way, then checks 12 digits and the checksum', () => {
    expect(normaliseAadhaar('0999 0000 0017')).toBe('099900000017');
    expect(normaliseAadhaar('0999-0000-0017')).toBe('099900000017');
    expect(normaliseAadhaar('०९९९ ००००  ००१७')).toBe('099900000017'); // Devanagari digits
    expect(normaliseAadhaar('0999 0000 0018')).toBeNull(); // checksum
    expect(normaliseAadhaar('0999 0000 001')).toBeNull(); // 11 digits
  });

  it('keyed hash: deterministic, keyed, and never equal to another field hash of the same digits', () => {
    const h = aadhaarHmac(KEY, '099900000017');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(aadhaarHmac(KEY, '099900000017')).toBe(h);
    expect(aadhaarHmac(Buffer.alloc(32, 8).toString('base64'), '099900000017')).not.toBe(h);
    expect(matchHmac(Buffer.from(KEY, 'base64'), 'certificate_number', '099900000017')).not.toBe(h);
  });

  it('messages exist in English and Hindi', () => {
    expect(Object.keys(AADHAAR_MESSAGES.hi).sort()).toEqual(
      Object.keys(AADHAAR_MESSAGES.en).sort(),
    );
  });
});

describe('Aadhaar adapter: mock outcomes, real mode, no network', () => {
  const mock: AadhaarAdapter = new MockAadhaarAdapter(logger);
  const spies: jest.SpyInstance[] = [];
  beforeAll(() => {
    const boom = () => {
      throw new Error('NETWORK ACCESS ATTEMPTED');
    };
    spies.push(jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(boom));
    spies.push(jest.spyOn(http, 'request').mockImplementation(boom));
    spies.push(jest.spyOn(https, 'request').mockImplementation(boom));
    spies.push(jest.spyOn(dns, 'lookup').mockImplementation(boom));
    spies.push(jest.spyOn(globalThis, 'fetch').mockImplementation(boom));
  });
  afterAll(() => spies.forEach((s) => s.mockRestore()));

  it('success, failure (100, 998) and timeout - with no network call of any kind', async () => {
    const ok = await mock.authenticate({
      uid: '099900000017',
      name: 'Test Holder One',
      consent: true,
    });
    expect(ok).toMatchObject({ status: 'AUTHENTICATED' });
    const mismatch = await mock.authenticate({
      uid: '099900000017',
      name: 'Someone Else',
      consent: true,
    });
    expect(mismatch).toMatchObject({ status: 'NOT_AUTHENTICATED', error_code: '100' });
    const unavailable = await mock.authenticate({
      uid: '099900000040',
      name: 'Anyone',
      consent: true,
    });
    expect(unavailable).toMatchObject({ status: 'NOT_AUTHENTICATED', error_code: '998' });
    const unknown = await mock.authenticate({ uid: '199900000056', name: 'Anyone', consent: true });
    expect(unknown).toMatchObject({ status: 'NOT_AUTHENTICATED', error_code: '998' });
    expect(
      await outcome(mock.authenticate({ uid: '099900000038', name: 'x', consent: true })),
    ).toMatchObject({
      thrown: 'DEPENDENCY_UNAVAILABLE',
      details: { service: 'aadhaar', reason: 'timeout' },
    });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('a number that could be real (first digit 2-9) never enters the mock', async () => {
    const realistic = `2363471712${verhoeffCheckDigit('2363471712').padStart(1, '0')}`;
    const uid = `${realistic.slice(0, 11)}${verhoeffCheckDigit(realistic.slice(0, 11))}`;
    expect(verhoeffValid(uid)).toBe(true);
    expect(await outcome(mock.authenticate({ uid, name: 'x', consent: true }))).toMatchObject({
      thrown: 'VALIDATION_ERROR',
    });
  });

  it('real mode without configuration is refused, never a silent fallback to the mock', async () => {
    const real = new UnconfiguredAadhaarAdapter();
    expect(await real.checkAvailability()).toEqual({ available: false, mode: 'real' });
    expect(await outcome(real.authenticate())).toEqual({
      thrown: 'DEPENDENCY_UNAVAILABLE',
      details: { service: 'aadhaar', reason: 'integration_not_configured', mode: 'real' },
    });
  });
});

describe('AadhaarAuthenticationService: nothing but the hash and last four digits is kept', () => {
  it('stores the keyed hash and masked form; the number is in no stored field, response or log', async () => {
    logs.length = 0;
    const created: Array<Record<string, unknown>> = [];
    const client = {
      applicant: {
        findUnique: () =>
          Promise.resolve({ id: 'ap-1', first_name: 'Test Holder', last_name: 'One' }),
      },
      aadhaarAuthentication: {
        create: (a: { data: Record<string, unknown> }) => {
          created.push(a.data);
          return Promise.resolve({ id: 'row-1', created_at: new Date(), ...a.data });
        },
      },
    };
    const service = new AadhaarAuthenticationService(
      { client } as never,
      { fraud: { matchKeyBase64: KEY }, integrations: { aadhaar: { mode: 'mock' } } } as never,
      new MockAadhaarAdapter(logger),
      logger,
    );
    const actor = { accountId: 'acc-1', role: 'APPLICANT', officerId: null } as never;
    const res = await service.authenticate(actor, '0999 0000 0017', true);
    expect(res.authentication).toMatchObject({
      outcome: 'AUTHENTICATED',
      aadhaar_masked: 'XXXX XXXX 0017',
    });
    expect(created[0]).toMatchObject({
      uid_hmac: aadhaarHmac(KEY, '099900000017'),
      uid_last4: '0017',
    });
    const everything = JSON.stringify({ created, res, logs });
    for (const form of [
      '099900000017',
      '0999 0000 0017',
      Buffer.from('099900000017').toString('hex'),
      Buffer.from('099900000017').toString('base64'),
    ]) {
      expect([form, everything.includes(form)]).toEqual([form, false]);
    }
    await expect(service.authenticate(actor, '0999 0000 0017', false)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
