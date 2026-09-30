import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { parse, RuleError } from '../rules-engine';
import { SelectionPolicyError, selectionPolicyFor } from '../selection/selection-policies';
import { VIDYASETU_WORKFLOW } from '../workflow/vidyasetu-workflow';
import { schemeConfigMessage } from './config-messages';
import { ruleParamMismatches } from './rule-params';

/**
 * Validation of an authored scheme config (Phase 14 loose ends, Part A),
 * in layers, before anything is written:
 *   1. the canonical JSON Schema, schemas/scheme-config.schema.json (the
 *      same file the seed validates against, compiled with the same Ajv);
 *   2. what the database CHECK (is_valid_scheme_config) adds: a non-blank expr;
 *   3. what only code can check: unique rule ids, every expression and
 *      benefit condition parses in the rules grammar, every params.<key> an
 *      expression reads exists (the validate:rules check), and a workflow
 *      reference names a known workflow definition.
 * Every problem is reported (not just the first), each with a message key.
 */

/** Workflow definitions a version may reference (the platform has one). */
export const KNOWN_WORKFLOWS: readonly string[] = [VIDYASETU_WORKFLOW.name];

/** Upper bound for a config (the largest seeded config is about 20 KB). */
export const MAX_CONFIG_BYTES = 256 * 1024;

export interface ConfigIssue {
  field: string;
  message_key: string;
  params: Record<string, string | number>;
  constraints: Record<string, string>;
}

function schemaPath(): string {
  const candidates = [
    join(__dirname, '../../schemas/scheme-config.schema.json'),
    join(process.cwd(), 'schemas/scheme-config.schema.json'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found)
    throw new Error(`scheme-config.schema.json not found (tried ${candidates.join(', ')})`);
  return found;
}

let compiled: ValidateFunction | null = null;
function schemaValidator(): ValidateFunction {
  compiled ??= new Ajv({ allErrors: true, allowUnionTypes: true }).compile(
    JSON.parse(readFileSync(schemaPath(), 'utf8')) as object,
  );
  return compiled;
}

function issue(
  field: string,
  key: string,
  params: Record<string, string | number>,
  constraint = key.split('.')[1],
): ConfigIssue {
  return {
    field,
    message_key: key,
    params,
    constraints: { [constraint]: schemeConfigMessage(key, params) },
  };
}

function ajvIssue(e: ErrorObject): ConfigIssue {
  const path = `config${e.instancePath.replace(/\/(\d+)/g, '[$1]').replace(/\//g, '.')}`;
  return issue(
    path,
    'scheme_config.schema_violation',
    {
      path,
      detail: e.message ?? e.keyword,
    },
    e.keyword,
  );
}

const parseProblem = (expr: string): string | null => {
  try {
    parse(expr);
    return null;
  } catch (err) {
    return err instanceof RuleError ? `${err.code}: ${err.message}` : 'INTERNAL';
  }
};

export function schemeConfigIssues(config: unknown): ConfigIssue[] {
  const size = Buffer.byteLength(JSON.stringify(config ?? null), 'utf8');
  if (size > MAX_CONFIG_BYTES) {
    return [issue('config', 'scheme_config.too_large', { max_bytes: MAX_CONFIG_BYTES })];
  }
  const validate = schemaValidator();
  if (!validate(config)) return (validate.errors ?? []).map(ajvIssue);

  const issues: ConfigIssue[] = [];
  const c = config as {
    rules: Array<{ id: string; expr: string }>;
    benefits: Array<{ id: string; condition?: unknown }>;
    workflow?: string;
  };
  const seen = new Set<string>();
  c.rules.forEach((rule, i) => {
    const field = `config.rules[${i}]`;
    if (seen.has(rule.id)) {
      issues.push(issue(`${field}.id`, 'scheme_config.duplicate_rule_id', { rule_id: rule.id }));
    }
    seen.add(rule.id);
    if (rule.expr.trim().length === 0) {
      issues.push(issue(`${field}.expr`, 'scheme_config.expr_blank', { rule_id: rule.id }));
      return;
    }
    const problem = parseProblem(rule.expr);
    if (problem) {
      issues.push(
        issue(`${field}.expr`, 'scheme_config.expr_unparseable', {
          rule_id: rule.id,
          detail: problem,
        }),
      );
    }
  });
  for (const m of ruleParamMismatches(config).mismatches) {
    const i = c.rules.findIndex((r) => r.id === m.rule_id);
    issues.push(
      issue(`config.rules[${i}].params`, 'scheme_config.param_missing', {
        rule_id: m.rule_id,
        param: m.missing_key,
      }),
    );
  }
  c.benefits.forEach((b, i) => {
    if (typeof b.condition !== 'string') return;
    const problem = parseProblem(b.condition);
    if (problem) {
      issues.push(
        issue(`config.benefits[${i}].condition`, 'scheme_config.benefit_condition_unparseable', {
          benefit_id: b.id,
          detail: problem,
        }),
      );
    }
  });
  // Phase 16 (M51): a declared selection basis must map onto the platform's
  // policy shapes exactly as run-selection will map it.
  if ((config as { selection_policy?: unknown }).selection_policy !== undefined) {
    try {
      selectionPolicyFor(config);
    } catch (err) {
      if (!(err instanceof SelectionPolicyError)) throw err;
      issues.push(
        issue('config.selection_policy', 'scheme_config.selection_policy_invalid', {
          detail: err.message,
        }),
      );
    }
  }
  if (c.workflow !== undefined && !KNOWN_WORKFLOWS.includes(c.workflow)) {
    issues.push(
      issue('config.workflow', 'scheme_config.unknown_workflow', {
        workflow: c.workflow,
        known: KNOWN_WORKFLOWS.join(', '),
      }),
    );
  }
  return issues;
}

/** Throws the standard VALIDATION_ERROR with every issue, or returns quietly. */
export function assertValidSchemeConfig(config: unknown): void {
  const issues = schemeConfigIssues(config);
  if (issues.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, { details: issues as unknown as unknown[] });
  }
}
