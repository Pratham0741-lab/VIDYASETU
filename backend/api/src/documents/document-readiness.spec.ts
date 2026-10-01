import {
  CONSISTENCY_WAIT_MS,
  DocumentViewLike,
  officerAccepted,
  readiness,
  slotResult,
} from './document-readiness';

const done = (
  over: Partial<NonNullable<DocumentViewLike['extraction']>> = {},
): DocumentViewLike => ({
  state: 'AUTO_ACCEPTED',
  quality: { issues: [] },
  extraction: {
    status: 'COMPLETED',
    classification: { type: 'INCOME_CERTIFICATE', confidence: 0.99, matches_slot: true },
    review_status: 'AUTO_ACCEPTED',
    review_threshold: 0.85,
    fields: [{ name: 'family_income_annual', review: 'AUTO_ACCEPTED' }],
    eligibility_mismatches: null,
    processed_at: '2026-09-30T10:00:00.000Z',
    ...over,
  },
});

describe('slotResult: one row of the applicant checklist', () => {
  const slot = 'Family Income Certificate';

  it('no document / unusable file / not read / still scanning', () => {
    expect(slotResult(slot, null)).toEqual({ outcome: 'MISSING', reasons: [] });
    // Only a file unusable as a file (blank, corrupt) asks the applicant to upload again.
    expect(
      slotResult(slot, {
        state: 'QUALITY_REJECTED',
        quality: { issues: ['blank_page'] },
        extraction: null,
      }),
    ).toEqual({
      outcome: 'NEEDS_ATTENTION',
      reasons: [{ code: 'unreadable' }, { code: 'quality', issues: ['blank_page'] }],
    });
    // The pipeline gave up: received, an officer reads it.
    expect(slotResult(slot, { state: 'FAILED', quality: null, extraction: null })).toEqual({
      outcome: 'RECEIVED_MANUAL',
      reasons: [{ code: 'not_read' }],
    });
    expect(slotResult(slot, { state: 'PROCESSING', quality: null, extraction: null }).outcome).toBe(
      'SCANNING',
    );
  });

  it('auto-accepted and officer-confirmed extractions are verified', () => {
    expect(slotResult(slot, done())).toEqual({ outcome: 'VERIFIED', reasons: [] });
    expect(slotResult(slot, done({ review_status: 'OFFICER_CONFIRMED' })).outcome).toBe('VERIFIED');
  });

  it('nothing read: received, an officer checks it by hand', () => {
    const blank = done({
      review_status: 'NEEDS_REVIEW',
      fields: [
        { name: 'family_income_annual', value: null, review: 'NEEDS_REVIEW' },
        { name: 'issued_date', value: null, review: 'NEEDS_REVIEW' },
      ],
    });
    expect(slotResult(slot, blank)).toEqual({
      outcome: 'RECEIVED_MANUAL',
      reasons: [{ code: 'not_read' }],
      review_fields: ['family_income_annual', 'issued_date'],
    });
  });

  it('partly read: received, officer verifies the missing and uncertain fields', () => {
    const partial = done({
      review_status: 'NEEDS_REVIEW',
      fields: [
        { name: 'applicant_name', value: 'Sonal Kumari', review: 'AUTO_ACCEPTED' },
        { name: 'certificate_number', value: null, review: 'NEEDS_REVIEW' },
        { name: 'family_income_annual', value: 120000, review: 'NEEDS_REVIEW' },
      ],
    });
    expect(slotResult(slot, partial)).toEqual({
      outcome: 'RECEIVED_REVIEW',
      reasons: [
        { code: 'missing_fields', fields: ['certificate_number'] },
        { code: 'low_confidence', fields: ['family_income_annual'] },
      ],
      review_fields: ['certificate_number', 'family_income_annual'],
    });
  });

  it('names why a document is left to an officer', () => {
    const low = done({
      review_status: 'NEEDS_REVIEW',
      fields: [
        { name: 'family_income_annual', review: 'AUTO_ACCEPTED' },
        { name: 'issued_date', review: 'NEEDS_REVIEW' },
      ],
    });
    expect(slotResult(slot, low).outcome).toBe('RECEIVED_REVIEW');
    expect(slotResult(slot, low).reasons).toEqual([
      { code: 'low_confidence', fields: ['issued_date'] },
    ]);

    const wrong = done({
      review_status: 'NEEDS_REVIEW',
      classification: { type: 'MARKSHEET', confidence: 0.9, matches_slot: false },
    });
    expect(slotResult(slot, wrong).reasons).toEqual([
      { code: 'wrong_type', detected: 'MARKSHEET' },
    ]);

    const unsure = done({
      review_status: 'NEEDS_REVIEW',
      classification: { type: 'INCOME_CERTIFICATE', confidence: 0.5, matches_slot: true },
    });
    expect(slotResult(slot, unsure).reasons).toEqual([{ code: 'type_uncertain' }]);

    const unmapped = done({
      review_status: 'NEEDS_REVIEW',
      classification: { type: 'MARKSHEET', confidence: 0.9, matches_slot: false },
    });
    expect(slotResult('Domicile certificate', unmapped).reasons).toEqual([
      { code: 'manual_check' },
    ]);

    const unknownType = done({
      review_status: 'NEEDS_REVIEW',
      classification: { type: 'unknown_document', confidence: 0.5, matches_slot: false },
    });
    expect(slotResult(slot, unknownType).reasons).toEqual([{ code: 'type_uncertain' }]);

    // Verified onward by an officer: what was left to an officer is settled; an unusable file is not.
    expect(slotResult(slot, unknownType, true)).toEqual({ outcome: 'VERIFIED', reasons: [] });
    expect(
      slotResult(slot, { state: 'FAILED', quality: null, extraction: null }, true).outcome,
    ).toBe('VERIFIED');
    expect(
      slotResult(
        slot,
        { state: 'QUALITY_REJECTED', quality: { issues: ['blank_page'] }, extraction: null },
        true,
      ).outcome,
    ).toBe('NEEDS_ATTENTION');
    expect(officerAccepted('MINISTRY_APPROVED')).toBe(true);
    expect(officerAccepted('INO_VERIFIED')).toBe(false);
    expect(officerAccepted('DEFECTIVE')).toBe(false);

    const mismatch = done({
      eligibility_mismatches: [
        { field: 'family_income_annual', sensitive: true, source: 'recorded' },
      ],
    });
    expect(slotResult(slot, mismatch)).toEqual({
      outcome: 'RECEIVED_REVIEW',
      reasons: [{ code: 'profile_mismatch', fields: ['family_income_annual'] }],
      review_fields: ['family_income_annual'],
    });
  });
});

describe('readiness: may the application move on?', () => {
  const now = new Date('2026-09-30T10:00:30.000Z');
  const checklist = ['Family Income Certificate', 'Disability certificate (if applicable)'];
  const verified = { outcome: 'VERIFIED' as const, reasons: [] };
  const at = {
    'Family Income Certificate': '2026-09-30T10:00:00.000Z',
    'Disability certificate (if applicable)': null,
  };
  const noCheck = { status: null, checked_at: null };

  it('an optional slot may stay empty; a required one may not', () => {
    const r = readiness(checklist, { 'Family Income Certificate': verified }, at, noCheck, now);
    expect(r).toMatchObject({
      required_slots: ['Family Income Certificate'],
      ready: true,
      verified: true,
    });
    const missing = readiness(checklist, {}, {}, noCheck, now);
    expect(missing).toMatchObject({ pending_slots: ['Family Income Certificate'], ready: false });
  });

  it('a scan in progress holds it; a document needing attention does not, but is not verified', () => {
    const scanning = readiness(
      checklist,
      { 'Family Income Certificate': { outcome: 'SCANNING', reasons: [] } },
      at,
      noCheck,
      now,
    );
    expect(scanning.ready).toBe(false);
    const attention = readiness(
      checklist,
      {
        'Family Income Certificate': {
          outcome: 'NEEDS_ATTENTION',
          reasons: [{ code: 'unreadable' }],
        },
      },
      at,
      noCheck,
      now,
    );
    expect(attention).toMatchObject({
      ready: true,
      verified: false,
      attention_slots: ['Family Income Certificate'],
    });
  });

  it('documents left to an officer never hold the application: flagged for scrutiny', () => {
    const r = readiness(
      checklist,
      {
        'Family Income Certificate': {
          outcome: 'RECEIVED_REVIEW',
          reasons: [{ code: 'missing_fields', fields: ['certificate_number'] }],
          review_fields: ['certificate_number'],
        },
        'Disability certificate (if applicable)': {
          outcome: 'RECEIVED_MANUAL',
          reasons: [{ code: 'not_read' }],
        },
      },
      { ...at, 'Disability certificate (if applicable)': null },
      noCheck,
      now,
    );
    expect(r).toMatchObject({
      pending_slots: [],
      attention_slots: [],
      officer_review_slots: ['Family Income Certificate', 'Disability certificate (if applicable)'],
      review_fields: {
        'Family Income Certificate': ['certificate_number'],
        'Disability certificate (if applicable)': [],
      },
      ready: true,
      verified: false,
    });
  });

  it('waits (bounded) for the cross-document check once every slot has an extraction', () => {
    const one = ['Family Income Certificate'];
    const results = { 'Family Income Certificate': verified };
    expect(readiness(one, results, at, noCheck, now)).toMatchObject({
      consistency_pending: true,
      ready: false,
    });
    const later = new Date(Date.parse(at['Family Income Certificate']) + CONSISTENCY_WAIT_MS + 1);
    expect(readiness(one, results, at, noCheck, later).ready).toBe(true);
    const checked = { status: 'INCONSISTENT', checked_at: new Date('2026-09-30T10:00:05.000Z') };
    expect(readiness(one, results, at, checked, now)).toMatchObject({
      ready: true,
      verified: false,
    });
  });
});
