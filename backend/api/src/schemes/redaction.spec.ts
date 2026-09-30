import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { evaluateScheme, RuleOutcome } from './eligibility-engine';
import { REDACTED_VALUE, toPersisted } from './redaction';
import {
  ENCRYPTED_COLUMN_PROFILE_KEYS,
  referencesSensitiveField,
  SENSITIVE_PROFILE_KEYS,
} from './sensitive-fields';

type SeedVersion = { scheme_code: string; version_no: number; config: Record<string, unknown> };
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];
const seedConfig = (code: string, version: number) =>
  SEED.find((v) => v.scheme_code === code && v.version_no === version)!.config;

const rule = (id: string, type: string, expr: string, params: Record<string, unknown> = {}) => ({
  id,
  type,
  expr,
  params,
  doc_refs: [],
  message_key: `msg.${id}`,
});

function only(config: unknown, applicant: Record<string, unknown>, id: string): RuleOutcome {
  return evaluateScheme(config, applicant).rules.find((r) => r.rule_id === id)!;
}

describe('sensitive field classification (single source of truth)', () => {
  it('covers every column encrypted at rest on Applicant (Bytes columns)', () => {
    const applicant = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Applicant')!;
    const encrypted = applicant.fields.filter((f) => f.type === 'Bytes').map((f) => f.name);
    expect(encrypted.sort()).toEqual(['bank_account', 'caste_cert_number', 'income']);
    expect(Object.keys(ENCRYPTED_COLUMN_PROFILE_KEYS).sort()).toEqual(encrypted.sort());
  });

  it('is selective: income-derived keys are sensitive; age, category, degree, tenure are not', () => {
    expect(SENSITIVE_PROFILE_KEYS.has('family_income_annual')).toBe(true);
    for (const key of ['age', 'category', 'degree_enrolled', 'tenure_years', 'education_level']) {
      expect(SENSITIVE_PROFILE_KEYS.has(key)).toBe(false);
    }
  });

  it('detects sensitive references inside derived operand text', () => {
    expect(referencesSensitiveField('applicant.family_income_annual')).toBe(true);
    expect(referencesSensitiveField('applicant.family_income_annual / params.members')).toBe(true);
    expect(referencesSensitiveField('applicant.bank_account.ifsc')).toBe(true);
    expect(referencesSensitiveField('params.income_ceiling')).toBe(false);
    expect(referencesSensitiveField('applicant.family_income_annual_band')).toBe(false);
  });
});

describe('toPersisted on the real NOS v2 income rule', () => {
  const outcome = only(
    seedConfig('NOS', 2),
    { family_income_annual: 700000, category: 'ST' },
    'income_ceiling',
  );
  const stored = toPersisted(outcome);
  const storedJson = JSON.stringify(stored);

  it('the in-memory outcome (returned by the API) still has the real value', () => {
    expect(outcome.verdict).toBe('FAIL');
    expect(outcome.explanation).toBe(
      'family income annual 700000 is greater than income ceiling 600000 (income_ceiling)',
    );
  });

  it('the stored explanation and trace never contain the raw income', () => {
    expect(stored.explanation).toBe(
      'family income annual [redacted] is greater than income ceiling 600000 (income_ceiling)',
    );
    expect(storedJson).not.toContain('700000');
    expect(stored.redacted_paths).toEqual(['applicant.family_income_annual']);
  });

  it('keeps structure, the threshold, the comparison result and the redaction marker', () => {
    const trace = stored.trace as {
      trace: Array<{ operator: string; result: boolean; left: unknown; right: unknown }>;
      decisive: { left: unknown };
      redaction: { policy: string };
    };
    expect(trace.trace[0]).toMatchObject({
      operator: '<=',
      result: false,
      left: { path: 'applicant.family_income_annual', redacted: true },
      right: { path: 'params.income_ceiling', resolvedValue: 600000 },
    });
    expect(trace.trace[0].left).not.toHaveProperty('resolvedValue');
    expect(trace.decisive.left).toEqual({ path: 'applicant.family_income_annual', redacted: true });
    expect(trace.redaction.policy).toBe('sensitive-applicant-fields/v1');
  });
});

describe('selective, not blanket', () => {
  it('stores non-sensitive operands exactly as evaluated', () => {
    const outcome = only(seedConfig('NFST', 4), { category: 'SC' }, 'category_match');
    const stored = toPersisted(outcome);
    expect(stored.explanation).toBe(outcome.explanation);
    expect(JSON.stringify(stored.trace)).toContain('"resolvedValue":"SC"');
    expect(stored.redacted_paths).toEqual([]);
  });
});

describe('derived sensitive values', () => {
  const config = {
    rules: [
      rule(
        'per_member',
        'eligibility',
        'applicant.family_income_annual / params.members <= params.cap',
        { members: 4, cap: 100000 },
      ),
      rule('contribution', 'operational', 'applicant.family_income_annual * 0.1'),
      rule('bank_check', 'eligibility', "applicant.bank_account == 'SBIN0001234:1'"),
      rule('score', 'operational', 'applicant.exam_score * 2'),
    ],
  };
  const applicant = {
    family_income_annual: 700000,
    bank_account: 'UTIB0000123:91000000001',
    exam_score: 40,
  };
  const outcomes = Object.fromEntries(
    evaluateScheme(config, applicant).rules.map((r) => [r.rule_id, r]),
  );

  it('redacts an arithmetic operand computed from income', () => {
    const stored = toPersisted(outcomes.per_member);
    const json = JSON.stringify(stored);
    expect(json).not.toContain('175000'); // 700000 / 4
    expect(json).not.toContain('700000');
    expect(stored.explanation).toBe('[redacted] is greater than cap 100000 (per_member)');
  });

  it('redacts an operational value computed from income, keeps other computed values', () => {
    expect(outcomes.contribution.value).toBe(70000);
    const contribution = toPersisted(outcomes.contribution);
    expect(contribution.result_value).toEqual(REDACTED_VALUE);
    expect(JSON.stringify(contribution)).not.toContain('70000');
    expect(toPersisted(outcomes.score).result_value).toBe(80);
  });

  it('redacts a declared encrypted field compared with a literal', () => {
    const stored = toPersisted(outcomes.bank_check);
    expect(outcomes.bank_check.explanation).toContain('UTIB0000123:91000000001');
    expect(JSON.stringify(stored)).not.toContain('UTIB0000123:91000000001');
  });

  it('never puts a value into an eligibility type-mismatch message', () => {
    const bad = evaluateScheme(
      { rules: [rule('r', 'eligibility', 'applicant.family_income_annual + 1')] },
      { family_income_annual: 700000 },
    ).rules[0];
    expect(bad.verdict).toBe('ERROR');
    expect(JSON.stringify(toPersisted(bad))).not.toContain('700001');
    expect(bad.explanation).not.toContain('700001');
  });
});
