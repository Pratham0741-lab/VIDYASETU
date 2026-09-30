import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../common/errors/app-error';
import { evaluateScheme } from './eligibility-engine';
import { deriveFormSchema } from './form-schema';
import { sanitizeProfile } from './profile';

type SeedVersion = { scheme_code: string; version_no: number; config: Record<string, unknown> };
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];
const config = (code: string, version: number) =>
  SEED.find((v) => v.scheme_code === code && v.version_no === version)!.config;
const ruleParams = (code: string, version: number, id: string) =>
  (config(code, version).rules as Array<{ id: string; params: Record<string, unknown> }>).find(
    (r) => r.id === id,
  )!.params;

const NFST_LEVEL = ruleParams('NFST', 4, 'education_level_match').eligible_level as string;

describe('evaluateScheme on real seeded configs', () => {
  const nfstEligible = {
    category: 'ST',
    education_level: NFST_LEVEL,
    degree_enrolled: 'PhD',
    tenure_years: 3,
    net_csir_net_score: 82,
    masters_or_4yr_bachelor_research_score: 71,
  };

  it('NFST v4: eligible, merit score computed but not gating, benefit note informational', () => {
    const result = evaluateScheme(config('NFST', 4), nfstEligible);
    expect(result.outcome).toBe('ELIGIBLE');
    const byId = Object.fromEntries(result.rules.map((r) => [r.rule_id, r]));
    expect(byId.category_match.verdict).toBe('PASS');
    expect(byId.fellowship_tenure_limit.verdict).toBe('PASS');
    expect(byId.nfst_selection_criteria).toMatchObject({ verdict: 'COMPUTED', value: 76.5 });
    expect(byId.income_criteria_exemption.verdict).toBe('INFO');
  });

  it('an operational rule error never changes the eligibility outcome', () => {
    const withoutScore: Record<string, unknown> = { ...nfstEligible };
    delete withoutScore.net_csir_net_score;
    const result = evaluateScheme(config('NFST', 4), withoutScore);
    expect(result.outcome).toBe('ELIGIBLE');
    expect(result.rules.find((r) => r.rule_id === 'nfst_selection_criteria')!.verdict).toBe(
      'ERROR',
    );
  });

  it('NFST v4: a failed rule is explained from the trace with real seeded numbers', () => {
    const result = evaluateScheme(config('NFST', 4), { ...nfstEligible, tenure_years: 6 });
    expect(result.outcome).toBe('INELIGIBLE');
    const failed = result.rules.find((r) => r.verdict === 'FAIL')!;
    expect(failed.rule_id).toBe('fellowship_tenure_limit');
    expect(failed.explanation).toBe(
      `tenure years 6 is greater than phd max years ${String(ruleParams('NFST', 4, 'fellowship_tenure_limit').phd_max_years)} (fellowship_tenure_limit)`,
    );
  });

  it('NOS v2: fails the income ceiling with the real ceiling in the explanation', () => {
    const result = evaluateScheme(config('NOS', 2), {
      ...nfstEligible,
      family_income_annual: 700000,
      age: 30,
    });
    const income = result.rules.find((r) => r.rule_id === 'income_ceiling')!;
    expect(income.verdict).toBe('FAIL');
    expect(income.explanation).toBe(
      'family income annual 700000 is greater than income ceiling 600000 (income_ceiling)',
    );
  });

  it('missing input is INDETERMINATE, never a pass', () => {
    const result = evaluateScheme(config('NFST', 4), { category: 'ST' });
    expect(result.outcome).toBe('INDETERMINATE');
    expect(result.eligible).toBe(false);
  });

  it('PRE_MATRIC v4: the out-of-grammar rule is an ERROR, so the outcome is never ELIGIBLE', () => {
    const result = evaluateScheme(config('PRE_MATRIC', 4), {
      family_income_annual: 100000,
      category: 'ST',
      education_level: ruleParams('PRE_MATRIC', 4, 'education_level_match').eligible_level,
      class_level: 'IX',
      academic_year_number: 1,
    });
    const tenure = result.rules.find((r) => r.rule_id === 'pre_matric_class_tenure')!;
    expect(tenure.verdict).toBe('ERROR');
    expect(tenure.explanation).toContain('Unexpected character "["');
    expect(result.outcome).toBe('INDETERMINATE');
  });

  it('treats an eligibility rule that does not produce true/false as an ERROR', () => {
    const cfg = {
      rules: [{ id: 'r', type: 'eligibility', expr: 'applicant.a + 1', params: {}, doc_refs: [] }],
    };
    const result = evaluateScheme(cfg, { a: 1 });
    expect(result.rules[0].verdict).toBe('ERROR');
    expect(result.outcome).toBe('INDETERMINATE');
  });

  it('reports malformed rule definitions instead of crashing', () => {
    const result = evaluateScheme({ rules: [{ id: 'x', type: 'eligibility' }, 42] }, {});
    expect(result.rules.map((r) => r.verdict)).toEqual(['ERROR', 'ERROR']);
    expect(result.outcome).toBe('INDETERMINATE');
  });
});

describe('deriveFormSchema', () => {
  it('derives NFST v4 fields and documents from the rule ASTs', () => {
    const schema = deriveFormSchema(config('NFST', 4));
    expect(schema.fields.map((f) => f.key)).toEqual([
      'category',
      'degree_enrolled',
      'education_level',
      'masters_or_4yr_bachelor_research_score',
      'net_csir_net_score',
      'tenure_years',
    ]);
    const category = schema.fields.find((f) => f.key === 'category')!;
    expect(category.options).toEqual(['ST', 'PVTG']);
    const tenure = schema.fields.find((f) => f.key === 'tenure_years')!;
    expect(tenure.types).toEqual(['number']);
    expect(tenure.limits.map((l) => [l.param, l.value])).toEqual([
      ['params.mphil_max_years', 2],
      ['params.phd_max_years', 5],
    ]);
    expect(schema.documents.checklist).toEqual(
      expect.arrayContaining(['caste_certificate', 'ugc_net_scorecard', 'bonafide_certificate']),
    );
    expect(schema.unparseable_rules).toEqual([]);
  });

  it('works for a brand-new scheme nobody wrote code for', () => {
    const schema = deriveFormSchema({
      required_documents: ['Hostel allotment letter'],
      rules: [
        {
          id: 'distance',
          type: 'eligibility',
          expr: 'applicant.hostel_distance_km >= params.min_km && applicant.mode in params.modes',
          params: { min_km: 30, modes: ['bus', 'rail'] },
          doc_refs: ['distance_certificate'],
        },
      ],
    });
    expect(schema.fields.map((f) => [f.key, f.types, f.options])).toEqual([
      ['hostel_distance_km', ['number'], []],
      ['mode', [], ['bus', 'rail']],
    ]);
    expect(schema.documents.checklist).toEqual(['Hostel allotment letter', 'distance_certificate']);
  });

  it('reports unparseable rules instead of failing the whole schema', () => {
    const schema = deriveFormSchema(config('PRE_MATRIC', 4));
    expect(schema.unparseable_rules.map((u) => u.rule_id)).toEqual(['pre_matric_class_tenure']);
    expect(schema.fields.map((f) => f.key)).toContain('family_income_annual');
  });
});

describe('sanitizeProfile', () => {
  it('copies plain values into null-prototype objects', () => {
    const profile = sanitizeProfile({ age: 30, nested: { x: 'y' }, list: ['a', 1, null] });
    expect(Object.getPrototypeOf(profile)).toBeNull();
    expect(profile.age).toBe(30);
  });

  it.each([
    [JSON.parse('{"__proto__": {"polluted": true}}') as unknown, 'JSON __proto__ key'],
    [{ constructor: 1 }, 'constructor key'],
    [{ 'bad key': 1 }, 'non-identifier key'],
    [{ a: { b: { c: { d: 1 } } } }, 'too deep'],
    [{ a: 'x'.repeat(1001) }, 'string too long'],
    [{ a: Array.from({ length: 51 }, () => 1) }, 'list too long'],
    [{ a: [{ nested: true }] }, 'object inside a list'],
    [[1, 2], 'not an object'],
  ])('rejects %j (%s)', (input) => {
    expect(() => sanitizeProfile(input)).toThrow(AppError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
