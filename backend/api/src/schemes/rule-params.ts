/**
 * The `validate:rules` check, shared by the script (seed file and database)
 * and the scheme-authoring API: every `params.<key>` an expression reads must
 * exist in that rule's params object.
 */
export interface RuleParamMismatch {
  rule_id: string;
  missing_key: string;
  expr: string;
}

const PARAM_TOKEN = /params\.(\w+)/g;

export function ruleParamMismatches(config: unknown): {
  mismatches: RuleParamMismatch[];
  rules: number;
  tokens: number;
} {
  const out = { mismatches: [] as RuleParamMismatch[], rules: 0, tokens: 0 };
  const rules = (config as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(rules)) return out;
  for (const rule of rules as Array<Record<string, unknown>>) {
    out.rules++;
    if (typeof rule?.expr !== 'string') continue;
    const params =
      typeof rule.params === 'object' && rule.params !== null
        ? (rule.params as Record<string, unknown>)
        : {};
    for (const match of rule.expr.matchAll(PARAM_TOKEN)) {
      out.tokens++;
      if (!Object.prototype.hasOwnProperty.call(params, match[1])) {
        out.mismatches.push({
          rule_id: typeof rule.id === 'string' ? rule.id : '(no id)',
          missing_key: match[1],
          expr: rule.expr,
        });
      }
    }
  }
  return out;
}
