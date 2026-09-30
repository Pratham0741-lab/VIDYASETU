import type { ComparisonOperator, Node } from './ast';
import { RuleError } from './errors';
import { Token, tokenize } from './tokenizer';

export const MAX_NESTING_DEPTH = 32;
export const ROOT_IDENTIFIERS = ['applicant', 'params'] as const;

/** Path segments that could reach object internals; always rejected. */
export const FORBIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', 'in', 'matches']);
const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(['==', '!=']);

/**
 * Recursive-descent parser for the rule expression grammar (lowest to
 * highest precedence):
 *
 *   expression  := logicalOr ( '?' expression ':' expression )?   right-assoc
 *   logicalOr   := logicalAnd ( '||' logicalAnd )*
 *   logicalAnd  := equality ( '&&' equality )*
 *   equality    := relational ( ('==' | '!=') relational )?        no chaining
 *   relational  := additive ( ('<'|'<='|'>'|'>='|'in'|'matches') additive )?
 *   additive    := multiplicative ( ('+' | '-') multiplicative )*
 *   multiplicative := unary ( ('*' | '/') unary )*
 *   unary       := ('!' | '-') unary | primary
 *   primary     := NUMBER | STRING | 'true' | 'false' | 'null'
 *                | ROOT ( '.' IDENTIFIER )+        ROOT is applicant | params
 *                | '(' expression ')'
 *
 * Nothing else parses: no calls, no indexing, no array/object literals, no
 * assignment, no statements.
 */
export function parse(source: string): Node {
  return new Parser(tokenize(source)).parseProgram();
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Node {
    const node = this.expression();
    const next = this.peek();
    if (next.type !== 'eof') {
      throw this.error(`Unexpected ${describe(next)} after the end of the expression`, next);
    }
    return node;
  }

  private expression(): Node {
    return this.nested(() => {
      const test = this.logicalOr();
      if (!this.matchOperator('?')) return test;
      const consequent = this.expression();
      this.expectOperator(':', 'to separate the branches of a conditional');
      const alternate = this.expression();
      return { kind: 'conditional', test, consequent, alternate };
    });
  }

  private logicalOr(): Node {
    let left = this.logicalAnd();
    while (this.matchOperator('||')) {
      left = { kind: 'logical', operator: '||', left, right: this.logicalAnd() };
    }
    return left;
  }

  private logicalAnd(): Node {
    let left = this.equality();
    while (this.matchOperator('&&')) {
      left = { kind: 'logical', operator: '&&', left, right: this.equality() };
    }
    return left;
  }

  private equality(): Node {
    const left = this.relational();
    const token = this.peek();
    if (token.type === 'operator' && EQUALITY_OPERATORS.has(token.value)) {
      this.index++;
      const right = this.relational();
      this.rejectChainedComparison();
      return { kind: 'comparison', operator: token.value as ComparisonOperator, left, right };
    }
    return left;
  }

  private relational(): Node {
    const left = this.additive();
    const operator = this.comparisonOperatorAt(this.peek());
    if (operator) {
      this.index++;
      const right = this.additive();
      this.rejectChainedComparison();
      return { kind: 'comparison', operator, left, right };
    }
    return left;
  }

  private additive(): Node {
    let left = this.multiplicative();
    for (;;) {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        this.index++;
        left = { kind: 'arithmetic', operator: token.value, left, right: this.multiplicative() };
      } else {
        return left;
      }
    }
  }

  private multiplicative(): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '*' || token.value === '/')) {
        this.index++;
        left = { kind: 'arithmetic', operator: token.value, left, right: this.unary() };
      } else {
        return left;
      }
    }
  }

  private unary(): Node {
    return this.nested(() => {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '!' || token.value === '-')) {
        this.index++;
        return { kind: 'unary', operator: token.value, operand: this.unary() };
      }
      return this.primary();
    });
  }

  private primary(): Node {
    const token = this.next();
    switch (token.type) {
      case 'number':
        return { kind: 'literal', value: token.value };
      case 'string':
        return { kind: 'literal', value: token.value };
      case 'keyword':
        if (token.value === 'true') return { kind: 'literal', value: true };
        if (token.value === 'false') return { kind: 'literal', value: false };
        if (token.value === 'null') return { kind: 'literal', value: null };
        throw this.error(`Unexpected keyword '${token.value}'`, token);
      case 'identifier':
        return this.path(token);
      case 'operator':
        if (token.value === '(') {
          const inner = this.expression();
          this.expectOperator(')', 'to close the parenthesis');
          return inner;
        }
        throw this.error(`Unexpected ${describe(token)}`, token);
      case 'eof':
        throw this.error('Unexpected end of expression', token);
    }
  }

  private path(rootToken: Extract<Token, { type: 'identifier' }>): Node {
    const root = rootToken.value;
    if (root !== 'applicant' && root !== 'params') {
      throw new RuleError(
        'UNKNOWN_ROOT',
        `Unknown identifier '${root}' at position ${rootToken.pos}: only 'applicant.' and 'params.' paths are allowed.`,
        rootToken.pos,
        root,
      );
    }

    const segments: string[] = [];
    while (this.matchOperator('.')) {
      const segment = this.next();
      if (segment.type !== 'identifier') {
        throw this.error(`Expected a property name after '.', found ${describe(segment)}`, segment);
      }
      if (FORBIDDEN_SEGMENTS.has(segment.value)) {
        throw new RuleError(
          'FORBIDDEN_IDENTIFIER',
          `'${segment.value}' is not allowed in a path (position ${segment.pos}).`,
          segment.pos,
          [root, ...segments, segment.value].join('.'),
        );
      }
      segments.push(segment.value);
    }

    if (segments.length === 0) {
      throw new RuleError(
        'PARSE_ERROR',
        `'${root}' must be followed by a property path, e.g. ${root}.some_field (position ${rootToken.pos}).`,
        rootToken.pos,
      );
    }
    // A '(' right after a path would be a call: not part of the grammar.
    const after = this.peek();
    if (after.type === 'operator' && after.value === '(') {
      throw this.error('Function calls are not allowed', after);
    }
    return { kind: 'path', root, segments };
  }

  private comparisonOperatorAt(token: Token): ComparisonOperator | null {
    if (token.type === 'operator' && COMPARISON_OPERATORS.has(token.value)) {
      return token.value as ComparisonOperator;
    }
    if (token.type === 'keyword' && (token.value === 'in' || token.value === 'matches')) {
      return token.value;
    }
    return null;
  }

  private rejectChainedComparison(): void {
    const token = this.peek();
    const chained =
      this.comparisonOperatorAt(token) !== null ||
      (token.type === 'operator' && EQUALITY_OPERATORS.has(token.value));
    if (chained) {
      throw this.error('Comparisons cannot be chained; use && to combine them', token);
    }
  }

  private nested<T>(fn: () => T): T {
    if (++this.depth > MAX_NESTING_DEPTH) {
      throw new RuleError(
        'LIMIT_EXCEEDED',
        `Expression is nested more than ${MAX_NESTING_DEPTH} levels deep.`,
      );
    }
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (token.type !== 'eof') this.index++;
    return token;
  }

  private matchOperator(value: string): boolean {
    const token = this.peek();
    if (token.type === 'operator' && token.value === value) {
      this.index++;
      return true;
    }
    return false;
  }

  private expectOperator(value: string, purpose: string): void {
    const token = this.peek();
    if (!this.matchOperator(value)) {
      throw this.error(`Expected '${value}' ${purpose}, found ${describe(token)}`, token);
    }
  }

  private error(message: string, token: Token): RuleError {
    return new RuleError('PARSE_ERROR', `${message} at position ${token.pos}.`, token.pos);
  }
}

function describe(token: Token): string {
  switch (token.type) {
    case 'eof':
      return 'end of expression';
    case 'string':
      return 'a string';
    case 'number':
      return `number ${token.value}`;
    default:
      return `'${token.value}'`;
  }
}
