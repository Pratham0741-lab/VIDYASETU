import { slotResult } from './document-readiness';
import {
  academicYearStart,
  enteredMarks,
  institutionMatch,
  nameMatch,
  normaliseCategory,
  parseAmount,
  parseDate,
  schemeLimits,
  VerificationContext,
  verifyDocument,
} from './document-verification';

const now = new Date('2026-10-01T10:00:00.000Z');
const ctx: VerificationContext = {
  applicant_name: 'Sonal Kumari Oraon',
  category: 'ST',
  entered_income: 180000,
  entered_percentage: 78.5,
  entered_marks: null,
  institution_name: 'Government Girls High School Ranchi',
  institution_code: 'JH20123',
  academic_year: '2026-27',
  income_ceiling: 200000,
  min_percentage: 50,
  income_validity_months: 12,
  now,
};
const status = (v: ReturnType<typeof verifyDocument>, rule: string) =>
  v!.checks.find((c) => c.rule === rule)?.status;

describe('fuzzy matching', () => {
  it('names: case, spacing, titles, initials, word order, OCR noise', () => {
    expect(nameMatch('SONAL  KUMARI ORAON', 'Sonal Kumari Oraon')).toBe(1);
    expect(nameMatch('Kumari Sonal K. Oraon', 'Sonal Kumari Oraon')).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch('Smt. S. K. Oraon', 'Sonal Kumari Oraon')).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch('Sona1 Kumarl 0raon', 'Sonal Kumari Oraon')).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch('Sonal Oraon', 'Sonal Kumari Oraon')).toBeGreaterThanOrEqual(0.8);
    expect(nameMatch('Rahul Verma', 'Sonal Kumari Oraon')).toBeLessThan(0.8);
  });

  it('amounts and dates: Indian grouping, lakh, Devanagari digits, OCR letters, formats', () => {
    expect(parseAmount('Rs. 2,40,000/-')).toBe(240000);
    expect(parseAmount('₹ १,८०,०००')).toBe(180000);
    expect(parseAmount('2.4 lakh')).toBe(240000);
    expect(parseAmount('1,8O,OOO')).toBe(180000);
    expect(parseAmount('not stated')).toBeNull();
    for (const d of [
      '2026-03-14',
      '14/03/2026',
      '14-03-26',
      '14.03.2026',
      '14 March 2026',
      '14-Mar-2026',
      '१४/०३/२०२६',
      '14 / 03 / 2026',
    ]) {
      expect(parseDate(d)?.toISOString().slice(0, 10)).toBe('2026-03-14');
    }
    expect(parseDate('03/2026')).toBeNull(); // partial
    expect(parseDate('31/02/2026')).toBeNull();
  });

  it('categories, institutions, academic years', () => {
    expect(normaliseCategory('Scheduled Tribe')).toBe('ST');
    expect(normaliseCategory('S.T.')).toBe('ST');
    expect(normaliseCategory('ST_OTHERS')).toBe('ST');
    expect(normaliseCategory('अनुसूचित जनजाति')).toBe('ST');
    expect(normaliseCategory('Scheduled Caste (SC)')).toBe('SC');
    expect(normaliseCategory('Other Backward Class')).toBe('OBC');
    expect(
      institutionMatch(
        'GOVT. GIRLS HIGH SCHOOL, RANCHI',
        'Government Girls High School Ranchi',
        null,
      ),
    ).toBe(true);
    expect(
      institutionMatch(
        'Government Girls High Schoo1, Ranchi',
        'Government Girls High School Ranchi',
        null,
      ),
    ).toBe(true);
    expect(
      institutionMatch(
        'GGHS Ranchi (UDISE JH20123)',
        'Government Girls High School Ranchi',
        'JH20123',
      ),
    ).toBe(true);
    expect(
      institutionMatch(
        'St. Xavier College, Ranchi',
        'Government Girls High School Ranchi',
        'JH20123',
      ),
    ).toBe(false);
    expect(academicYearStart('2026-2027')).toBe(2026);
    expect(academicYearStart('२०२६-२७')).toBe(2026);
  });

  it('scheme limits come from the scheme config, entered marks from the declared answers', () => {
    const config = {
      rules: [
        {
          id: 'income_ceiling',
          type: 'eligibility',
          expr: 'applicant.family_income_annual <= params.income_ceiling',
          params: { income_ceiling: 250000 },
          doc_refs: [],
        },
        {
          id: 'min_marks',
          type: 'eligibility',
          expr: 'applicant.previous_percentage >= params.min_percentage',
          params: { min_percentage: 60 },
          doc_refs: [],
        },
      ],
      required_documents: [],
    };
    expect(schemeLimits(config)).toEqual({
      income_ceiling: 250000,
      min_percentage: 60,
      income_validity_months: 12,
    });
    expect(schemeLimits({ rules: [], required_documents: [] }).income_ceiling).toBeNull();
    expect(enteredMarks({ previous_percentage: '78.5', board: 'JAC' })).toEqual({
      percentage: 78.5,
      marks: null,
    });
  });
});

describe('income certificate: within 10% of the entered income, in both directions', () => {
  const entered = { ...ctx, entered_income: 100000, income_ceiling: 1_000_000 };
  const verify = (income: number) =>
    verifyDocument(
      'INCOME_CERTIFICATE',
      { family_income_annual: income, issued_date: '12/04/2026' },
      entered,
    )!;
  const incomeCheck = (income: number) =>
    verify(income).checks.find((c) => c.rule === 'income_entered');

  it('equal: verified', () => {
    expect(verify(100000).result).toBe('VERIFIED');
    expect(incomeCheck(100000)).toMatchObject({
      status: 'PASS',
      extracted: 100000,
      expected: 100000,
    });
  });

  it('5% lower: verified', () => {
    expect(verify(95000).result).toBe('VERIFIED');
  });

  it('40% lower: flagged for the officer with both figures', () => {
    expect(verify(60000).result).toBe('FLAGGED');
    expect(incomeCheck(60000)).toMatchObject({
      status: 'FAIL',
      extracted: 60000,
      expected: 100000,
    });
  });

  it('40% higher: flagged for the officer with both figures', () => {
    expect(verify(140000).result).toBe('FLAGGED');
    expect(incomeCheck(140000)).toMatchObject({
      status: 'FAIL',
      extracted: 140000,
      expected: 100000,
    });
  });

  it('the row reads "Received, officer will review" with the income flag', () => {
    const doc = {
      state: 'AUTO_ACCEPTED',
      quality: { issues: [] },
      extraction: {
        status: 'COMPLETED',
        classification: { type: 'INCOME_CERTIFICATE', confidence: 0.98, matches_slot: true },
        review_status: 'AUTO_ACCEPTED',
        review_threshold: 0.85,
        fields: [{ name: 'family_income_annual', value: 60000, review: 'AUTO_ACCEPTED' }],
        eligibility_mismatches: null,
        processed_at: '2026-09-30T10:00:00.000Z',
      },
    };
    expect(slotResult('income_certificate', doc, false, verify(60000))).toMatchObject({
      outcome: 'RECEIVED_FLAGGED',
      reasons: [
        { code: 'rule_failed', rule: 'income_entered', extracted: 60000, expected: 100000 },
      ],
      flags: ['income_entered'],
    });
  });
});

describe('income certificate', () => {
  const read = {
    family_income_annual: 'Rs. 1,80,000',
    issued_date: '12/04/2026',
    applicant_name: 'Sonal Kumari',
    certificate_number: 'INC/2026/001',
  };

  it('pass: within the ceiling and the entered income; name and number optional', () => {
    const v = verifyDocument('INCOME_CERTIFICATE', read, ctx);
    expect(v!.result).toBe('VERIFIED');
    expect(
      verifyDocument(
        'INCOME_CERTIFICATE',
        { ...read, applicant_name: null, certificate_number: null },
        ctx,
      )!.result,
    ).toBe('VERIFIED');
    // Within 10% above the entered income is still a match.
    expect(
      verifyDocument('INCOME_CERTIFICATE', { ...read, family_income_annual: 195000 }, ctx)!.result,
    ).toBe('VERIFIED');
    // A partial date never downgrades it.
    expect(
      verifyDocument('INCOME_CERTIFICATE', { ...read, issued_date: '04/2026' }, ctx)!.result,
    ).toBe('VERIFIED');
  });

  it('fail: above the scheme ceiling, far above the entered income, expired, another name', () => {
    const over = verifyDocument(
      'INCOME_CERTIFICATE',
      { ...read, family_income_annual: '2,40,000' },
      ctx,
    )!;
    expect(over.result).toBe('FLAGGED');
    expect(over.checks.find((c) => c.rule === 'income_ceiling')).toMatchObject({
      status: 'FAIL',
      extracted: 240000,
      expected: 200000,
    });
    expect(
      status(
        verifyDocument(
          'INCOME_CERTIFICATE',
          { ...read, family_income_annual: 199999 },
          { ...ctx, entered_income: 120000 },
        ),
        'income_entered',
      ),
    ).toBe('FAIL');
    expect(
      status(
        verifyDocument('INCOME_CERTIFICATE', { ...read, issued_date: '01/01/2025' }, ctx),
        'income_validity',
      ),
    ).toBe('FAIL');
    expect(
      status(
        verifyDocument('INCOME_CERTIFICATE', { ...read, applicant_name: 'Rahul Verma' }, ctx),
        'name_match',
      ),
    ).toBe('FAIL');
  });

  it('unreadable: no income read -> officer verifies', () => {
    const v = verifyDocument('INCOME_CERTIFICATE', { ...read, family_income_annual: null }, ctx)!;
    expect(v.result).toBe('UNREAD');
    expect(status(v, 'income_read')).toBe('NOT_READ');
  });
});

describe('ST / caste certificate', () => {
  const read = {
    category: 'Scheduled Tribe (ST)',
    applicant_name: 'SONAL KUMARI ORAON',
    issued_date: '10-01-2024',
    caste_cert_number: null,
  };

  it('pass: same category (PVTG holds an ST certificate), certificate number optional', () => {
    expect(verifyDocument('CASTE_CERTIFICATE', read, ctx)!.result).toBe('VERIFIED');
    expect(verifyDocument('CASTE_CERTIFICATE', read, { ...ctx, category: 'PVTG' })!.result).toBe(
      'VERIFIED',
    );
  });

  it('fail: another category, or an issue date in the future', () => {
    const sc = verifyDocument('CASTE_CERTIFICATE', { ...read, category: 'Scheduled Caste' }, ctx)!;
    expect(sc.result).toBe('FLAGGED');
    expect(sc.checks[0]).toMatchObject({
      rule: 'category_match',
      status: 'FAIL',
      extracted: 'SC',
      expected: 'ST',
    });
    expect(
      status(
        verifyDocument('CASTE_CERTIFICATE', { ...read, issued_date: '01/01/2027' }, ctx),
        'issue_not_future',
      ),
    ).toBe('FAIL');
  });

  it('unreadable: no category read', () => {
    expect(verifyDocument('CASTE_CERTIFICATE', { ...read, category: null }, ctx)!.result).toBe(
      'UNREAD',
    );
  });
});

describe('marksheet', () => {
  const read = {
    candidate_name: 'Sonal Kumari Oraon',
    percentage: '79.6%',
    marks_obtained: null,
    total_marks: null,
    roll_number: null,
    passing_year: null,
  };

  it('pass: above the minimum and within 2 of the entered marks; computed from marks when needed', () => {
    expect(verifyDocument('MARKSHEET', read, ctx)!.result).toBe('VERIFIED');
    expect(
      verifyDocument(
        'MARKSHEET',
        { ...read, percentage: null, marks_obtained: '393', total_marks: '500' },
        ctx,
      )!.result,
    ).toBe('VERIFIED');
    // No minimum in the scheme and nothing entered: nothing to fail.
    expect(
      verifyDocument('MARKSHEET', read, { ...ctx, min_percentage: null, entered_percentage: null })!
        .result,
    ).toBe('VERIFIED');
  });

  it('fail: below the scheme minimum, or away from the entered marks', () => {
    const low = verifyDocument(
      'MARKSHEET',
      { ...read, percentage: '42%' },
      { ...ctx, entered_percentage: 42 },
    )!;
    expect(low.result).toBe('FLAGGED');
    expect(low.checks.find((c) => c.rule === 'marks_minimum')).toMatchObject({
      status: 'FAIL',
      extracted: 42,
      expected: 50,
    });
    expect(
      status(verifyDocument('MARKSHEET', { ...read, percentage: '85' }, ctx), 'marks_entered'),
    ).toBe('FAIL');
  });

  it('unreadable: no percentage or marks', () => {
    expect(verifyDocument('MARKSHEET', { ...read, percentage: null }, ctx)!.result).toBe('UNREAD');
  });
});

describe('bonafide certificate', () => {
  const read = {
    student_name: 'Ms. Sonal K. Oraon',
    institution_name: 'Government Girls High School, Ranchi',
    academic_year: '2026-2027',
    issued_date: '20/08/2026',
  };

  it('pass: institution, current academic year, recent issue date', () => {
    expect(verifyDocument('BONAFIDE', read, ctx)!.result).toBe('VERIFIED');
  });

  it('fail: another institution, a past academic year, an old certificate', () => {
    expect(
      verifyDocument('BONAFIDE', { ...read, institution_name: 'St. Xavier College Ranchi' }, ctx)!
        .result,
    ).toBe('FLAGGED');
    expect(
      status(
        verifyDocument('BONAFIDE', { ...read, academic_year: '2023-24' }, ctx),
        'academic_year_current',
      ),
    ).toBe('FAIL');
    expect(
      status(
        verifyDocument('BONAFIDE', { ...read, issued_date: '01/06/2025' }, ctx),
        'bonafide_recent',
      ),
    ).toBe('FAIL');
  });

  it('unreadable: no institution read', () => {
    expect(verifyDocument('BONAFIDE', { ...read, institution_name: null }, ctx)!.result).toBe(
      'UNREAD',
    );
  });
});

describe('the verdict decides the checklist row', () => {
  const doc = (fields: Record<string, unknown>) => ({
    state: 'NEEDS_REVIEW',
    quality: { issues: [] },
    extraction: {
      status: 'COMPLETED',
      classification: { type: 'INCOME_CERTIFICATE', confidence: 0.6, matches_slot: true },
      // Low OCR confidence no longer decides: the rules do.
      review_status: 'NEEDS_REVIEW',
      review_threshold: 0.85,
      fields: Object.entries(fields).map(([name, value]) => ({
        name,
        value,
        review: 'NEEDS_REVIEW',
      })),
      eligibility_mismatches: null,
      processed_at: '2026-09-30T10:00:00.000Z',
    },
  });
  const slot = 'income_certificate';
  const fields = {
    family_income_annual: 180000,
    issued_date: '2026-04-12',
    applicant_name: null,
    certificate_number: null,
  };

  it('verified / flagged with the compared values / unread / nothing read', () => {
    const ok = verifyDocument('INCOME_CERTIFICATE', fields, ctx);
    expect(slotResult(slot, doc(fields), false, ok).outcome).toBe('VERIFIED');

    const over = { ...fields, family_income_annual: 240000 };
    const flagged = slotResult(
      slot,
      doc(over),
      false,
      verifyDocument('INCOME_CERTIFICATE', over, { ...ctx, entered_income: 240000 }),
    );
    expect(flagged).toMatchObject({
      outcome: 'RECEIVED_FLAGGED',
      reasons: [
        { code: 'rule_failed', rule: 'income_ceiling', extracted: 240000, expected: 200000 },
      ],
      flags: ['income_ceiling'],
    });

    const partial = { ...fields, family_income_annual: null };
    expect(
      slotResult(slot, doc(partial), false, verifyDocument('INCOME_CERTIFICATE', partial, ctx)),
    ).toMatchObject({
      outcome: 'RECEIVED_REVIEW',
      reasons: [{ code: 'missing_fields', fields: ['family_income_annual'] }],
    });

    const none = {
      family_income_annual: null,
      issued_date: null,
      applicant_name: null,
      certificate_number: null,
    };
    expect(
      slotResult(slot, doc(none), false, verifyDocument('INCOME_CERTIFICATE', none, ctx)).outcome,
    ).toBe('RECEIVED_MANUAL');
  });
});
