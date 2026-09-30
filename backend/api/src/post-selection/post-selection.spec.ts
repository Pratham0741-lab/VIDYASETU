import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { grievanceIntents } from '../notifications/notification-intents';
import { canonicalJson, contentHash } from './canonical';
import { computeEntitlement, readReleaseSchedule, splitAnnualAmount } from './entitlement';
import { qrPayload, renderSanctionOrderPdf, SanctionOrderContent } from './sanction-order.pdf';
import {
  grievanceDueAt,
  NOT_RENEWABLE_REASON,
  objectionWindowClosesAt,
  RENEWAL_TENURE_RULES,
} from './policies';

type SeedVersion = {
  scheme_code: string;
  version_no: number;
  effective_to: string | null;
  config: { rules: Array<Record<string, unknown>> };
};
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];
const active = (code: string) =>
  SEED.find((v) => v.scheme_code === code && v.effective_to === null)!.config;
const version = (code: string, n: number) =>
  SEED.find((v) => v.scheme_code === code && v.version_no === n)!.config;
const recorded = { category: 'ST', is_hosteller: false, family_income_annual: 250000 };

describe('entitlement from the real benefits[] data (decision B)', () => {
  it('TOP_CLASS v3: 36000 + 5000 INR to the student; tuition and computer grant reported, not guessed', () => {
    const e = computeEntitlement(active('TOP_CLASS'), recorded);
    expect(e.instalments).toEqual([
      {
        currency: 'INR',
        beneficiary_type: 'STUDENT_DBT',
        payment_mode: 'PFMS_DBT',
        amount: 41000,
        lines: [
          expect.objectContaining({ benefit_id: 'living_expenses_stipend', amount_annual: 36000 }),
          expect.objectContaining({
            benefit_id: 'books_and_stationery_grant',
            amount_annual: 5000,
          }),
        ],
      },
    ]);
    expect(e.unschedulable.map((u) => u.benefit_id)).toEqual([
      'top_class_tuition_fees',
      'computer_hardware_grant',
    ]);
    expect(e.unschedulable[0].reason).toBe('no numeric amount is stated');
    expect(e.unschedulable[1].reason).toContain('course_year');
  });

  it('NFST v4: JRF/SRF stipends have null amounts and unrecorded conditions - nothing is scheduled', () => {
    const e = computeEntitlement(version('NFST', 4), recorded);
    expect(e.instalments).toEqual([]);
    expect(e.unschedulable.map((u) => u.benefit_id)).toEqual(
      expect.arrayContaining(['jrf_monthly_stipend', 'srf_monthly_stipend']),
    );
  });

  describe('NFST v5 (Phase 12, M16 decision D1: working rates pending confirmation)', () => {
    const v5 = version('NFST', 5);
    const stipend = (year?: number) =>
      computeEntitlement(
        v5,
        year === undefined ? recorded : { ...recorded, academic_year_number: year },
      );

    it.each([
      [1, 'jrf_monthly_stipend', 444000],
      [2, 'jrf_monthly_stipend', 444000],
      [3, 'srf_monthly_stipend', 504000],
      [5, 'srf_monthly_stipend', 504000],
    ])('PhD year %i: %s, %i INR a year', (year, id, annual) => {
      const e = stipend(year);
      expect(e.instalments).toHaveLength(1);
      expect(e.instalments[0]).toMatchObject({ amount: annual, beneficiary_type: 'STUDENT_DBT' });
      expect(e.instalments[0].lines.map((l) => l.benefit_id)).toEqual([id]);
    });

    it('never guesses the tier: no recorded PhD year schedules nothing; year 6 is past tenure', () => {
      expect(stipend().instalments).toEqual([]);
      expect(stipend().unschedulable.map((u) => u.benefit_id)).toEqual(
        expect.arrayContaining(['jrf_monthly_stipend', 'srf_monthly_stipend']),
      );
      expect(stipend(6).instalments).toEqual([]);
    });

    it('HRA and contingency stay unscheduled (out of scope); rates are marked pending', () => {
      const ids = stipend(1).unschedulable.map((u) => u.benefit_id);
      expect(ids).toEqual(
        expect.arrayContaining(['research_contingency_grant', 'house_rent_allowance_hra']),
      );
      expect(readReleaseSchedule(v5)).toEqual({
        cadence: 'QUARTERLY',
        instalments_per_year: 4,
        rates_status: 'PENDING_CONFIRMATION',
      });
    });
  });

  it('release cadence: annual unless a version says otherwise; splits sum exactly', () => {
    expect(readReleaseSchedule(active('TOP_CLASS')).cadence).toBe('ANNUAL');
    expect(readReleaseSchedule(active('POST_MATRIC')).cadence).toBe('ANNUAL');
    expect(splitAnnualAmount(444000, 4)).toEqual([111000, 111000, 111000, 111000]);
    expect(splitAnnualAmount(504000, 4)).toEqual([126000, 126000, 126000, 126000]);
    const odd = splitAnnualAmount(100, 3);
    expect(odd).toEqual([33.33, 33.33, 33.34]);
    expect(Math.round(odd.reduce((a, b) => a + b, 0) * 100)).toBe(10000);
    expect(splitAnnualAmount(41000, 1)).toEqual([41000]);
  });

  it('NOS v2: USD/GBP lines depend on an unrecorded destination_country - reported', () => {
    const e = computeEntitlement(active('NOS'), recorded);
    expect(e.instalments).toEqual([]);
    expect(
      e.unschedulable.find((u) => u.benefit_id === 'nos_maintenance_allowance_usd')!.reason,
    ).toContain('destination_country');
  });

  it('never sums across currencies; a false condition is not applicable, not an error', () => {
    const cfg = {
      benefits: [
        {
          id: 'a',
          condition: 'true',
          currency: 'INR',
          amount_annual: 100,
          disbursement_channel: 'STUDENT_DBT',
        },
        {
          id: 'b',
          condition: 'true',
          currency: 'USD',
          amount_annual: 7,
          disbursement_channel: 'STUDENT_DBT',
        },
        {
          id: 'c',
          condition: 'applicant.is_hosteller == true',
          currency: 'INR',
          amount_annual: 9,
          disbursement_channel: 'STUDENT_DBT',
        },
        {
          id: 'd',
          condition: 'true',
          currency: 'INR',
          amount_monthly: 5,
          disbursement_channel: 'STUDENT_DBT',
        },
      ],
    };
    const e = computeEntitlement(cfg, recorded);
    expect(e.instalments.map((i) => [i.currency, i.amount])).toEqual([
      ['INR', 100],
      ['USD', 7],
    ]);
    expect(e.not_applicable).toEqual([
      { benefit_id: 'c', condition: 'applicant.is_hosteller == true' },
    ]);
    expect(e.unschedulable).toEqual([
      {
        benefit_id: 'd',
        reason: 'only a monthly amount is stated; the number of months per year is not',
      },
    ]);
  });
});

describe('canonical content hash', () => {
  it('is independent of key order and whitespace, sensitive to any value change', () => {
    const a = { b: 1, a: { y: [1, 2], x: 'é' } };
    const b = JSON.parse('{ "a": { "x": "é", "y": [1, 2] }, "b": 1 }') as unknown;
    expect(canonicalJson(a)).toBe('{"a":{"x":"é","y":[1,2]},"b":1}');
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash({ ...a, b: 2 })).not.toBe(contentHash(a));
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('renewal policy matches the real seeded tenure rules (decision A)', () => {
  it('renewable exactly where the active version has that eligibility-type tenure rule', () => {
    for (const [code, ruleId] of Object.entries(RENEWAL_TENURE_RULES)) {
      const rule = active(code).rules.find((r) => r.id === ruleId)!;
      expect([code, rule.type]).toEqual([code, 'eligibility']);
    }
    expect(Object.keys(NOT_RENEWABLE_REASON).sort()).toEqual([
      'POST_MATRIC',
      'PRE_MATRIC',
      'TOP_CLASS',
    ]);
    for (const code of Object.keys(NOT_RENEWABLE_REASON)) {
      expect(NOT_RENEWABLE_REASON[code]).toContain('not machine-checkable by this system');
    }
  });
});

describe('windows and SLAs', () => {
  it('objection window closes N days after the run; grievance SLA per status', () => {
    const t0 = new Date('2026-09-27T00:00:00.000Z');
    expect(objectionWindowClosesAt(t0, 15).toISOString()).toBe('2026-10-12T00:00:00.000Z');
    expect(grievanceDueAt('OPEN', t0)?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(grievanceDueAt('RESOLVED', t0)).toBeNull();
  });
});

describe('grievance notification intents', () => {
  const e = {
    application_id: 'a',
    application_no: 'VS-1',
    applicant_id: 'p',
    jurisdiction_state: 'Jharkhand',
    jurisdiction_district: 'Ranchi',
    grievance_id: 'g',
    subject_type: 'DISBURSEMENT',
    previous_status: null,
    status: 'OPEN' as const,
    current_stage: 'DISBURSED',
    sla_due_at: null,
    resolution_note: null,
    actor: { type: 'APPLICANT' as const, role: 'APPLICANT', account_id: 'x', officer_id: null },
    occurred_at: '',
  };
  it('new grievance: applicant acknowledgment + ministry (no officer acts at DISBURSED)', () => {
    expect(grievanceIntents(e).map((i) => [i.template_key, i.audience.kind])).toEqual([
      ['grievance.registered', 'APPLICANT'],
      ['officer.grievance_raised', 'OFFICERS'],
    ]);
    expect(grievanceIntents(e)[1].audience).toMatchObject({ roles: ['MINISTRY_OFFICER'] });
  });
  it('resolution: applicant only, with the officer note', () => {
    const r = grievanceIntents({ ...e, status: 'RESOLVED', resolution_note: 'Paid on 01-10' });
    expect(r.map((i) => i.template_key)).toEqual(['grievance.resolved']);
    expect(r[0].params.resolution_note).toBe('Paid on 01-10');
  });
});

describe('sanction order audit-chain reference (Phase 14 loose ends, D2)', () => {
  const chain = { seq: '2114', record_hash: 'a'.repeat(64) };
  it('the QR payload carries the chain record next to the content hash', () => {
    expect(qrPayload('o1', 'b'.repeat(64))).toBe(`VIDYASETU-SANCTION:o1:sha256:${'b'.repeat(64)}`);
    expect(qrPayload('o1', 'b'.repeat(64), chain)).toBe(
      `VIDYASETU-SANCTION:o1:sha256:${'b'.repeat(64)}:audit-seq:2114:audit-hash:${'a'.repeat(64)}`,
    );
  });

  it('the PDF metadata states the content hash and the chain record', async () => {
    const content = {
      format: 'vidyasetu-sanction-order/v1',
      sanction_order_id: 'o1',
      sanction_date: '2026-09-29',
      application_no: 'VS-X',
      applicant_name: 'Test Scholar',
      scheme_code: 'NFST',
      scheme_name: 'NFST',
      scheme_version_no: 5,
      academic_year: '2026-27',
      vertical_category: 'ST_OTHERS',
      horizontal_reservation: null,
      merit_rank: 1,
      selection_basis: 'RANKED_NO_CAP',
      selection_run_id: 'r1',
      annual_entitlement: [],
      unschedulable_benefits: [],
      not_applicable_benefits: [],
    } as unknown as SanctionOrderContent;
    const pdf = (await renderSanctionOrderPdf(content, 'b'.repeat(64), chain)).toString('latin1');
    expect(pdf).toContain(`audit-seq:2114; audit-hash:${'a'.repeat(64)}`);
  });
});
