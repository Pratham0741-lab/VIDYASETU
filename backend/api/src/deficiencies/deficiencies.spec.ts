import {
  addMonths,
  consistencyEvidence,
  cropFor,
  deadlineDays,
  dependsOn,
  effectiveStatus,
  failedChecks,
  issueDate,
  PROBLEM,
  rulesDependingOn,
  runConsistencyCheck,
  runSlotCheck,
  SlotEvidence,
  validityMonthsFor,
} from './deficiency-checks';
import {
  MissingNoticeTemplateError,
  noticeDate,
  renderDeficiencyNotice,
  TemplateRow,
} from './deficiency-notice';

const NOW = new Date('2026-09-29T00:00:00Z');
const policy = { validityMonths: { INCOME_CERTIFICATE: 12 }, now: NOW };
const slot = (over: Partial<SlotEvidence> = {}): SlotEvidence => ({
  slot: 'Family Income Certificate',
  document_type: 'INCOME_CERTIFICATE',
  document: { id: 'd1', created_at: NOW, quality_usable: true },
  extraction: {
    status: 'COMPLETED',
    field_review: { family_income_annual: 'AUTO_ACCEPTED' },
    values: { issue_date: '2026-04-01' },
    eligibility_mismatch_fields: [],
  },
  ...over,
});

describe('deficiency checks (Phase 13C)', () => {
  it('reads the issue date under either key (ml: issued_date, mock: issue_date)', () => {
    expect(issueDate({ issued_date: '2025-01-02' })?.toISOString()).toBe(
      '2025-01-02T00:00:00.000Z',
    );
    expect(issueDate({ issue_date: '2025-01-02' })?.toISOString()).toBe('2025-01-02T00:00:00.000Z');
    expect(issueDate({ issue_date: '02/01/2025' })).toBeNull();
    expect(addMonths(new Date('2025-01-31T00:00:00Z'), 12).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });

  it('DOCUMENT_VALIDITY: current passes, older than the validity fails, unreadable date fails differently', () => {
    expect(runSlotCheck('DOCUMENT_VALIDITY', slot(), policy).outcome).toBe('PASS');
    const expired = runSlotCheck(
      'DOCUMENT_VALIDITY',
      slot({ extraction: { ...slot().extraction!, values: { issue_date: '2025-06-30' } } }),
      policy,
    );
    expect(expired).toMatchObject({
      outcome: 'FAIL',
      problem_code: PROBLEM.DOCUMENT_EXPIRED,
      fix_code: 'deficiency.fix.upload_current_certificate',
    });
    expect(
      runSlotCheck(
        'DOCUMENT_VALIDITY',
        slot({ extraction: { ...slot().extraction!, values: {} } }),
        policy,
      ),
    ).toMatchObject({ outcome: 'FAIL', problem_code: PROBLEM.ISSUE_DATE_UNREADABLE });
    expect(runSlotCheck('DOCUMENT_VALIDITY', slot({ extraction: null }), policy).outcome).toBe(
      'PENDING',
    );
    expect(
      runSlotCheck('DOCUMENT_VALIDITY', slot({ document_type: 'MARKSHEET' }), policy).outcome,
    ).toBe('NOT_APPLICABLE');
  });

  it('a missing or unreadable document fails every slot check with that problem first', () => {
    expect(runSlotCheck('DOCUMENT_VALIDITY', slot({ document: null }), policy).problem_code).toBe(
      PROBLEM.DOCUMENT_MISSING,
    );
    const bad = slot({ document: { id: 'd', created_at: NOW, quality_usable: false } });
    expect(runSlotCheck('QUALITY_GATE', bad, policy).problem_code).toBe(PROBLEM.IMAGE_UNREADABLE);
    expect(runSlotCheck('DOCUMENT_VALIDITY', bad, policy).problem_code).toBe(
      PROBLEM.IMAGE_UNREADABLE,
    );
  });

  it('FIELD_CONFIDENCE passes once the field no longer needs review', () => {
    const needs = slot({
      extraction: { ...slot().extraction!, field_review: { family_income_annual: 'NEEDS_REVIEW' } },
    });
    expect(runSlotCheck('FIELD_CONFIDENCE', needs, policy, 'family_income_annual')).toMatchObject({
      outcome: 'FAIL',
      problem_code: PROBLEM.FIELD_UNREADABLE,
      field: 'family_income_annual',
    });
    expect(runSlotCheck('FIELD_CONFIDENCE', slot(), policy, 'family_income_annual').outcome).toBe(
      'PASS',
    );
  });

  it('consistency checks need a result newer than the changed documents', () => {
    const c = consistencyEvidence({ checks: { names_match: false, dob_match: true } }, NOW);
    expect(runConsistencyCheck('NAME_CONSISTENCY', c, null)).toMatchObject({
      outcome: 'FAIL',
      problem_code: PROBLEM.NAME_MISMATCH,
    });
    expect(runConsistencyCheck('DOB_CONSISTENCY', c, null).outcome).toBe('PASS');
    expect(runConsistencyCheck('NAME_CONSISTENCY', c, new Date(NOW.getTime() + 1)).outcome).toBe(
      'PENDING',
    );
  });

  it('failedChecks: one item per failing slot plus failing consistency checks', () => {
    const r = failedChecks(
      [
        slot({ extraction: { ...slot().extraction!, values: { issue_date: '2024-01-01' } } }),
        slot({
          slot: 'Scanned copy of the bank passbook',
          document_type: 'BANK_PASSBOOK',
          document: null,
        }),
      ],
      consistencyEvidence({ checks: { names_match: false } }, NOW),
      policy,
    );
    expect(r.map((x) => `${x.check}:${x.problem_code}`)).toEqual([
      'DOCUMENT_VALIDITY:deficiency.problem.document_expired',
      'DOCUMENT_PRESENT:deficiency.problem.document_missing',
      'NAME_CONSISTENCY:deficiency.problem.name_mismatch',
    ]);
  });

  it('a missing "(if applicable)" document is not an automatic item', () => {
    const r = failedChecks(
      [
        slot({
          slot: 'Disability certificate (if applicable)',
          document_type: 'DISABILITY_CERT',
          document: null,
        }),
      ],
      consistencyEvidence(null, null),
      policy,
    );
    expect(r).toEqual([]);
  });

  it('dependency map: slot checks read their slot, consistency reads all documents, OFFICER is manual', () => {
    expect(dependsOn({ check_code: 'DOCUMENT_VALIDITY', document_slot: 'X' })).toEqual({
      kind: 'slot',
      slot: 'X',
    });
    expect(dependsOn({ check_code: 'NAME_CONSISTENCY', document_slot: null })).toEqual({
      kind: 'all_documents',
    });
    expect(dependsOn({ check_code: 'OFFICER', document_slot: 'X' })).toEqual({ kind: 'manual' });
    const config = {
      rules: [
        { id: 'income_ceiling', doc_refs: ['income_certificate'] },
        { id: 'category_match', doc_refs: ['caste_certificate'] },
        { id: 'age', doc_refs: [] },
      ],
    };
    expect(rulesDependingOn('INCOME_CERTIFICATE', config)).toEqual(['income_ceiling']);
    expect(rulesDependingOn('BANK_PASSBOOK', config)).toEqual([]);
  });

  it('deadline from the scheme config or the default; OVERDUE is computed when read', () => {
    expect(deadlineDays({ deficiency_policy: { deadline_days: 21 } }, 15)).toBe(21);
    expect(deadlineDays({}, 15)).toBe(15);
    expect(effectiveStatus('OPEN', new Date('2026-09-01T00:00:00Z'), NOW)).toBe('OVERDUE');
    expect(effectiveStatus('RESOLVED', new Date('2026-09-01T00:00:00Z'), NOW)).toBe('RESOLVED');
    expect(effectiveStatus('OPEN', new Date('2026-10-01T00:00:00Z'), NOW)).toBe('OPEN');
  });
});

describe('deficiency notice (Phase 13C)', () => {
  const row = (
    code: string,
    locale: string,
    body: string,
    subject: string | null = null,
  ): TemplateRow => ({
    code,
    locale,
    body_template: body,
    subject_template: subject,
  });
  const rows = (locale: string, tag: string) => [
    row(
      'DEFICIENCY_NOTICE',
      locale,
      `${tag} {application_no}:\n{items}`,
      `${tag} {application_no} {item_count} {deadline}`,
    ),
    row('DEFICIENCY_NOTICE_ITEM', locale, '{n}. {document}: {problem} {fix} ({deadline})'),
    row('deficiency.problem.document_expired', locale, `${tag}-expired`),
    row('deficiency.fix.upload_current_certificate', locale, `${tag}-upload-current`),
    row('document.INCOME_CERTIFICATE', locale, `${tag}-income-cert`),
  ];
  const items = [
    {
      document_slot: 'Family Income Certificate',
      document_type: 'INCOME_CERTIFICATE',
      problem_code: 'deficiency.problem.document_expired',
      fix_code: 'deficiency.fix.upload_current_certificate',
      deadline_at: '2026-10-14T00:00:00.000Z',
    },
  ];

  it('renders every item in the requested language', () => {
    const n = renderDeficiencyNotice(
      [...rows('en', 'EN'), ...rows('hi', 'HI')],
      'hi',
      'VS-1',
      items,
    );
    expect(n).toMatchObject({ locale: 'hi', requested_locale: 'hi', fell_back: false });
    expect(n.subject).toBe('HI VS-1 1 2026-10-14');
    expect(n.body).toBe('HI VS-1:\n1. HI-income-cert: HI-expired HI-upload-current (2026-10-14)');
  });

  it('falls back to English as a whole (never a mix) when any piece is missing, and says so', () => {
    const partialHi = rows('hi', 'HI').filter(
      (r) => r.code !== 'deficiency.problem.document_expired',
    );
    const n = renderDeficiencyNotice([...rows('en', 'EN'), ...partialHi], 'hi', 'VS-1', items);
    expect(n).toMatchObject({ locale: 'en', requested_locale: 'hi', fell_back: true });
    expect(n.body).not.toContain('HI');
    const sat = renderDeficiencyNotice(rows('en', 'EN'), 'sat', 'VS-1', items);
    expect(sat).toMatchObject({ locale: 'en', requested_locale: 'sat', fell_back: true });
  });

  it('refuses to render without the English templates', () => {
    expect(() => renderDeficiencyNotice([], 'en', 'VS-1', items)).toThrow(
      MissingNoticeTemplateError,
    );
  });

  it('dates are shown in India Standard Time', () => {
    expect(noticeDate('2026-10-13T20:00:00.000Z')).toBe('2026-10-14');
  });
});

describe('crop references (Phase 13D)', () => {
  const box = {
    page: 1,
    x: 10,
    y: 20,
    width: 30,
    height: 12,
    coordinate_space: 'stored_image_pixels',
  };
  const withBoxes = (field_boxes: Record<string, typeof box | null>): SlotEvidence =>
    slot({ extraction: { ...slot().extraction!, field_boxes } });

  it('a validity item points at the issue date (either key); a field item at its field', () => {
    expect(cropFor('DOCUMENT_VALIDITY', withBoxes({ issued_date: box }))).toEqual({
      document_id: 'd1',
      field: 'issued_date',
      ...box,
    });
    expect(cropFor('DOCUMENT_VALIDITY', withBoxes({ issue_date: box }))?.field).toBe('issue_date');
    expect(
      cropFor('FIELD_CONFIDENCE', withBoxes({ family_income_annual: box }), 'family_income_annual')
        ?.field,
    ).toBe('family_income_annual');
  });

  it('no box, no crop: missing box, other checks, no document, pre-13D extraction', () => {
    expect(cropFor('DOCUMENT_VALIDITY', withBoxes({ issued_date: null }))).toBeNull();
    expect(cropFor('QUALITY_GATE', withBoxes({ issued_date: box }))).toBeNull();
    expect(cropFor('DOCUMENT_VALIDITY', slot({ document: null }))).toBeNull();
    expect(cropFor('DOCUMENT_VALIDITY', slot())).toBeNull();
  });

  it('the notice links to a crop on its own line and never embeds it', () => {
    const rows = [
      { code: 'DEFICIENCY_NOTICE', locale: 'en', subject_template: 's', body_template: '{items}' },
      {
        code: 'DEFICIENCY_NOTICE_ITEM',
        locale: 'en',
        subject_template: null,
        body_template: '{n}. {document}: {problem}',
      },
      {
        code: 'DEFICIENCY_NOTICE_CROP',
        locale: 'en',
        subject_template: null,
        body_template: '   See: {crop_url}',
      },
      {
        code: 'deficiency.problem.document_expired',
        locale: 'en',
        subject_template: null,
        body_template: 'expired',
      },
      {
        code: 'deficiency.fix.upload_current_certificate',
        locale: 'en',
        subject_template: null,
        body_template: 'fix',
      },
      {
        code: 'document.INCOME_CERTIFICATE',
        locale: 'en',
        subject_template: null,
        body_template: 'Income certificate',
      },
    ];
    const item = {
      document_slot: 'Family Income Certificate',
      document_type: 'INCOME_CERTIFICATE',
      problem_code: 'deficiency.problem.document_expired',
      fix_code: 'deficiency.fix.upload_current_certificate',
      deadline_at: '2026-10-14T00:00:00.000Z',
    };
    const n = renderDeficiencyNotice(rows, 'en', 'VS-1', [
      { ...item, crop_url: '/api/v1/applications/a/deficiencies/items/i/crop' },
      { ...item, crop_url: null },
    ]);
    expect(n.body).toBe(
      '1. Income certificate: expired\n   See: /api/v1/applications/a/deficiencies/items/i/crop\n2. Income certificate: expired',
    );
  });
});

describe('certificate validity per scheme (Phase 13D, M37)', () => {
  const DEFAULT = { INCOME_CERTIFICATE: 12 };
  it('the default applies when the scheme version sets nothing', () => {
    expect(validityMonthsFor({ rules: [] }, DEFAULT)).toEqual({ INCOME_CERTIFICATE: 12 });
    expect(validityMonthsFor(null, DEFAULT)).toEqual({ INCOME_CERTIFICATE: 12 });
  });

  it('a scheme version can use different months, add a type, or drop a rule', () => {
    const nfst = {
      deficiency_policy: {
        document_validity_months: { INCOME_CERTIFICATE: 6, CASTE_CERTIFICATE: 60 },
      },
    };
    expect(validityMonthsFor(nfst, DEFAULT)).toEqual({
      INCOME_CERTIFICATE: 6,
      CASTE_CERTIFICATE: 60,
    });
    const none = { deficiency_policy: { document_validity_months: { INCOME_CERTIFICATE: null } } };
    expect(validityMonthsFor(none, DEFAULT)).toEqual({});
    const bad = {
      deficiency_policy: { document_validity_months: { INCOME_CERTIFICATE: 0, MARKSHEET: 'x' } },
    };
    expect(validityMonthsFor(bad, DEFAULT)).toEqual({ INCOME_CERTIFICATE: 12 });
  });

  it('the same certificate expires under one scheme and not another; no rule never expires', () => {
    const ev = slot({
      extraction: { ...slot().extraction!, values: { issue_date: '2026-01-15' } },
    });
    const six = {
      validityMonths: validityMonthsFor(
        { deficiency_policy: { document_validity_months: { INCOME_CERTIFICATE: 6 } } },
        DEFAULT,
      ),
      now: new Date('2026-09-29T00:00:00Z'),
    };
    const twelve = {
      validityMonths: validityMonthsFor({}, DEFAULT),
      now: new Date('2026-09-29T00:00:00Z'),
    };
    const none = {
      validityMonths: validityMonthsFor(
        { deficiency_policy: { document_validity_months: { INCOME_CERTIFICATE: null } } },
        DEFAULT,
      ),
      now: new Date('2030-01-01T00:00:00Z'),
    };
    expect(runSlotCheck('DOCUMENT_VALIDITY', ev, six).problem_code).toBe(PROBLEM.DOCUMENT_EXPIRED);
    expect(runSlotCheck('DOCUMENT_VALIDITY', ev, twelve).outcome).toBe('PASS');
    expect(runSlotCheck('DOCUMENT_VALIDITY', ev, none).outcome).toBe('NOT_APPLICABLE');
  });
});
