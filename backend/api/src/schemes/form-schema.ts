import { collectApplicantPaths, parse, PathReference, RuleError } from '../rules-engine';
import { readSchemeConfig } from './scheme-config';

export interface FormField {
  /** Profile key the frontend must collect (path below `applicant.`). */
  key: string;
  path: string;
  /** Types implied by how the rules use the field. */
  types: string[];
  /** Rule ids (and their types) that read the field. */
  used_by: Array<{ rule_id: string; rule_type: string }>;
  /** Allowed values, when a rule compares the field against a list or text. */
  options: string[];
  /** Numeric thresholds the field is compared against. */
  limits: Array<{ rule_id: string; param: string; value: number }>;
}

export interface FormSchema {
  fields: FormField[];
  documents: {
    required_documents: string[];
    rule_doc_refs: Array<{ doc_ref: string; rule_ids: string[] }>;
    /** Union of required_documents and every rule's doc_refs. */
    checklist: string[];
  };
  unparseable_rules: Array<{ rule_id: string; error: ReturnType<RuleError['toJSON']> }>;
}

function paramValue(params: Record<string, unknown>, paramPath: string): unknown {
  let current: unknown = params;
  for (const segment of paramPath.split('.').slice(1)) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Derives the applicant form and document checklist from a scheme version's
 * rules by walking their parsed ASTs. Nothing is keyed by scheme or rule id,
 * so a newly authored scheme gets a correct form with no code changes.
 */
export function deriveFormSchema(config: unknown): FormSchema {
  const { rules, required_documents } = readSchemeConfig(config);
  const fields = new Map<string, FormField>();
  const docRefs = new Map<string, Set<string>>();
  const unparseable: FormSchema['unparseable_rules'] = [];

  for (const rule of rules) {
    for (const ref of rule.doc_refs) {
      if (!docRefs.has(ref)) docRefs.set(ref, new Set());
      docRefs.get(ref)!.add(rule.id);
    }

    let refs: Map<string, PathReference>;
    try {
      refs = collectApplicantPaths(parse(rule.expr));
    } catch (err) {
      const error =
        err instanceof RuleError ? err : new RuleError('INTERNAL', 'Rule could not be analysed.');
      unparseable.push({ rule_id: rule.id, error: error.toJSON() });
      continue;
    }

    for (const ref of refs.values()) {
      let field = fields.get(ref.path);
      if (!field) {
        field = {
          key: ref.path.slice('applicant.'.length),
          path: ref.path,
          types: [],
          used_by: [],
          options: [],
          limits: [],
        };
        fields.set(ref.path, field);
      }
      for (const type of ref.types) {
        if (type !== 'unknown' && !field.types.includes(type)) field.types.push(type);
      }
      if (!field.used_by.some((u) => u.rule_id === rule.id)) {
        field.used_by.push({ rule_id: rule.id, rule_type: rule.type });
      }
      for (const literal of ref.literalValues) {
        if (!field.options.includes(literal)) field.options.push(literal);
      }
      for (const paramPath of ref.comparedWith) {
        const value = paramValue(rule.params, paramPath);
        if (typeof value === 'number') {
          field.limits.push({ rule_id: rule.id, param: paramPath, value });
        } else if (typeof value === 'string') {
          if (!field.options.includes(value)) field.options.push(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string' && !field.options.includes(item)) field.options.push(item);
          }
        }
      }
    }
  }

  const rule_doc_refs = [...docRefs.entries()].map(([doc_ref, ids]) => ({
    doc_ref,
    rule_ids: [...ids],
  }));
  const checklist = [...required_documents];
  for (const { doc_ref } of rule_doc_refs)
    if (!checklist.includes(doc_ref)) checklist.push(doc_ref);

  return {
    fields: [...fields.values()].sort((a, b) => a.key.localeCompare(b.key)),
    documents: { required_documents, rule_doc_refs, checklist },
    unparseable_rules: unparseable,
  };
}
