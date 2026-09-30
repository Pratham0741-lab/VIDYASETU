import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../common/errors/app-error';
import { diffConfigs } from './config-diff';
import { SCHEME_CONFIG_MESSAGES } from './config-messages';
import { assertValidSchemeConfig, KNOWN_WORKFLOWS, schemeConfigIssues } from './config-validation';
import { SchemeRoleGuard } from './scheme-role.guard';

type SeedVersion = { scheme_code: string; version_no: number; config: Record<string, unknown> };
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];

/** A small, complete config of a scheme that does not exist in the seed. */
const NEW_SCHEME = () => ({
  workflow: 'vidyasetu-scrutiny/v1',
  rules: [
    {
      id: 'category_match',
      type: 'eligibility',
      expr: 'applicant.category in params.allowed_categories',
      params: { allowed_categories: ['ST', 'PVTG'] },
      doc_refs: ['CASTE_CERTIFICATE'],
      message_key: 'eligibility.category_not_allowed',
      verification: { status: 'PENDING_AUDIT' },
    },
    {
      id: 'income_ceiling',
      type: 'eligibility',
      expr: 'applicant.family_income_annual <= params.max_income',
      params: { max_income: 300000 },
      doc_refs: ['INCOME_CERTIFICATE'],
      message_key: 'eligibility.income_too_high',
      verification: { status: 'PENDING_AUDIT' },
    },
    {
      id: 'arts_merit_score',
      type: 'operational',
      expr: 'params.portfolio_weight * applicant.portfolio_score + params.exam_weight * applicant.exam_score',
      params: { portfolio_weight: 0.6, exam_weight: 0.4 },
      doc_refs: [],
      message_key: 'selection.merit_score',
    },
  ],
  benefits: [
    {
      id: 'annual_grant',
      condition: 'true',
      currency: 'INR',
      amount_annual: 60000,
      disbursement_channel: 'STUDENT_DBT',
    },
  ],
  required_documents: ['CASTE_CERTIFICATE', 'INCOME_CERTIFICATE'],
  fund_sharing_ratio: null,
});

const keys = (config: unknown) => schemeConfigIssues(config).map((i) => i.message_key);

describe('scheme config validation (Phase 14 loose ends, Part A)', () => {
  it('accepts a complete new-scheme config', () => {
    expect(schemeConfigIssues(NEW_SCHEME())).toEqual([]);
    expect(KNOWN_WORKFLOWS).toEqual(['vidyasetu-scrutiny/v1']);
  });

  it('seeded configs pass, except the one rule already known to be outside the grammar', () => {
    for (const v of SEED) {
      const issues = schemeConfigIssues(v.config);
      if (v.scheme_code === 'PRE_MATRIC') {
        expect(issues.map((i) => `${i.message_key}:${i.params.rule_id}`)).toEqual([
          'scheme_config.expr_unparseable:pre_matric_class_tenure',
        ]);
      } else {
        expect([v.scheme_code, v.version_no, issues]).toEqual([v.scheme_code, v.version_no, []]);
      }
    }
  });

  it('reports every problem with a message key, in the standard error shape', () => {
    const c = NEW_SCHEME();
    c.rules[1].id = 'category_match'; // duplicate
    c.rules[2].expr = 'params.portfolio_weight * applicant.portfolio_score + params.missing_weight';
    (c.benefits[0] as Record<string, unknown>).condition = 'applicant.x ===';
    c.workflow = 'no-such-workflow';
    expect(keys(c).sort()).toEqual([
      'scheme_config.benefit_condition_unparseable',
      'scheme_config.duplicate_rule_id',
      'scheme_config.param_missing',
      'scheme_config.unknown_workflow',
    ]);
    let thrown: unknown;
    try {
      assertValidSchemeConfig(c);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const e = thrown as AppError;
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.status).toBe(400);
    expect((e.details as Array<{ field: string }>).map((d) => d.field)).toContain(
      'config.rules[2].params',
    );
  });

  it('a malformed config fails the JSON Schema before any rule is read', () => {
    expect(keys({ rules: 'x' })).toContain('scheme_config.schema_violation');
    const noVerification = NEW_SCHEME();
    delete (noVerification.rules[0] as Record<string, unknown>).verification;
    const issues = schemeConfigIssues(noVerification);
    expect(issues[0]).toMatchObject({
      field: 'config.rules[0]',
      message_key: 'scheme_config.schema_violation',
    });
    expect(keys({ ...NEW_SCHEME(), rules: [{ ...NEW_SCHEME().rules[0], type: 'magic' }] })).toEqual(
      ['scheme_config.schema_violation'],
    );
  });

  it('a blank or unparseable expression is refused (the database only checks non-blank)', () => {
    const c = NEW_SCHEME();
    c.rules[0].expr = '   ';
    c.rules[1].expr = 'applicant.family_income_annual <=';
    expect(keys(c)).toEqual(['scheme_config.expr_blank', 'scheme_config.expr_unparseable']);
  });

  it('message keys exist in English and Hindi with the same placeholders', () => {
    const en = SCHEME_CONFIG_MESSAGES.en;
    const hi = SCHEME_CONFIG_MESSAGES.hi;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect([k, ph(hi[k])]).toEqual([k, ph(en[k])]);
  });
});

describe('config diff', () => {
  it('matches rules by id and reports param, rule and top-level changes', () => {
    const a = NEW_SCHEME();
    const b = NEW_SCHEME();
    b.rules[1].params.max_income = 250000;
    b.rules.reverse(); // reordering is not a change
    b.rules.pop(); // removes category_match
    (b as Record<string, unknown>).fund_sharing_ratio = '100:0';
    expect(diffConfigs(a, b)).toEqual([
      { path: 'config.fund_sharing_ratio', change: 'changed', from: null, to: '100:0' },
      { path: 'config.rules[id=category_match]', change: 'removed', from: a.rules[0] },
      {
        path: 'config.rules[id=income_ceiling].params.max_income',
        change: 'changed',
        from: 300000,
        to: 250000,
      },
    ]);
    expect(diffConfigs(a, NEW_SCHEME())).toEqual([]);
  });
});

describe('SchemeRoleGuard', () => {
  const ctx = (role: string, capability: 'author' | 'publish') =>
    ({
      getHandler: () => capability,
      switchToHttp: () => ({ getRequest: () => ({ actor: { role } }) }),
    }) as never;
  const guard = (author: string[], publisher: string[]) =>
    new SchemeRoleGuard(
      { get: (_k: string, h: unknown) => h } as never,
      { schemes: { authorRoles: author, publisherRoles: publisher } } as never,
    );

  it('admits only the configured roles, per capability', () => {
    const g = guard(['SUPER_ADMIN', 'MINISTRY_OFFICER'], ['SUPER_ADMIN']);
    expect(g.canActivate(ctx('MINISTRY_OFFICER', 'author'))).toBe(true);
    expect(() => g.canActivate(ctx('MINISTRY_OFFICER', 'publish'))).toThrow(AppError);
    expect(() => g.canActivate(ctx('STATE_NODAL_OFFICER', 'author'))).toThrow(AppError);
    expect(
      guard(['STATE_NODAL_OFFICER'], []).canActivate(ctx('STATE_NODAL_OFFICER', 'author')),
    ).toBe(true);
  });
});
