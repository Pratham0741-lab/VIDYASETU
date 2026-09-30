import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectApplicantPaths,
  EvaluationContext,
  evaluate,
  explainError,
  explainFailure,
  parse,
  RuleError,
  safeEvaluate,
} from './index';

type SeedRule = { id: string; type: string; expr: string; params: Record<string, unknown> };
type SeedVersion = { scheme_code: string; version_no: number; config: { rules: SeedRule[] } };
const SEED: SeedVersion[] = JSON.parse(
  readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
) as SeedVersion[];

function seedRule(code: string, version: number, id: string): SeedRule {
  const rule = SEED.find(
    (v) => v.scheme_code === code && v.version_no === version,
  )!.config.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`seed rule ${code} v${version} ${id} not found`);
  return rule;
}

const ctx = (applicant: Record<string, unknown>, params: Record<string, unknown> = {}) => ({
  applicant,
  params,
});

function run(expr: string, context: EvaluationContext) {
  const outcome = safeEvaluate(expr, context);
  if (!outcome.ok) throw new Error(`unexpected ${outcome.error.code}: ${outcome.error.message}`);
  return outcome.result;
}

function failure(expr: string, context: EvaluationContext = ctx({})): RuleError {
  const outcome = safeEvaluate(expr, context);
  if (outcome.ok) throw new Error(`expected failure, got ${JSON.stringify(outcome.result.value)}`);
  return outcome.error;
}

describe('operators', () => {
  const c = ctx(
    { a: 7, b: 3, s: 'M.Phil', flag: true, none: null },
    { list: ['ST', 'PVTG'], cap: 7 },
  );

  it.each([
    ['applicant.a + applicant.b', 10],
    ['applicant.a - applicant.b', 4],
    ['applicant.a * applicant.b', 21],
    ['applicant.a / 2', 3.5],
    ['-applicant.b + 1', -2],
    ['applicant.a + applicant.b * 2', 13],
    ['(applicant.a + applicant.b) * 2', 20],
    ['applicant.a <= params.cap', true],
    ['applicant.a < params.cap', false],
    ['applicant.a >= 8', false],
    ['applicant.a > applicant.b', true],
    ["applicant.s == 'M.Phil'", true],
    ["applicant.s != 'M.Phil'", false],
    ['applicant.none == null', true],
    ["'ST' in params.list", true],
    ["'SC' in params.list", false],
    ["applicant.s matches ' m.phil '", true],
    ["applicant.s matches 'M.Phil, Ph.D'", false],
    ['applicant.s matches params.list', false],
    ['applicant.flag && applicant.a > 1', true],
    ['applicant.flag && applicant.a > 100', false],
    ['!applicant.flag || applicant.b == 3', true],
    ['!(applicant.a > 1)', false],
    ['true', true],
    ["'text'", 'text'],
    ['12.5', 12.5],
  ])('%s -> %p', (expr, expected) => {
    expect(run(expr, c).value).toEqual(expected);
  });

  it('matches treats a list on the right as case-insensitive membership', () => {
    expect(run("'phd' matches params.levels", ctx({}, { levels: ['M.Phil', 'PhD'] })).value).toBe(
      true,
    );
  });
});

describe('real seeded expressions', () => {
  it('parses every seeded expr except the one outside the grammar', () => {
    const rejected: string[] = [];
    for (const version of SEED) {
      for (const rule of version.config.rules) {
        try {
          parse(rule.expr);
        } catch (err) {
          expect(err).toBeInstanceOf(RuleError);
          rejected.push(`${version.scheme_code} v${version.version_no} ${rule.id}`);
        }
      }
    }
    // ['IX','X'].includes(...) uses an array literal and a method call.
    expect(rejected).toEqual([
      'PRE_MATRIC v1 pre_matric_class_tenure',
      'PRE_MATRIC v2 pre_matric_class_tenure',
      'PRE_MATRIC v3 pre_matric_class_tenure',
      'PRE_MATRIC v4 pre_matric_class_tenure',
    ]);
    expect(failure(seedRule('PRE_MATRIC', 4, 'pre_matric_class_tenure').expr).code).toBe(
      'PARSE_ERROR',
    );
  });

  describe('NOS v1 nos_age_limit (nested, right-associative ternary, unmodified)', () => {
    const rule = seedRule('NOS', 1, 'nos_age_limit');
    it.each([
      ['PostDoc', 38, true, 'params.post_doctoral_research_max_age'],
      ['PostDoc', 39, false, 'params.post_doctoral_research_max_age'],
      ['PhD', 35, true, 'params.phd_max_age'],
      ['PhD', 36, false, 'params.phd_max_age'],
      ['Master', 32, true, 'params.masters_degree_max_age'],
      ['Master', 33, false, 'params.masters_degree_max_age'],
    ])('%s, age %d -> %p (decided by %s)', (degree, age, expected, threshold) => {
      const result = run(rule.expr, ctx({ degree_enrolled: degree, age }, rule.params));
      expect(result.value).toBe(expected);
      expect(result.decisive!.right.path).toBe(threshold);
      expect(result.decisive!.left).toEqual({ path: 'applicant.age', resolvedValue: age });
      expect(result.decisive!.conditionalTest).toBe(false);
    });

    it('records the branch path taken through both conditionals', () => {
      const result = run(rule.expr, ctx({ degree_enrolled: 'Master', age: 30 }, rule.params));
      expect(result.branches.map((b) => b.taken)).toEqual(['else', 'else']);
      expect(result.trace.map((t) => [t.operator, t.result, t.conditionalTest])).toEqual([
        ['==', false, true],
        ['==', false, true],
        ['<=', true, false],
      ]);
    });
  });

  it('NFST v4 merit score is params.net_weight * net + params.academic_weight * academic', () => {
    const rule = seedRule('NFST', 4, 'nfst_selection_criteria');
    const result = run(
      rule.expr,
      ctx({ net_csir_net_score: 82, masters_or_4yr_bachelor_research_score: 71 }, rule.params),
    );
    expect(result.value).toBe(0.5 * 82 + 0.5 * 71);
    expect(result.value).toBe(76.5);
    expect(result.decisive).toBeNull();
    expect(result.trace).toEqual([]);
  });

  it('NOS v2 selection priority returns the text outcome of the branch', () => {
    const rule = seedRule('NOS', 2, 'nos_selection_priority_rules');
    expect(run(rule.expr, ctx({ university_qs_ranking: 250 }, rule.params)).value).toBe('priority');
    expect(run(rule.expr, ctx({ university_qs_ranking: 1500 }, rule.params)).value).toBe(
      'interview_pool',
    );
  });
});

describe('decisive comparison and explanations', () => {
  it('quotes the observed value and the real threshold', () => {
    const rule = seedRule('NOS', 2, 'income_ceiling');
    const result = run(rule.expr, ctx({ family_income_annual: 700000 }, rule.params));
    expect(result.value).toBe(false);
    expect(explainFailure('income_ceiling', result)).toBe(
      'family income annual 700000 is greater than income ceiling 600000 (income_ceiling)',
    );
  });

  it('for a ternary, quotes the taken branch, not the condition', () => {
    const rule = seedRule('NFST', 4, 'fellowship_tenure_limit');
    const result = run(rule.expr, ctx({ degree_enrolled: 'PhD', tenure_years: 6 }, rule.params));
    expect(explainFailure('fellowship_tenure_limit', result)).toBe(
      'tenure years 6 is greater than phd max years 5 (fellowship_tenure_limit)',
    );
  });

  it('for &&, quotes the first false operand', () => {
    const result = run(
      'applicant.a > 1 && applicant.b > 5 && applicant.a > 100',
      ctx({ a: 7, b: 3 }),
    );
    expect(result.decisive!.left.path).toBe('applicant.b');
    expect(result.trace).toHaveLength(2); // short-circuit: a > 100 never evaluated
  });

  it('for ||, quotes the first true operand', () => {
    const result = run(
      'applicant.a > 100 || applicant.b == 3 || applicant.a > 1',
      ctx({ a: 7, b: 3 }),
    );
    expect(result.decisive!.left.path).toBe('applicant.b');
    expect(result.trace).toHaveLength(2);
  });

  it('describes list membership and text matching failures', () => {
    const rule = seedRule('NFST', 4, 'category_match');
    const result = run(rule.expr, ctx({ category: 'SC' }, rule.params));
    expect(explainFailure('category_match', result)).toBe(
      "category 'SC' is not one of allowed categories ['ST', 'PVTG'] (category_match)",
    );
  });

  it('explains missing input by path', () => {
    const error = failure('applicant.age <= 35');
    expect(error.code).toBe('UNKNOWN_PATH');
    expect(explainError('nos_age_limit', error)).toBe('age was not provided (nos_age_limit)');
  });
});

describe('typed errors', () => {
  it.each([
    ['applicant.a <= 10', { a: 'ten' }, 'TYPE_MISMATCH'],
    ["applicant.a == 'x'", { a: 1 }, 'TYPE_MISMATCH'],
    ['applicant.a in applicant.a', { a: 1 }, 'TYPE_MISMATCH'],
    ['applicant.a && true', { a: 1 }, 'TYPE_MISMATCH'],
    ['applicant.a ? 1 : 2', { a: 'yes' }, 'TYPE_MISMATCH'],
    ['applicant.a / 0', { a: 1 }, 'DIVISION_BY_ZERO'],
    ['applicant.missing > 1', {}, 'UNKNOWN_PATH'],
    ['applicant.a.b > 1', { a: 5 }, 'UNKNOWN_PATH'],
    ['applicant.obj > 1', { obj: { x: 1 } }, 'TYPE_MISMATCH'],
    ['applicant.toString > 1', {}, 'UNKNOWN_PATH'],
    ['applicant.hasOwnProperty == null', {}, 'UNKNOWN_PATH'],
  ])('%s with %j -> %s', (expr, applicant, code) => {
    expect(failure(expr, ctx(applicant)).code).toBe(code);
  });

  it('rejects chained comparisons, overlong and over-nested expressions', () => {
    expect(failure('1 < 2 < 3').code).toBe('PARSE_ERROR');
    expect(failure(`applicant.a + ${'1 + '.repeat(600)}1`).code).toBe('LIMIT_EXCEEDED');
    expect(failure(`${'('.repeat(40)}1${')'.repeat(40)}`).code).toBe('LIMIT_EXCEEDED');
  });
});

describe('malicious and out-of-grammar input never executes', () => {
  const sentinel = { touched: false };
  beforeAll(() => {
    (globalThis as Record<string, unknown>).__rulesSentinel = sentinel;
  });

  it.each([
    ['process.exit(1)', 'UNKNOWN_ROOT'],
    ['require("child_process")', 'PARSE_ERROR'], // rejected at the double quote
    ["require('fs')", 'UNKNOWN_ROOT'],
    ['global.process', 'UNKNOWN_ROOT'],
    ['globalThis.__rulesSentinel', 'UNKNOWN_ROOT'],
    ['this.constructor', 'UNKNOWN_ROOT'],
    ['constructor', 'UNKNOWN_ROOT'],
    ['applicant.constructor', 'FORBIDDEN_IDENTIFIER'],
    ['applicant.__proto__.polluted', 'FORBIDDEN_IDENTIFIER'],
    ['params.prototype', 'FORBIDDEN_IDENTIFIER'],
    ['applicant.age; process.exit(1)', 'PARSE_ERROR'],
    ['applicant.age\n; process.exit(1)', 'PARSE_ERROR'],
    ['`${process.exit(1)}`', 'PARSE_ERROR'],
    ['"double quoted"', 'PARSE_ERROR'],
    ['applicant.name.toString()', 'PARSE_ERROR'],
    ['applicant["constructor"]', 'PARSE_ERROR'],
    ["['IX', 'X'].includes(applicant.class_level)", 'PARSE_ERROR'],
    ['{}', 'PARSE_ERROR'],
    ['applicant.a = 1', 'PARSE_ERROR'],
    ['(() => 1)()', 'PARSE_ERROR'],
    ['function(){}', 'PARSE_ERROR'], // rejected at '{'
    ['new Function("return 1")', 'PARSE_ERROR'], // rejected at the double quote
    ['new Function', 'UNKNOWN_ROOT'],
    ['applicant.a /* x */', 'PARSE_ERROR'],
    ['0x1F', 'PARSE_ERROR'],
    ['applicant.a\\u0028', 'PARSE_ERROR'],
    ['applicant', 'PARSE_ERROR'],
  ])('%s -> %s', (expr, code) => {
    const error = failure(expr, ctx({ age: 30, x: 'y' }));
    expect(error).toBeInstanceOf(RuleError);
    expect(error.code).toBe(code);
    expect(sentinel.touched).toBe(false);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('keeps template-looking strings as inert text', () => {
    const result = run("applicant.x == '${process.exit(1)}'", ctx({ x: '${process.exit(1)}' }));
    expect(result.value).toBe(true);
    const env = run("'${process.env.PII_ENCRYPTION_KEY}' == applicant.x", ctx({ x: 'y' }));
    expect(env.value).toBe(false);
    expect(env.trace[0].left.resolvedValue).toBe('${process.env.PII_ENCRYPTION_KEY}');
  });
});

describe('static guarantee', () => {
  it('the engine source uses no dynamic code execution', () => {
    const dir = __dirname;
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(source).not.toMatch(/\beval\s*\(|new\s+Function|\bFunction\s*\(|\bvm\b|require\s*\(/);
    }
  });
});

describe('path analysis (form schema input)', () => {
  it('collects every applicant path with its inferred type and comparisons', () => {
    const rule = seedRule('NOS', 1, 'nos_age_limit');
    const refs = collectApplicantPaths(parse(rule.expr));
    expect([...refs.keys()].sort()).toEqual(['applicant.age', 'applicant.degree_enrolled']);
    expect([...refs.get('applicant.age')!.types]).toEqual(['number']);
    expect([...refs.get('applicant.degree_enrolled')!.literalValues].sort()).toEqual([
      'PhD',
      'PostDoc',
    ]);
    expect([...refs.get('applicant.age')!.comparedWith].sort()).toEqual([
      'params.masters_degree_max_age',
      'params.phd_max_age',
      'params.post_doctoral_research_max_age',
    ]);
  });

  it('does not report params paths as form fields', () => {
    expect([...collectApplicantPaths(parse('params.a <= params.b')).keys()]).toEqual([]);
  });
});

describe('evaluate() directly', () => {
  it('throws only RuleError for bad input', () => {
    expect(() => evaluate(parse('applicant.q > 1'), ctx({}))).toThrow(RuleError);
  });
});
