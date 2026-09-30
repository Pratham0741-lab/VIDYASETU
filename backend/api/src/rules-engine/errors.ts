/**
 * Every failure the rules engine can report. Expressions are untrusted,
 * officer-edited content: all failures surface as a RuleError with a code,
 * never as a raw JavaScript error.
 */
export type RuleErrorCode =
  | 'PARSE_ERROR' // tokenizer/parser rejected the text (anything outside the grammar)
  | 'UNKNOWN_ROOT' // identifier root other than `applicant` / `params`
  | 'FORBIDDEN_IDENTIFIER' // __proto__, prototype, constructor as a path segment
  | 'UNKNOWN_PATH' // path does not exist in the evaluation context (missing input)
  | 'TYPE_MISMATCH' // operator applied to operand types it does not accept
  | 'DIVISION_BY_ZERO'
  | 'LIMIT_EXCEEDED' // expression too long or nested too deeply
  | 'INTERNAL'; // unexpected failure, wrapped so it never escapes raw

export class RuleError extends Error {
  constructor(
    readonly code: RuleErrorCode,
    message: string,
    /** Character offset in the expression, for parse errors. */
    readonly position?: number,
    /** Offending path, for path errors. */
    readonly path?: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }

  toJSON(): { code: RuleErrorCode; message: string; position?: number; path?: string } {
    return { code: this.code, message: this.message, position: this.position, path: this.path };
  }
}
