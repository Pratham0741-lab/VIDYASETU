/**
 * Defensive reading of scheme_versions.config (JSONB). The DB CHECK
 * constraint validates the shape on write, but this code must never trust
 * it blindly: a malformed rule becomes an ERROR outcome, not a crash.
 */
export interface SchemeRule {
  id: string;
  type: string;
  expr: string;
  params: Record<string, unknown>;
  doc_refs: string[];
  message_key: string | null;
}

export interface SchemeConfig {
  rules: SchemeRule[];
  /** Rules whose definition itself was malformed (reported, never evaluated). */
  malformed: Array<{ index: number; id: string | null; reason: string }>;
  required_documents: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function readSchemeConfig(config: unknown): SchemeConfig {
  const result: SchemeConfig = { rules: [], malformed: [], required_documents: [] };
  if (!isRecord(config)) {
    result.malformed.push({ index: -1, id: null, reason: 'config is not an object' });
    return result;
  }
  result.required_documents = stringArray(config.required_documents);

  const rules = Array.isArray(config.rules) ? config.rules : [];
  rules.forEach((raw, index) => {
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : null;
    if (!isRecord(raw) || !id || typeof raw.type !== 'string' || typeof raw.expr !== 'string') {
      result.malformed.push({ index, id, reason: 'rule needs string id, type and expr' });
      return;
    }
    result.rules.push({
      id,
      type: raw.type,
      expr: raw.expr,
      params: isRecord(raw.params) ? raw.params : {},
      doc_refs: stringArray(raw.doc_refs),
      message_key: typeof raw.message_key === 'string' ? raw.message_key : null,
    });
  });
  return result;
}

/** One entry of a scheme version's benefits[] (Phase 9: disbursement schedules). */
export interface SchemeBenefit {
  id: string;
  description: string | null;
  /** Rule-grammar expression deciding whether the line applies ("true" if absent). */
  condition: string;
  currency: string | null;
  amount_monthly: number | null;
  amount_annual: number | null;
  /** Declared payment channel, e.g. STUDENT_DBT / INSTITUTE_PFMS / MEA_MISSION. */
  disbursement_channel: string | null;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Reads benefits[] with the same defensive stance as readSchemeConfig: no
 * value is invented - a missing or non-numeric amount stays null, and the
 * caller reports the line as unschedulable.
 */
export function readBenefits(config: unknown): {
  benefits: SchemeBenefit[];
  malformed: Array<{ index: number; reason: string }>;
} {
  const out = {
    benefits: [] as SchemeBenefit[],
    malformed: [] as Array<{ index: number; reason: string }>,
  };
  if (!isRecord(config) || !Array.isArray(config.benefits)) return out;
  config.benefits.forEach((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== 'string') {
      out.malformed.push({ index, reason: 'benefit needs a string id' });
      return;
    }
    out.benefits.push({
      id: raw.id,
      description: typeof raw.description === 'string' ? raw.description : null,
      condition: typeof raw.condition === 'string' ? raw.condition : 'true',
      currency: typeof raw.currency === 'string' ? raw.currency : null,
      amount_monthly: finite(raw.amount_monthly),
      amount_annual: finite(raw.amount_annual),
      disbursement_channel:
        typeof raw.disbursement_channel === 'string' ? raw.disbursement_channel : null,
    });
  });
  return out;
}
