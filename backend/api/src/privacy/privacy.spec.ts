import type { Actor } from '../auth/actor';
import { PRIVACY_MESSAGES } from './privacy-messages';
import { PrivacyService } from './privacy.service';

const actor = { accountId: 'acc-1', role: 'APPLICANT', officerId: null } as unknown as Actor;
const config = {
  consent: {
    noticeVersion: 'v2',
    purposes: ['application_processing', 'government_verification', 'notifications'],
    required: ['application_processing', 'government_verification'],
  },
  languages: { supported: ['en', 'hi', 'sat'] },
};

function service(records: Array<{ purpose: string; status: string; notice_version: string }>) {
  const rows = records.map((r, i) => ({
    id: String(i),
    ...r,
    language: 'en',
    method: 'ONLINE_FORM',
    created_at: new Date(2026, 0, records.length - i),
  }));
  const client = {
    consentRecord: { findMany: jest.fn(() => Promise.resolve(rows)) },
  };
  return new PrivacyService(
    { client } as never,
    config as never,
    {} as never,
    { record: jest.fn() } as never,
    { info: jest.fn() } as never,
  );
}

describe('consent (Phase 17, B2)', () => {
  it('no record at all: every required purpose is missing (nothing is backfilled)', async () => {
    await expect(service([]).missingForSubmission('ap-1')).resolves.toEqual([
      'application_processing',
      'government_verification',
    ]);
  });

  it('the latest record decides; a withdrawal or an old notice version is not current', async () => {
    // newest first, as the query orders them
    const s = service([
      { purpose: 'application_processing', status: 'WITHDRAWN', notice_version: 'v2' },
      { purpose: 'application_processing', status: 'GIVEN', notice_version: 'v2' },
      { purpose: 'government_verification', status: 'GIVEN', notice_version: 'v1' },
      { purpose: 'notifications', status: 'GIVEN', notice_version: 'v2' },
    ]);
    await expect(s.missingForSubmission('ap-1')).resolves.toEqual([
      'application_processing',
      'government_verification',
    ]);
  });

  it('current consents for the required purposes: nothing missing', async () => {
    const s = service([
      { purpose: 'application_processing', status: 'GIVEN', notice_version: 'v2' },
      { purpose: 'government_verification', status: 'GIVEN', notice_version: 'v2' },
    ]);
    await expect(s.missingForSubmission('ap-1')).resolves.toEqual([]);
    void actor;
  });

  it('every notice and message exists in English and Hindi with the same placeholders', () => {
    const ph = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(Object.keys(PRIVACY_MESSAGES.hi).sort()).toEqual(
      Object.keys(PRIVACY_MESSAGES.en).sort(),
    );
    for (const k of Object.keys(PRIVACY_MESSAGES.en)) {
      expect([k, ph(PRIVACY_MESSAGES.hi[k])]).toEqual([k, ph(PRIVACY_MESSAGES.en[k])]);
    }
    for (const p of config.consent.purposes) {
      expect(PRIVACY_MESSAGES.en[`consent.${p}.text`]).toBeDefined();
    }
  });
});
