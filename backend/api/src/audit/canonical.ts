/**
 * Canonical JSON for the audit chain (Phase 13A) - THE definition of the
 * hashing rules. The database writer (audit_canonical_json, migration
 * 20260928080000_audit_chain_v2) mirrors it; the verifier checks every stored
 * hash_input against this code, so any divergence is reported, never silent.
 *
 *   objects : keys sorted by Unicode code point, no whitespace
 *   arrays  : in order
 *   strings : "..." with \ and " escaped and U+0000-U+001F as \u00xx
 *             (lowercase hex); everything else literal
 *   numbers : plain decimal - no exponent, no leading zeros, no trailing
 *             fractional zeros, no "-0"
 *   true / false / null
 *
 * JSON is parsed here with number LEXEMES preserved (never through a float),
 * so values such as 1.50, 1e21 or 64-bit integers canonicalise exactly.
 */

/** A JSON number, kept as its source text. */
export class JsonNumber {
  constructor(readonly lexeme: string) {
    if (!NUMBER.test(lexeme)) throw new Error(`not a JSON number: ${lexeme}`);
  }
}
export type JsonValue =
  null | boolean | string | JsonNumber | JsonValue[] | { [key: string]: JsonValue };

const NUMBER = /^(-)?(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export function canonicalNumber(lexeme: string): string {
  const m = NUMBER.exec(lexeme);
  if (!m) throw new Error(`not a JSON number: ${lexeme}`);
  const [, sign, int, frac = '', exp = '0'] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  let intPart: string;
  let fracPart: string;
  if (point <= 0) {
    intPart = '0';
    fracPart = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    intPart = digits + '0'.repeat(point - digits.length);
    fracPart = '';
  } else {
    intPart = digits.slice(0, point);
    fracPart = digits.slice(point);
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  fracPart = fracPart.replace(/0+$/, '');
  const abs = fracPart ? `${intPart}.${fracPart}` : intPart;
  return sign && abs !== '0' ? `-${abs}` : abs;
}

export function canonicalString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (cp < 0x20) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/** Compare by Unicode code point (UTF-16 order differs above U+FFFF). */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

export function canonicalize(value: JsonValue): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'string') return canonicalString(value);
  if (value instanceof JsonNumber) return canonicalNumber(value.lexeme);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort(compareCodePoints);
  return `{${keys.map((k) => `${canonicalString(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

/** Strict JSON parser that keeps number lexemes (RFC 8259). */
export function parseJson(text: string): JsonValue {
  let i = 0;
  const fail = (what: string): never => {
    throw new Error(`invalid JSON at ${i}: ${what}`);
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const str = (): string => {
    if (text[i] !== '"') fail('expected string');
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i++];
      if (c === '"') return out;
      if (c.charCodeAt(0) < 0x20) fail('control character in string');
      if (c !== '\\') {
        out += c;
        continue;
      }
      const e = text[i++];
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (e in simple) out += simple[e];
      else if (e === 'u') {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape');
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else fail('bad escape');
    }
  };
  const value = (): JsonValue => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const obj: Record<string, JsonValue> = {};
      ws();
      if (text[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const k = str();
        ws();
        if (text[i++] !== ':') fail('expected :');
        if (Object.prototype.hasOwnProperty.call(obj, k)) fail(`duplicate key ${k}`);
        obj[k] = value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i++] === '}') return obj;
        fail('expected , or }');
      }
    }
    if (c === '[') {
      i++;
      const arr: JsonValue[] = [];
      ws();
      if (text[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i++] === ']') return arr;
        fail('expected , or ]');
      }
    }
    if (c === '"') return str();
    for (const [word, v] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail('unexpected token');
    i += m![0].length;
    return new JsonNumber(m![0]);
  };
  const v = value();
  ws();
  if (i !== text.length) fail('trailing characters');
  return v;
}
