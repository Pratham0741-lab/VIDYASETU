/* eslint-disable @typescript-eslint/require-await -- an in-memory fake of the async FraudData interface */
import {
  AppFacts,
  ApplicantIdentity,
  DetectorContext,
  DocFacts,
  detectDuplicateFileHash,
  detectFuzzyIdentityMatch,
  detectInstitutionSurge,
  detectRepeatedCertificateNumber,
  detectSharedBankAccount,
  FlagDraft,
  FraudData,
  IndexEntry,
} from './detectors';
import { actorCoversApplication } from './fraud-detection.service';
import { matchHmac, normalizeIdentifier } from './fraud-match';
import { scoreIdentityPair } from './identity-match';

const KEY = Buffer.alloc(32, 3);
const DAY = 86_400_000;
const NOW = new Date('2026-09-28T12:00:00.000Z');

type Person = {
  applicant_id: string;
  bank: string | null;
  caste: string | null;
  identity: Omit<ApplicantIdentity, 'applicant_id'>;
};

/** In-memory FraudData over a tiny world of people, applications and documents. */
function world(
  people: Person[],
  apps: Partial<AppFacts>[],
  docs: DocFacts[] = [],
  extracted: Record<
    string,
    Array<{
      document_id: string;
      field: 'caste_cert_number' | 'certificate_number';
      value: string;
      source: 'OCR' | 'DIGILOCKER';
    }>
  > = {},
  first: Date | null = new Date('2026-01-01T00:00:00Z'),
) {
  const index: IndexEntry[] = [];
  const facts: AppFacts[] = apps.map((a, i) => ({
    application_id: `app-${i}`,
    application_no: `VS-${i}`,
    applicant_id: 'p0',
    current_stage: 'INO_VERIFIED',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
    institution_code: null,
    assigned_officer_id: null,
    submitted_at: NOW,
    ...a,
  }));
  const data: FraudData = {
    applications: async (q) =>
      facts.filter(
        (a) =>
          q.applicationIds?.includes(a.application_id) ||
          q.applicantIds?.includes(a.applicant_id) ||
          (q.institutionCode !== undefined && a.institution_code === q.institutionCode),
      ),
    documents: async (q) =>
      docs.filter(
        (d) =>
          q.documentIds?.includes(d.document_id) ||
          d.application_id === q.applicationId ||
          d.file_sha256 === q.fileSha256,
      ),
    declaredIdentifiers: async (id) => {
      const p = people.find((x) => x.applicant_id === id);
      return { bank_account: p?.bank ?? null, caste_cert_number: p?.caste ?? null };
    },
    extractedIdentifiers: async (appId) => extracted[appId] ?? [],
    upsertIndex: async (entries) => {
      for (const e of entries) {
        const i = index.findIndex(
          (x) =>
            x.applicant_id === e.applicant_id &&
            x.field === e.field &&
            x.document_id === e.document_id,
        );
        if (i >= 0) index[i] = e;
        else index.push(e);
      }
    },
    findIndexMatches: async (field, hmac) =>
      index.filter((e) => e.field === field && e.match_hmac === hmac),
    identity: async (id) => {
      const p = people.find((x) => x.applicant_id === id);
      return p ? { applicant_id: id, ...p.identity } : null;
    },
    identityCandidates: async (state, exclude) =>
      people
        .filter((p) => p.applicant_id !== exclude && p.identity.domicile_state === state)
        .map((p) => ({ applicant_id: p.applicant_id, ...p.identity })),
    platformFirstSubmission: async () => first,
  };
  const ctx: DetectorContext = { data, matchKey: KEY, now: () => NOW };
  return { ctx, index };
}
const who = (id: string, over: Partial<Person> = {}): Person => ({
  applicant_id: id,
  bank: null,
  caste: null,
  identity: {
    first_name: id,
    last_name: 'X',
    dob: '2000-01-01',
    domicile_state: 'Jharkhand',
    domicile_district: 'Ranchi',
  },
  ...over,
});
/** Every value that must never appear in a flag (in clear, hex or base64). */
const assertNoRaw = (flags: FlagDraft[], raws: string[]) => {
  const text = JSON.stringify(flags);
  for (const r of raws) {
    for (const form of [
      r,
      Buffer.from(r).toString('hex'),
      Buffer.from(r).toString('base64'),
      normalizeIdentifier('bank_account', r),
    ]) {
      expect(text).not.toContain(form);
    }
  }
};

describe('matchHmac (keyed exact-match index)', () => {
  it('normalises formatting, separates fields, depends on the key, rejects non-identifiers', () => {
    const a = matchHmac(KEY, 'bank_account', 'sbin0001234 : 30948291048');
    expect(a).toBe(matchHmac(KEY, 'bank_account', 'SBIN0001234:30948291048'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(matchHmac(KEY, 'caste_cert_number', 'JH-ST 2026/0452')).toBe(
      matchHmac(KEY, 'caste_cert_number', 'JHST20260452'),
    );
    expect(matchHmac(KEY, 'caste_cert_number', 'X12345')).not.toBe(
      matchHmac(KEY, 'certificate_number', 'X12345'),
    );
    expect(matchHmac(Buffer.alloc(32, 4), 'bank_account', 'SBIN0001234:30948291048')).not.toBe(a);
    expect(matchHmac(KEY, 'bank_account', ' -- ')).toBeNull();
  });
});

describe('identifier normalisation (Phase 11.6, M11)', () => {
  const BANK = 'SBIN0004455:88002002';
  const sameBank: Array<[string, string]> = [
    ['no separator', 'SBIN000445588002002'],
    ['space separator', 'SBIN0004455 88002002'],
    ['spaces inside', 'SBIN 0004455 8800 2002'],
    ['space-colon-space', 'sbin0004455 : 88002002'],
    ['hyphen', 'SBIN0004455-88002002'],
    ['space-hyphen-space', 'sbin0004455 - 88002002'],
    ['slash', 'SBIN0004455/88002002'],
    ['mixed case', 'sBiN0004455:88002002'],
    ['trailing whitespace', 'SBIN0004455:88002002  \n'],
    ['leading whitespace', '\t SBIN0004455:88002002'],
    ['non-breaking space', 'SBIN0004455 88002002'],
    ['zero-width space', 'SBIN0004455:8800​2002'],
    ['fullwidth digits and colon', 'SBIN0004455：８８００２００２'],
    ['fullwidth letters', 'ＳＢＩＮ0004455:88002002'],
    ['Devanagari digits', 'SBIN0004455:८८००२००२'],
  ];
  it.each(sameBank)('bank account, %s, matches the colon form', (_label, v) => {
    expect(matchHmac(KEY, 'bank_account', v)).toBe(matchHmac(KEY, 'bank_account', BANK));
  });

  const CERT = 'JH-ST-2026-555001';
  const sameCert: Array<[string, string]> = [
    ['no separator', 'JHST2026555001'],
    ['spaces', 'jh st 2026 555001'],
    ['slashes', 'JH/ST/2026/555001'],
    ['mixed case', 'Jh-sT-2026-555001'],
    ['trailing whitespace', 'JH-ST-2026-555001 \t'],
    ['en dashes', 'JH–ST–2026–555001'],
    ['fullwidth digits', 'JH-ST-２０２６-555001'],
    ['Devanagari digits', 'JH-ST-२०२६-555001'],
  ];
  it.each(sameCert)('declared certificate number, %s, matches the hyphen form', (_label, v) => {
    expect(matchHmac(KEY, 'caste_cert_number', v)).toBe(matchHmac(KEY, 'caste_cert_number', CERT));
    expect(matchHmac(KEY, 'certificate_number', v)).toBe(
      matchHmac(KEY, 'certificate_number', CERT),
    );
  });

  const differentBank: Array<[string, string]> = [
    ['leading zero on the account', 'SBIN0004455:088002002'],
    ['one digit different', 'SBIN0004455:88002003'],
    ['different branch', 'SBIN0004456:88002002'],
    ['account without IFSC', '88002002'],
    ['Cyrillic look-alike letter (a miss, never a false match)', 'SВIN0004455:88002002'],
  ];
  it.each(differentBank)('bank account, %s, does not match', (_label, v) => {
    expect(matchHmac(KEY, 'bank_account', v)).not.toBe(matchHmac(KEY, 'bank_account', BANK));
  });

  it('keeps different accounts written in non-ASCII digits apart', () => {
    const one = 'SBIN0004455:１１１１１１１１';
    const two = 'SBIN0004455:２２２２２２２２';
    expect(normalizeIdentifier('bank_account', one)).toBe('SBIN000445511111111');
    expect(matchHmac(KEY, 'bank_account', one)).not.toBe(matchHmac(KEY, 'bank_account', two));
  });

  it('keeps genuinely different certificate numbers apart, leading zeros included', () => {
    for (const other of ['JH-ST-2026-0555001', 'JH-ST-2026-555002', 'JH-SC-2026-555001']) {
      expect(matchHmac(KEY, 'caste_cert_number', other)).not.toBe(
        matchHmac(KEY, 'caste_cert_number', CERT),
      );
    }
  });

  it('documents the accepted certificate collision: separator placement only (M17)', () => {
    expect(matchHmac(KEY, 'caste_cert_number', 'JHCC/2026/12/345')).toBe(
      matchHmac(KEY, 'caste_cert_number', 'JHCC/2026/123/45'),
    );
  });

  it.each([
    ['empty', 'bank_account', ''],
    ['separators only', 'bank_account', ' -/: '],
    ['placeholder', 'bank_account', 'NOT AVAILABLE'],
    ['IFSC only', 'bank_account', 'SBIN0004455'],
    ['too short', 'bank_account', '12345678'],
    ['placeholder certificate', 'caste_cert_number', 'NIL'],
    ['too few digits', 'caste_cert_number', 'PENDING-01'],
    ['too short certificate', 'certificate_number', 'JH-123'],
  ] as const)('never matches on a weak value: %s', (_label, field, v) => {
    expect(matchHmac(KEY, field, v)).toBeNull();
  });
});

describe('detectSharedBankAccount', () => {
  it('flags BOTH applications of two different applicants sharing an account (HIGH), ids only', async () => {
    const acct = 'SBIN0009991:40091077';
    const { ctx } = world(
      [who('p1', { bank: acct }), who('p2', { bank: 'sbin0009991:40091077' })],
      [{ applicant_id: 'p1' }, { applicant_id: 'p2' }],
    );
    expect(await detectSharedBankAccount(ctx, 'app-0')).toEqual([]); // p2 not indexed yet
    const flags = await detectSharedBankAccount(ctx, 'app-1');
    expect(flags.map((f) => [f.application_id, f.severity, f.related_application_ids])).toEqual([
      ['app-0', 'HIGH', ['app-1']],
      ['app-1', 'HIGH', ['app-0']],
    ]);
    assertNoRaw(flags, [acct, '40091077']);
    // Running from the other side produces the same findings (same dedup keys).
    expect((await detectSharedBankAccount(ctx, 'app-0')).map((f) => f.dedup_key).sort()).toEqual(
      flags.map((f) => f.dedup_key).sort(),
    );
  });

  it('one applicant with two applications is not a shared account', async () => {
    const { ctx } = world(
      [who('p1', { bank: 'SBIN0001:123456789' })],
      [{ applicant_id: 'p1' }, { applicant_id: 'p1' }],
    );
    expect(await detectSharedBankAccount(ctx, 'app-0')).toEqual([]);
    expect(await detectSharedBankAccount(ctx, 'app-1')).toEqual([]);
  });
});

describe('detectRepeatedCertificateNumber', () => {
  it('declared vs declared is HIGH; a match involving an OCR read is MEDIUM; DigiLocker counts as exact', async () => {
    const people = [
      who('p1', { caste: 'JH-ST-2026-000452' }),
      who('p2', { caste: 'JH-ST-2026-000452' }),
      who('p3'),
    ];
    const { ctx } = world(
      people,
      [{ applicant_id: 'p1' }, { applicant_id: 'p2' }, { applicant_id: 'p3' }],
      [],
      {
        'app-2': [
          {
            document_id: 'd-ocr',
            field: 'certificate_number',
            value: 'JH-INC-2026-11873',
            source: 'OCR',
          },
          {
            document_id: 'd-dl',
            field: 'caste_cert_number',
            value: 'jh st 2026 000452',
            source: 'DIGILOCKER',
          },
        ],
      },
    );
    await detectRepeatedCertificateNumber(ctx, 'app-0');
    const declared = await detectRepeatedCertificateNumber(ctx, 'app-1');
    expect(new Set(declared.map((f) => f.severity))).toEqual(new Set(['HIGH']));
    const withDl = await detectRepeatedCertificateNumber(ctx, 'app-2');
    expect(withDl.find((f) => f.application_id === 'app-2')).toMatchObject({
      severity: 'HIGH',
      related_document_ids: ['d-dl'],
    });
    assertNoRaw(
      [...declared, ...withDl],
      ['JH-ST-2026-000452', 'JHST2026000452', 'JH-INC-2026-11873'],
    );

    const ocr = world(
      [who('p1'), who('p2')],
      [{ applicant_id: 'p1' }, { applicant_id: 'p2' }],
      [],
      {
        'app-0': [
          {
            document_id: 'a',
            field: 'certificate_number',
            value: 'INC/DUM/2023/0993',
            source: 'OCR',
          },
        ],
        'app-1': [
          {
            document_id: 'b',
            field: 'certificate_number',
            value: 'INC-DUM-2023-0993',
            source: 'OCR',
          },
        ],
      },
    );
    await detectRepeatedCertificateNumber(ocr.ctx, 'app-0');
    const m = await detectRepeatedCertificateNumber(ocr.ctx, 'app-1');
    expect(m.map((f) => f.severity)).toEqual(['MEDIUM', 'MEDIUM']);
  });
});

describe('detectDuplicateFileHash', () => {
  const docs: DocFacts[] = [
    {
      document_id: 'd1',
      application_id: 'app-0',
      applicant_id: 'p1',
      file_sha256: 'aa',
      source: 'UPLOAD',
    },
    {
      document_id: 'd2',
      application_id: 'app-1',
      applicant_id: 'p1',
      file_sha256: 'aa',
      source: 'UPLOAD',
    }, // p1's own resubmission
    {
      document_id: 'd3',
      application_id: 'app-2',
      applicant_id: 'p2',
      file_sha256: 'bb',
      source: 'UPLOAD',
    },
    {
      document_id: 'd4',
      application_id: 'app-3',
      applicant_id: 'p3',
      file_sha256: 'bb',
      source: 'UPLOAD',
    }, // someone else's file
  ];
  const apps = [
    { applicant_id: 'p1' },
    { applicant_id: 'p1' },
    { applicant_id: 'p2' },
    { applicant_id: 'p3' },
  ];

  it('the same applicant reusing their own file is not flagged', async () => {
    const { ctx } = world([], apps, docs);
    expect(await detectDuplicateFileHash(ctx, 'd1')).toEqual([]);
    expect(await detectDuplicateFileHash(ctx, 'd2')).toEqual([]);
  });

  it('the same file under two different applicants flags both applications (HIGH)', async () => {
    const { ctx } = world([], apps, docs);
    const flags = await detectDuplicateFileHash(ctx, 'd4');
    expect(flags.map((f) => [f.application_id, f.severity, f.related_document_ids])).toEqual([
      ['app-2', 'HIGH', ['d4']],
      ['app-3', 'HIGH', ['d3']],
    ]);
    expect(JSON.stringify(flags)).not.toContain('"bb"'); // the hash itself is not evidence
  });
});

describe('detectInstitutionSurge', () => {
  const cfg = { baselineWindows: 8, multiple: 3, minCount: 5 };
  const at = (daysAgo: number): Partial<AppFacts> => ({
    institution_code: 'U-0421',
    submitted_at: new Date(NOW.getTime() - daysAgo * DAY),
  });

  it('refuses without enough platform history (no day-one alarms)', async () => {
    const { ctx } = world(
      [],
      Array.from({ length: 40 }, () => at(1)),
      [],
      {},
      new Date(NOW.getTime() - 10 * DAY),
    );
    const r = await detectInstitutionSurge(ctx, 'U-0421', 7, cfg);
    expect(r.status).toBe('INSUFFICIENT_BASELINE');
    expect(r.flags).toEqual([]);
  });

  it('fires on a surge over a low baseline; stays quiet at normal volume', async () => {
    const baseline = Array.from({ length: 8 }, (_, w) => at(7 + 7 * w + 2)); // one a week for 8 weeks
    const surge = world([], [...baseline, ...Array.from({ length: 12 }, (_, i) => at(i % 6))]);
    const fired = await detectInstitutionSurge(surge.ctx, 'U-0421', 7, cfg);
    expect(fired).toMatchObject({
      status: 'FIRED',
      window_count: 12,
      baseline_median: 1,
      threshold: 5,
    });
    expect(fired.flags[0]).toMatchObject({
      flag_type: 'INSTITUTION_SURGE',
      severity: 'MEDIUM',
      subject_type: 'INSTITUTION',
    });

    const normal = world([], [...baseline, at(2), at(3)]);
    expect(await detectInstitutionSurge(normal.ctx, 'U-0421', 7, cfg)).toMatchObject({
      status: 'NORMAL',
      window_count: 2,
      flags: [],
    });
  });
});

describe('fuzzy identity (UNCALIBRATED, hand-constructed oracle)', () => {
  const id = (first: string, last: string, dob: string, district = 'Ranchi') => ({
    first_name: first,
    last_name: last,
    dob,
    domicile_district: district,
  });
  it.each([
    [
      'middle name initialled',
      id('Sunita Kumari', 'Hansda', '2004-03-12'),
      id('Sunita K.', 'Hansda', '2004-03-12'),
      'MEDIUM',
    ],
    [
      'transliteration + one-digit DOB slip',
      id('Lakshmi', 'Oraon', '2005-07-19'),
      id('Laxmi', 'Oraon', '2005-07-18'),
      'LOW',
    ],
    [
      'day/month swapped',
      id('Birsa', 'Asur', '2003-04-11'),
      id('Birsa', 'Asur', '2003-11-04'),
      'MEDIUM',
    ],
    [
      'same name, different person (DOB)',
      id('Kavya', 'Oraon', '2006-05-02'),
      id('Kavya', 'Oraon', '1998-11-20'),
      null,
    ],
    [
      'different given name, same DOB + district',
      id('Rahul', 'Munda', '2004-01-15'),
      id('Rohit', 'Munda', '2004-01-15'),
      null,
    ],
    [
      'different surname, same DOB + district',
      id('Priya', 'Tudu', '2004-01-15'),
      id('Priya', 'Soren', '2004-01-15'),
      null,
    ],
  ])('%s', (_label, a, b, expected) => {
    expect(scoreIdentityPair(a, b).severity).toBe(expected);
  });

  it("flags both applicants' applications, never HIGH, ids only", async () => {
    const people = [
      who('p1', {
        identity: {
          first_name: 'Sunita Kumari',
          last_name: 'Hansda',
          dob: '2004-03-12',
          domicile_state: 'Jharkhand',
          domicile_district: 'Ranchi',
        },
      }),
      who('p2', {
        identity: {
          first_name: 'Sunita K.',
          last_name: 'Hansda',
          dob: '2004-03-12',
          domicile_state: 'Jharkhand',
          domicile_district: 'Ranchi',
        },
      }),
    ];
    const { ctx } = world(people, [{ applicant_id: 'p1' }, { applicant_id: 'p2' }]);
    const flags = await detectFuzzyIdentityMatch(ctx, 'p1');
    expect(flags.map((f) => [f.application_id, f.severity])).toEqual([
      ['app-0', 'MEDIUM'],
      ['app-1', 'MEDIUM'],
    ]);
    expect(JSON.stringify(flags)).not.toMatch(/Sunita|Hansda|2004-03-12/);
  });
});

describe('hold guard scope (Phase 2 jurisdiction rule)', () => {
  const app = {
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
    assigned_officer_id: null,
  } as AppFacts;
  const officer = (state: string | null, district: string | null) =>
    ({
      accountId: 'a',
      role: 'DISTRICT_NODAL_OFFICER',
      officerId: 'o',
      jurisdictionState: state,
      jurisdictionDistrict: district,
    }) as const;
  it('national, state and district officers in scope; another district or an applicant not', () => {
    expect(actorCoversApplication(officer(null, null), app)).toBe(true);
    expect(actorCoversApplication(officer('Jharkhand', null), app)).toBe(true);
    expect(actorCoversApplication(officer('Jharkhand', 'Ranchi'), app)).toBe(true);
    expect(actorCoversApplication(officer('Jharkhand', 'Dumka'), app)).toBe(false);
    expect(actorCoversApplication({ ...officer(null, null), role: 'APPLICANT' }, app)).toBe(false);
  });
});
