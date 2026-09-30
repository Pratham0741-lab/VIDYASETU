import { ComparisonNode, EvalResult, explainFailure, Operand, Value } from '../rules-engine';
import type { RuleOutcome } from './eligibility-engine';
import { referencesSensitiveField, sensitivePathsIn } from './sensitive-fields';

/**
 * Storage-side redaction for rule evaluations.
 *
 * The engine computes and the API returns the full, unredacted result (the
 * applicant may see their own values at evaluation time). What is written to
 * rule_evaluations - and therefore copied into the append-only audit_logs -
 * is this redacted form:
 *   - an operand whose source references a sensitive field (see
 *     sensitive-fields.ts) keeps its path but loses its value:
 *       { path: "applicant.family_income_annual", redacted: true }
 *   - comparison results, verdicts, operators, thresholds from params and
 *     non-sensitive operands are kept as they are;
 *   - a non-boolean value computed from a sensitive field (an operational
 *     score over income, say) is replaced by REDACTED_VALUE;
 *   - the explanation is re-rendered with the sensitive value as "[redacted]".
 */
export const REDACTION_POLICY = 'sensitive-applicant-fields/v1';

export interface RedactedOperand {
  path: string;
  redacted: true;
}

export const REDACTED_VALUE = { redacted: true } as const;

export interface PersistedEvaluation {
  result_value: Value | typeof REDACTED_VALUE | null;
  trace: unknown;
  explanation: string | null;
  /** Sensitive applicant.* paths this rule touched (withheld from storage). */
  redacted_paths: string[];
}

function isEvalResult(record: RuleOutcome['record']): record is EvalResult {
  return 'trace' in record && Array.isArray(record.trace);
}

function redactOperand(operand: Operand): Operand | RedactedOperand {
  return referencesSensitiveField(operand.path) ? { path: operand.path, redacted: true } : operand;
}

function redactNode(node: ComparisonNode) {
  return { ...node, left: redactOperand(node.left), right: redactOperand(node.right) };
}

/**
 * A non-boolean value from an expression that reads a sensitive field is
 * itself derived sensitive data. Booleans (verdicts, comparison outcomes)
 * are not sensitive on their own.
 */
function redactValue(value: Value | null, expr: string): PersistedEvaluation['result_value'] {
  if (value === null || typeof value === 'boolean') return value;
  return referencesSensitiveField(expr) ? REDACTED_VALUE : value;
}

export function toPersisted(rule: RuleOutcome): PersistedEvaluation {
  const redacted_paths = sensitivePathsIn(rule.expr);
  const result_value = redactValue(rule.value, rule.expr);

  if (!isEvalResult(rule.record)) {
    // Skipped (INFO) or error records hold no resolved values; RuleError
    // messages carry types and paths, never values.
    return { result_value, trace: rule.record, explanation: rule.explanation, redacted_paths };
  }

  const record = rule.record;
  const trace = {
    redaction: { policy: REDACTION_POLICY, redacted_paths },
    value: redactValue(record.value, rule.expr),
    trace: record.trace.map(redactNode),
    branches: record.branches,
    decisive: record.decisive ? redactNode(record.decisive) : null,
  };

  const explanation =
    rule.verdict === 'FAIL'
      ? explainFailure(rule.rule_id, record, { redactOperand: referencesSensitiveField })
      : rule.explanation;

  return { result_value, trace, explanation, redacted_paths };
}
