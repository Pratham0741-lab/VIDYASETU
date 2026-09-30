import type { ComparisonOperator } from './ast';
import type { RuleError } from './errors';
import type { ComparisonNode, EvalResult, Value } from './evaluator';

/** How a comparison reads when it did NOT hold (it is what made a rule fail). */
const FAILED_PHRASE: Readonly<Record<ComparisonOperator, string>> = {
  '<=': 'is greater than',
  '<': 'is not less than',
  '>=': 'is less than',
  '>': 'is not greater than',
  '==': 'is not',
  '!=': 'is',
  in: 'is not one of',
  matches: 'does not match',
};

const MAX_TEXT_IN_EXPLANATION = 120;

/** "applicant.family_income_annual" -> "family income annual"; literals -> "". */
export function humanizeOperand(path: string): string {
  const match = /^(?:applicant|params)\.([A-Za-z0-9_.]+)$/.exec(path);
  if (!match) return '';
  return match[1].split('.').pop()!.replace(/_/g, ' ');
}

export function formatValue(value: Value): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (typeof value === 'string') {
    const shown =
      value.length > MAX_TEXT_IN_EXPLANATION
        ? `${value.slice(0, MAX_TEXT_IN_EXPLANATION - 1)}…`
        : value;
    return `'${shown}'`;
  }
  return String(value);
}

/** Placeholder rendered instead of a withheld operand value. */
export const REDACTED_TEXT = '[redacted]';

export interface ExplainOptions {
  /**
   * Returns true for operands (by their source text) whose value must not
   * appear in the sentence; they render as REDACTED_TEXT. Omitted: nothing
   * is redacted and the output is exactly the unredacted sentence.
   */
  redactOperand?: (operandPath: string) => boolean;
}

function operandText(operand: ComparisonNode['left'], options: ExplainOptions): string {
  const label = humanizeOperand(operand.path);
  const value = options.redactOperand?.(operand.path)
    ? REDACTED_TEXT
    : formatValue(operand.resolvedValue);
  return label ? `${label} ${value}` : value;
}

/**
 * The explanation for a failed rule, generated only from the trace:
 *   "{left} {operator, in words} {right} ({rule id})"
 * e.g. "family income annual 700000 is greater than income ceiling 600000 (income_ceiling)".
 */
export function explainFailure(
  ruleId: string,
  result: EvalResult,
  options: ExplainOptions = {},
): string {
  const d = result.decisive;
  if (!d) return `the rule evaluated to ${formatValue(result.value)} (${ruleId})`;
  const left = operandText(d.left, options);
  const right = operandText(d.right, options);
  return `${left} ${FAILED_PHRASE[d.operator]} ${right} (${ruleId})`;
}

/** Explanation for a rule that could not be evaluated. */
export function explainError(ruleId: string, error: RuleError): string {
  if (error.code === 'UNKNOWN_PATH' && error.path) {
    return `${humanizeOperand(error.path) || error.path} was not provided (${ruleId})`;
  }
  return `the rule could not be evaluated: ${error.message} (${ruleId})`;
}
