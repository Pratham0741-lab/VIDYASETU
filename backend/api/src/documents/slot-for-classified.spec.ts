import { RECLASSIFY_MIN_CONFIDENCE, slotForClassified } from './document-types';

describe('slotForClassified: an upload in the wrong row moves to its own row', () => {
  const checklist = [
    'income_certificate',
    'caste_certificate',
    'marksheet',
    'Domicile certificate',
  ];

  it('a marksheet uploaded to the income row belongs in the marksheet row', () => {
    expect(
      slotForClassified('income_certificate', { type: 'MARKSHEET', confidence: 0.93 }, checklist),
    ).toBe('marksheet');
  });

  it('stays put when it is the right type, not confident, or has no row', () => {
    expect(
      slotForClassified(
        'income_certificate',
        { type: 'INCOME_CERTIFICATE', confidence: 0.99 },
        checklist,
      ),
    ).toBeNull();
    expect(
      slotForClassified(
        'income_certificate',
        { type: 'MARKSHEET', confidence: RECLASSIFY_MIN_CONFIDENCE - 0.01 },
        checklist,
      ),
    ).toBeNull();
    expect(
      slotForClassified(
        'income_certificate',
        { type: 'BANK_PASSBOOK', confidence: 0.95 },
        checklist,
      ),
    ).toBeNull();
    expect(
      slotForClassified(
        'income_certificate',
        { type: 'unknown_document', confidence: 0.95 },
        checklist,
      ),
    ).toBeNull();
  });
});
