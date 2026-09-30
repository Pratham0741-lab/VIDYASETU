import { ComparisonOperator, Node, pathString, render } from './ast';
import { RuleError } from './errors';
import { parse } from './parser';

/** Values an expression can produce. Arrays only come from context data. */
export type Value = number | string | boolean | null | Value[];

export interface EvaluationContext {
  applicant: Record<string, unknown>;
  params: Record<string, unknown>;
}

export interface Operand {
  /** Source text of the operand: a dotted path, a literal, or a sub-expression. */
  path: string;
  resolvedValue: Value;
}

export interface ComparisonNode {
  /** Order in which the comparison was evaluated (0-based). */
  index: number;
  operator: ComparisonOperator;
  left: Operand;
  right: Operand;
  result: boolean;
  /** True when this comparison was the test of a conditional (?:). */
  conditionalTest: boolean;
}

export interface BranchNode {
  /** Source text of the conditional's test. */
  test: string;
  testValue: boolean;
  taken: 'then' | 'else';
  /** Index of the test's decisive comparison, if the test was a comparison. */
  testComparisonIndex: number | null;
}

export interface EvalResult {
  value: Value;
  /** Every comparison actually evaluated, in evaluation order. */
  trace: ComparisonNode[];
  /** Every conditional evaluated, with the branch taken. */
  branches: BranchNode[];
  /**
   * The comparison that determined `value`, or null if none did (pure
   * arithmetic or a literal). See `decisiveOf` rules in evaluate().
   */
  decisive: ComparisonNode | null;
}

export type SafeEvalOutcome = { ok: true; result: EvalResult } | { ok: false; error: RuleError };

interface Evaluated {
  value: Value;
  decisive: ComparisonNode | null;
}

/**
 * Evaluates a parsed expression against { applicant, params }.
 *
 * Decisive comparison (which comparison "explains" the result):
 *   - comparison: itself;
 *   - conditional: the decisive comparison of the branch actually taken
 *     (falls back to the test's when the branch holds no comparison);
 *   - a && b: the first operand that was false, else the last operand;
 *   - a || b: the first operand that was true, else the last operand;
 *   - !a: a's decisive comparison;
 *   - arithmetic, paths, literals: none.
 * Short-circuited sub-expressions are never evaluated and never traced.
 */
export function evaluate(node: Node, context: EvaluationContext): EvalResult {
  const trace: ComparisonNode[] = [];
  const branches: BranchNode[] = [];
  const { value, decisive } = new Evaluator(context, trace, branches).visit(node, false);
  return { value, trace, branches, decisive };
}

/** Parse + evaluate, never throwing: every failure becomes a RuleError. */
export function safeEvaluate(source: string, context: EvaluationContext): SafeEvalOutcome {
  try {
    return { ok: true, result: evaluate(parse(source), context) };
  } catch (err) {
    if (err instanceof RuleError) return { ok: false, error: err };
    return {
      ok: false,
      error: new RuleError('INTERNAL', 'The rule could not be evaluated due to an internal error.'),
    };
  }
}

class Evaluator {
  constructor(
    private readonly context: EvaluationContext,
    private readonly trace: ComparisonNode[],
    private readonly branches: BranchNode[],
  ) {}

  visit(node: Node, asConditionalTest: boolean): Evaluated {
    switch (node.kind) {
      case 'literal':
        return { value: node.value, decisive: null };

      case 'path':
        return { value: this.resolve(node), decisive: null };

      case 'unary': {
        const operand = this.visit(node.operand, false);
        if (node.operator === '!') {
          return { value: !this.boolean(operand.value, '!'), decisive: operand.decisive };
        }
        return { value: -this.number(operand.value, 'unary -'), decisive: null };
      }

      case 'arithmetic': {
        const left = this.number(this.visit(node.left, false).value, node.operator);
        const right = this.number(this.visit(node.right, false).value, node.operator);
        return { value: this.arithmetic(node.operator, left, right), decisive: null };
      }

      case 'comparison':
        return this.comparison(node, asConditionalTest);

      case 'logical': {
        const left = this.visit(node.left, false);
        const leftValue = this.boolean(left.value, node.operator);
        // Short-circuit: the deciding operand explains the result.
        if (node.operator === '&&' && !leftValue) return { value: false, decisive: left.decisive };
        if (node.operator === '||' && leftValue) return { value: true, decisive: left.decisive };
        const right = this.visit(node.right, false);
        return { value: this.boolean(right.value, node.operator), decisive: right.decisive };
      }

      case 'conditional': {
        const test = this.visit(node.test, true);
        const testValue = this.boolean(test.value, '?:');
        this.branches.push({
          test: render(node.test),
          testValue,
          taken: testValue ? 'then' : 'else',
          testComparisonIndex: test.decisive?.index ?? null,
        });
        const branch = this.visit(testValue ? node.consequent : node.alternate, false);
        return { value: branch.value, decisive: branch.decisive ?? test.decisive };
      }
    }
  }

  private comparison(
    node: Extract<Node, { kind: 'comparison' }>,
    asConditionalTest: boolean,
  ): Evaluated {
    const left = this.visit(node.left, false).value;
    const right = this.visit(node.right, false).value;
    const result = this.compare(node.operator, left, right);
    const entry: ComparisonNode = {
      index: this.trace.length,
      operator: node.operator,
      left: { path: render(node.left), resolvedValue: left },
      right: { path: render(node.right), resolvedValue: right },
      result,
      conditionalTest: asConditionalTest,
    };
    this.trace.push(entry);
    return { value: result, decisive: entry };
  }

  private compare(operator: ComparisonOperator, left: Value, right: Value): boolean {
    switch (operator) {
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const a = this.number(left, operator);
        const b = this.number(right, operator);
        if (operator === '<') return a < b;
        if (operator === '<=') return a <= b;
        if (operator === '>') return a > b;
        return a >= b;
      }
      case '==':
      case '!=': {
        const equal = this.strictEquals(left, right, operator);
        return operator === '==' ? equal : !equal;
      }
      case 'in': {
        if (!Array.isArray(right)) {
          throw typeMismatch(`'in' needs a list on its right side, got ${typeName(right)}.`);
        }
        if (Array.isArray(left)) {
          throw typeMismatch(`'in' needs a single value on its left side, got a list.`);
        }
        return right.some((item) => item === left);
      }
      case 'matches':
        return this.matches(left, right);
    }
  }

  /**
   * `matches`: the seeded right operand (params.eligible_level) is a
   * free-text sentence, never a list or code. Case-insensitive,
   * whitespace-normalized equality is the only semantics that cannot
   * produce a false pass (substring matching would let "X" match
   * "Classes IX and X"). A list on the right is supported as
   * case-insensitive membership for future structured data.
   */
  private matches(left: Value, right: Value): boolean {
    if (typeof left !== 'string') {
      throw typeMismatch(`'matches' needs text on its left side, got ${typeName(left)}.`);
    }
    const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (typeof right === 'string') return normalize(left) === normalize(right);
    if (Array.isArray(right)) {
      return right.some((item) => typeof item === 'string' && normalize(item) === normalize(left));
    }
    throw typeMismatch(`'matches' needs text or a list on its right side, got ${typeName(right)}.`);
  }

  private strictEquals(left: Value, right: Value, operator: string): boolean {
    if (left === null || right === null) return left === right;
    if (Array.isArray(left) || Array.isArray(right)) {
      throw typeMismatch(`'${operator}' cannot compare lists.`);
    }
    if (typeof left !== typeof right) {
      throw typeMismatch(`'${operator}' cannot compare ${typeName(left)} with ${typeName(right)}.`);
    }
    return left === right;
  }

  private arithmetic(operator: string, left: number, right: number): number {
    let result: number;
    switch (operator) {
      case '+':
        result = left + right;
        break;
      case '-':
        result = left - right;
        break;
      case '*':
        result = left * right;
        break;
      default:
        if (right === 0) throw new RuleError('DIVISION_BY_ZERO', 'Division by zero.');
        result = left / right;
    }
    if (!Number.isFinite(result)) {
      throw typeMismatch(`Arithmetic result is not a finite number.`);
    }
    return result;
  }

  /** Own-property lookup only: the prototype chain is never reachable. */
  private resolve(node: Extract<Node, { kind: 'path' }>): Value {
    const fullPath = pathString(node);
    let current: unknown = this.context[node.root];
    for (const segment of node.segments) {
      if (
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current) ||
        !Object.prototype.hasOwnProperty.call(current, segment)
      ) {
        throw new RuleError(
          'UNKNOWN_PATH',
          `No value provided for '${fullPath}'.`,
          undefined,
          fullPath,
        );
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return toValue(current, fullPath);
  }

  private number(value: Value, operator: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw typeMismatch(`'${operator}' needs numbers, got ${typeName(value)}.`);
    }
    return value;
  }

  private boolean(value: Value, operator: string): boolean {
    if (typeof value !== 'boolean') {
      throw typeMismatch(`'${operator}' needs true/false, got ${typeName(value)}.`);
    }
    return value;
  }
}

function toValue(raw: unknown, path: string): Value {
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw typeMismatch(`'${path}' is not a finite number.`);
    return raw;
  }
  if (Array.isArray(raw)) return raw.map((item, i) => toValue(item, `${path}[${i}]`));
  throw typeMismatch(`'${path}' is ${raw === undefined ? 'undefined' : 'an object'}, not a value.`);
}

function typeMismatch(message: string): RuleError {
  return new RuleError('TYPE_MISMATCH', message);
}

export function typeName(value: Value): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'string' ? 'text' : `a ${typeof value}`;
}
