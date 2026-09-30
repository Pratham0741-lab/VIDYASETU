import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { schemeConfigIssues } from '../schemes/config-validation';
import { SelectionPolicyError, selectionPolicyFor } from './selection-policies';

type Seed = { scheme_code: string; version_no: number; config: Record<string, unknown> };
const SEED = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as Seed[];

const base = (selection_policy?: unknown) => ({
  rules: [
    {
      id: 'category_match',
      type: 'eligibility',
      expr: 'applicant.category in params.allowed',
      params: { allowed: ['ST', 'PVTG'] },
      doc_refs: [],
      message_key: 'eligibility.category',
      verification: { status: 'PENDING_AUDIT' },
    },
    {
      id: 'forest_merit',
      type: 'operational',
      expr: 'params.w_exam * applicant.exam_score + params.w_field * applicant.field_score',
      params: { w_exam: 0.7, w_field: 0.3 },
      doc_refs: [],
      message_key: 'selection.merit_score',
    },
  ],
  benefits: [],
  required_documents: [],
  fund_sharing_ratio: null,
  ...(selection_policy === undefined ? {} : { selection_policy }),
});

describe('declared selection basis (Phase 16, M51)', () => {
  it('no seeded version declares one', () => {
    expect(SEED.filter((v) => 'selection_policy' in v.config)).toEqual([]);
  });

  it('without a declaration, an unknown operational rule is still refused (unchanged)', () => {
    expect(() => selectionPolicyFor(base())).toThrow(SelectionPolicyError);
  });

  it('RANKED_NO_CAP reads the declared rule result, like NFST', () => {
    const p = selectionPolicyFor(
      base({
        basis: 'RANKED_NO_CAP',
        merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' },
      }),
    );
    expect(p).toMatchObject({
      basis: 'RANKED_NO_CAP',
      merit: {
        ruleId: 'forest_merit',
        scoreType: 'forest_merit',
        direction: 'HIGHER_IS_BETTER',
        read: 'RESULT_VALUE',
      },
    });
  });

  it('QUOTA uses the existing pool and female-earmark shapes, like NOS', () => {
    const p = selectionPolicyFor(
      base({
        basis: 'QUOTA',
        merit: { rule_id: 'forest_merit', direction: 'LOWER_IS_BETTER' },
        pools: [
          { key: 'ST_OTHERS', seats: 3, female_percentage: 30 },
          { key: 'PVTG', seats: 1 },
        ],
      }),
    );
    expect(p).toMatchObject({
      basis: 'QUOTA',
      pools: [
        {
          key: 'ST_OTHERS',
          seats: 3,
          eligibleTags: ['ST'],
          reservations: [{ key: 'FEMALE', minimum: { percentage: 30, rounding: 'HALF_UP' } }],
        },
        { key: 'PVTG', seats: 1, eligibleTags: ['PVTG'], reservations: [] },
      ],
    });
  });

  it('NO_COMPETITION overrides the rule-id mapping even with an operational rule present', () => {
    expect(selectionPolicyFor(base({ basis: 'NO_COMPETITION' })).basis).toBe('NO_COMPETITION');
  });

  it.each([
    [{ basis: 'LOTTERY' }, 'scheme_config.schema_violation'],
    [{ basis: 'RANKED_NO_CAP' }, 'scheme_config.schema_violation'],
    [
      {
        basis: 'NO_COMPETITION',
        merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' },
      },
      'scheme_config.schema_violation',
    ],
    [
      {
        basis: 'QUOTA',
        merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' },
        pools: [{ key: 'GENERAL', seats: 2 }],
      },
      'scheme_config.schema_violation',
    ],
    [
      {
        basis: 'RANKED_NO_CAP',
        merit: { rule_id: 'category_match', direction: 'HIGHER_IS_BETTER' },
      },
      'scheme_config.selection_policy_invalid',
    ],
    [
      { basis: 'RANKED_NO_CAP', merit: { rule_id: 'no_such_rule', direction: 'HIGHER_IS_BETTER' } },
      'scheme_config.selection_policy_invalid',
    ],
    [
      {
        basis: 'QUOTA',
        merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' },
        pools: [
          { key: 'ST_OTHERS', seats: 1 },
          { key: 'ST_OTHERS', seats: 2 },
        ],
      },
      'scheme_config.selection_policy_invalid',
    ],
  ])('authoring refuses %j with %s', (policy, key) => {
    expect(schemeConfigIssues(base(policy)).map((i) => i.message_key)).toContain(key);
  });

  it('a valid declaration passes authoring validation', () => {
    expect(
      schemeConfigIssues(
        base({
          basis: 'RANKED_NO_CAP',
          merit: { rule_id: 'forest_merit', direction: 'HIGHER_IS_BETTER' },
        }),
      ),
    ).toEqual([]);
  });
});
