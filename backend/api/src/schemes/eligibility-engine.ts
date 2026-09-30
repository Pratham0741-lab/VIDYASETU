import {
  ComparisonNode,
  EvalResult,
  explainError,
  explainFailure,
  RuleError,
  safeEvaluate,
  typeName,
  Value,
} from '../rules-engine';
import { readSchemeConfig, SchemeRule } from './scheme-config';

export type Verdict = 'PASS' | 'FAIL' | 'COMPUTED' | 'INFO' | 'ERROR';
export type Outcome = 'ELIGIBLE' | 'INELIGIBLE' | 'INDETERMINATE';

export interface RuleOutcome {
  rule_id: string;
  rule_type: string;
  message_key: string | null;
  expr: string;
  verdict: Verdict;
  /** Final value of the expression (the computed score for operational rules). */
  value: Value | null;
  /** Rendered for FAIL and ERROR only, from the trace. */
  explanation: string | null;
  /** The comparison that determined the verdict (see rules-engine evaluator). */
  decisive: ComparisonNode | null;
  /** The full evaluation record persisted to rule_evaluations.trace. */
  record: EvalResult | { error: ReturnType<RuleError['toJSON']> } | { skipped: string };
}

export interface VersionEvaluation {
  outcome: Outcome;
  eligible: boolean;
  eligibility_rule_count: number;
  rules: RuleOutcome[];
}

/** Rule types that gate eligibility / record a computed value / are informational. */
const GATING_TYPE = 'eligibility';
const COMPUTED_TYPE = 'operational';

/**
 * Evaluates every rule of a scheme version against one applicant profile.
 *
 *   eligibility  -> PASS / FAIL (must produce true/false) or ERROR
 *   operational  -> COMPUTED with its value (scores, tenure checks, ...);
 *                   recorded only, never affects the outcome
 *   anything else (benefit_note, unmapped, ...) -> INFO, not evaluated
 *
 * Outcome: any FAIL -> INELIGIBLE; otherwise any eligibility ERROR ->
 * INDETERMINATE (missing input or an unparseable rule never counts as a
 * pass); otherwise ELIGIBLE.
 */
export function evaluateScheme(
  config: unknown,
  applicant: Record<string, unknown>,
): VersionEvaluation {
  const { rules, malformed } = readSchemeConfig(config);
  const outcomes = rules.map((rule) => evaluateRule(rule, applicant));

  for (const bad of malformed) {
    outcomes.push({
      rule_id: bad.id ?? `rules[${bad.index}]`,
      rule_type: 'unknown',
      message_key: null,
      expr: '',
      verdict: 'ERROR',
      value: null,
      explanation: `the rule definition is malformed: ${bad.reason} (${bad.id ?? `rules[${bad.index}]`})`,
      decisive: null,
      record: { error: new RuleError('PARSE_ERROR', bad.reason).toJSON() },
    });
  }

  const gating = outcomes.filter((o) => o.rule_type === GATING_TYPE || o.rule_type === 'unknown');
  const outcome: Outcome = gating.some((o) => o.verdict === 'FAIL')
    ? 'INELIGIBLE'
    : gating.some((o) => o.verdict === 'ERROR')
      ? 'INDETERMINATE'
      : 'ELIGIBLE';

  return {
    outcome,
    eligible: outcome === 'ELIGIBLE',
    eligibility_rule_count: rules.filter((r) => r.type === GATING_TYPE).length,
    rules: outcomes,
  };
}

function evaluateRule(rule: SchemeRule, applicant: Record<string, unknown>): RuleOutcome {
  const base = {
    rule_id: rule.id,
    rule_type: rule.type,
    message_key: rule.message_key,
    expr: rule.expr,
  };

  if (rule.type !== GATING_TYPE && rule.type !== COMPUTED_TYPE) {
    return {
      ...base,
      verdict: 'INFO',
      value: null,
      explanation: null,
      decisive: null,
      record: { skipped: `informational rule type '${rule.type}' is not evaluated as a gate` },
    };
  }

  const evaluation = safeEvaluate(rule.expr, { applicant, params: rule.params });
  if (!evaluation.ok) {
    return {
      ...base,
      verdict: 'ERROR',
      value: null,
      explanation: explainError(rule.id, evaluation.error),
      decisive: null,
      record: { error: evaluation.error.toJSON() },
    };
  }

  const result = evaluation.result;
  if (rule.type === COMPUTED_TYPE) {
    return {
      ...base,
      verdict: 'COMPUTED',
      value: result.value,
      explanation: null,
      decisive: result.decisive,
      record: result,
    };
  }

  if (typeof result.value !== 'boolean') {
    const error = new RuleError(
      'TYPE_MISMATCH',
      // Type only, never the value: the value may be derived from a sensitive field.
      `An eligibility rule must evaluate to true or false, got ${typeName(result.value)}.`,
    );
    return {
      ...base,
      verdict: 'ERROR',
      value: result.value,
      explanation: explainError(rule.id, error),
      decisive: result.decisive,
      record: { error: error.toJSON() },
    };
  }

  return {
    ...base,
    verdict: result.value ? 'PASS' : 'FAIL',
    value: result.value,
    explanation: result.value ? null : explainFailure(rule.id, result),
    decisive: result.decisive,
    record: result,
  };
}
