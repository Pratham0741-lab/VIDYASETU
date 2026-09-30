import { RuleError } from './errors';

export const MAX_EXPRESSION_LENGTH = 2000;

export type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'identifier'; value: string; pos: number }
  | { type: 'keyword'; value: 'true' | 'false' | 'null' | 'in' | 'matches'; pos: number }
  | { type: 'operator'; value: string; pos: number }
  | { type: 'eof'; pos: number };

const KEYWORDS = new Set(['true', 'false', 'null', 'in', 'matches']);

// Longest first, so "<=" wins over "<".
const OPERATORS = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '!',
  '?',
  ':',
  '(',
  ')',
  '.',
];

const IDENTIFIER_START = /[A-Za-z_]/;
const IDENTIFIER_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

/**
 * Converts expression text into tokens. Every character outside the grammar
 * (backticks, double quotes, `;`, `[`, `{`, `=`, `$`, ...) is a PARSE_ERROR,
 * so template literals, statements and JS syntax never reach the parser.
 */
export function tokenize(source: string): Token[] {
  if (typeof source !== 'string') {
    throw new RuleError('PARSE_ERROR', 'Expression must be a string.');
  }
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new RuleError(
      'LIMIT_EXCEEDED',
      `Expression is longer than ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    if (DIGIT.test(ch)) {
      const start = i;
      while (i < source.length && DIGIT.test(source[i])) i++;
      if (source[i] === '.' && DIGIT.test(source[i + 1] ?? '')) {
        i++;
        while (i < source.length && DIGIT.test(source[i])) i++;
      }
      if (IDENTIFIER_START.test(source[i] ?? '')) {
        throw new RuleError('PARSE_ERROR', `Invalid number at position ${start}.`, start);
      }
      tokens.push({ type: 'number', value: Number(source.slice(start, i)), pos: start });
      continue;
    }

    if (ch === "'") {
      const start = i;
      let value = '';
      i++;
      for (;;) {
        if (i >= source.length) {
          throw new RuleError(
            'PARSE_ERROR',
            `Unterminated string starting at position ${start}.`,
            start,
          );
        }
        const c = source[i];
        if (c === "'") {
          i++;
          break;
        }
        if (c === '\n' || c === '\r') {
          throw new RuleError('PARSE_ERROR', `Line break inside string at position ${i}.`, i);
        }
        if (c === '\\') {
          const next = source[i + 1];
          if (next === "'" || next === '\\') {
            value += next;
            i += 2;
            continue;
          }
          throw new RuleError('PARSE_ERROR', `Unsupported escape sequence at position ${i}.`, i);
        }
        value += c;
        i++;
      }
      tokens.push({ type: 'string', value, pos: start });
      continue;
    }

    if (IDENTIFIER_START.test(ch)) {
      const start = i;
      while (i < source.length && IDENTIFIER_PART.test(source[i])) i++;
      const word = source.slice(start, i);
      if (KEYWORDS.has(word)) {
        tokens.push({
          type: 'keyword',
          value: word as 'true' | 'false' | 'null' | 'in' | 'matches',
          pos: start,
        });
      } else {
        tokens.push({ type: 'identifier', value: word, pos: start });
      }
      continue;
    }

    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'operator', value: op, pos: i });
      i += op.length;
      continue;
    }

    throw new RuleError(
      'PARSE_ERROR',
      `Unexpected character ${JSON.stringify(ch)} at position ${i}.`,
      i,
    );
  }

  tokens.push({ type: 'eof', pos: source.length });
  return tokens;
}
