import {
  consistencyStatus,
  disagrees,
  routeByConfidence,
  SENSITIVE_MARKER,
  splitSensitive,
  thresholdFor,
} from './review-routing';
import { SENSITIVE_PROFILE_KEYS } from '../schemes/sensitive-fields';

describe('review routing', () => {
  it('uses a per-type threshold with a default fallback', () => {
    const t = { default: 0.85, 'Family Income Certificate': 0.9 };
    expect(thresholdFor(t, 'Family Income Certificate')).toBe(0.9);
    expect(thresholdFor(t, 'marksheet')).toBe(0.85);
    expect(thresholdFor(t, 'constructor')).toBe(0.85);
  });

  it('routes each field on its own confidence', () => {
    const r = routeByConfidence(
      { holder_name: 0.97, certificate_number: 0.55, issue_date: 0.94 },
      0.85,
      { type: 'income_certificate', confidence: 0.95 },
      'income_certificate',
    );
    expect(r.field_review).toEqual({
      certificate_number: 'NEEDS_REVIEW',
      holder_name: 'AUTO_ACCEPTED',
      issue_date: 'AUTO_ACCEPTED',
    });
    expect(r.review_status).toBe('NEEDS_REVIEW');
    expect(r.lowest_confidence).toBe(0.55);
  });

  it('auto-accepts only when every field and the classification clear the threshold', () => {
    const cls = { type: 'marksheet', confidence: 0.95 };
    expect(routeByConfidence({ a: 0.9, b: 0.99 }, 0.85, cls, 'marksheet').review_status).toBe(
      'AUTO_ACCEPTED',
    );
    expect(routeByConfidence({ a: 0.9 }, 0.85, cls, 'bonafide').reasons).toContain(
      'classified document type differs from the uploaded slot',
    );
    expect(
      routeByConfidence({ a: 0.9 }, 0.85, { type: 'marksheet', confidence: 0.52 }, 'marksheet')
        .review_status,
    ).toBe('NEEDS_REVIEW');
  });

  it('splits sensitive fields using the Phase 3 sensitive-field list', () => {
    const { stored, sensitive } = splitSensitive({
      holder_name: 'Kavya Oraon',
      family_income_annual: 900000,
      caste_cert_number: 'JH-ST-1',
      issue_date: '2026-04-01',
    });
    expect(stored).toEqual({
      caste_cert_number: SENSITIVE_MARKER,
      family_income_annual: SENSITIVE_MARKER,
      holder_name: 'Kavya Oraon',
      issue_date: '2026-04-01',
    });
    expect(sensitive).toEqual({ caste_cert_number: 'JH-ST-1', family_income_annual: 900000 });
    expect(JSON.stringify(stored)).not.toContain('900000');
  });

  it('encrypts an OCR-read certificate_number too (Phase 11.5, M10)', () => {
    const { stored, sensitive } = splitSensitive({
      holder_name: 'Kavya Oraon',
      certificate_number: 'JH-INC-2026-0042',
    });
    expect(stored).toEqual({ certificate_number: SENSITIVE_MARKER, holder_name: 'Kavya Oraon' });
    expect(sensitive).toEqual({ certificate_number: 'JH-INC-2026-0042' });
    expect(JSON.stringify(stored)).not.toContain('0042');
    // An extraction-only key: the Phase 3 profile list is unchanged.
    expect(SENSITIVE_PROFILE_KEYS.has('certificate_number')).toBe(false);
  });

  it('compares numbers with a relative tolerance and text case-insensitively', () => {
    expect(disagrees(900000, 350000, 0.05)).toBe(true);
    expect(disagrees(352000, 350000, 0.05)).toBe(false);
    expect(disagrees('3,50,000', 350000, 0.05)).toBe(false);
    expect(disagrees('st', 'ST', 0)).toBe(false);
    expect(disagrees('PVTG', 'ST', 0)).toBe(true);
  });

  it('never counts a field the extractor could not find as a disagreement', () => {
    // Real ML_MODE=real case: a generic document misread as a caste
    // certificate returns category null at confidence 0.
    expect(disagrees(null, 'ST', 0, 0)).toBe(false);
    expect(disagrees(null, 'ST', 0)).toBe(false);
    expect(disagrees(undefined, 'ST', 0)).toBe(false);
    expect(disagrees(null, 180000, 0.05, 0)).toBe(false);
    // A value read at zero confidence is not evidence either.
    expect(disagrees('SC', 'ST', 0, 0)).toBe(false);
    // A value that was read still counts, at any non-zero confidence.
    expect(disagrees('SC', 'ST', 0, 0.11)).toBe(true);
    expect(disagrees('ST', 'ST', 0, 0.91)).toBe(false);
    expect(disagrees(900000, 180000, 0.05, 0.93)).toBe(true);
  });

  it('turns a consistency result into CONSISTENT / INCONSISTENT / UNCERTAIN', () => {
    expect(consistencyStatus({ names_match: true }, { names_match: 0.97 }, 0.8)).toBe('CONSISTENT');
    expect(consistencyStatus({ names_match: false }, { names_match: 0.95 }, 0.8)).toBe(
      'INCONSISTENT',
    );
    expect(consistencyStatus({ names_match: false }, { names_match: 0.5 }, 0.8)).toBe('UNCERTAIN');
  });
});
