import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveFormSchema } from '../schemes/form-schema';
import {
  canonicalTypeForSlot,
  CANONICAL_DOCUMENT_TYPES,
  SLOT_DOCUMENT_TYPE,
} from './document-types';
import { consistencyStatus, routeByConfidence } from './review-routing';

type SeedVersion = { scheme_code: string; effective_to: string | null; config: unknown };
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];

describe('checklist slot -> canonical document type', () => {
  it('covers every slot of every active seeded version (Phase 3 derivation)', () => {
    const slots = new Set(
      SEED.filter((v) => v.effective_to === null).flatMap(
        (v) => deriveFormSchema(v.config).documents.checklist,
      ),
    );
    const missing = [...slots].filter(
      (s) => !Object.prototype.hasOwnProperty.call(SLOT_DOCUMENT_TYPE, s),
    );
    expect(missing).toEqual([]);
  });

  it('maps only to canonical types (or explicit null)', () => {
    for (const t of Object.values(SLOT_DOCUMENT_TYPE)) {
      if (t !== null) expect(CANONICAL_DOCUMENT_TYPES).toContain(t);
    }
    expect(canonicalTypeForSlot('Family Income Certificate')).toBe('INCOME_CERTIFICATE');
    expect(canonicalTypeForSlot('Aadhar Number')).toBeNull();
    expect(canonicalTypeForSlot('constructor')).toBeNull();
    expect(canonicalTypeForSlot('never seen before')).toBeNull();
  });

  it('routing compares the classifier output with the slot canonical type', () => {
    const conf = { applicant_name: 0.95 };
    const ok = routeByConfidence(
      conf,
      0.85,
      { type: 'INCOME_CERTIFICATE', confidence: 0.92 },
      'INCOME_CERTIFICATE',
    );
    expect(ok.review_status).toBe('AUTO_ACCEPTED');
    const slotText = routeByConfidence(
      conf,
      0.85,
      { type: 'INCOME_CERTIFICATE', confidence: 0.92 },
      'MARKSHEET',
    );
    expect(slotText.reasons).toEqual(['classified document type differs from the uploaded slot']);
    const unmapped = routeByConfidence(conf, 0.85, { type: 'MARKSHEET', confidence: 0.99 }, null);
    expect(unmapped.review_status).toBe('NEEDS_REVIEW');
    expect(unmapped.reasons[0]).toContain('no canonical document type');
  });

  it('a consistency result with no checks is UNCERTAIN, never CONSISTENT', () => {
    expect(consistencyStatus({}, {}, 0.8)).toBe('UNCERTAIN');
  });
});
