import type { HorizontalReservation, RoundingRule, ScoreDirection, SeatPool } from './allocator';

/**
 * The concrete VIDYASETU selection policies: how a scheme version's real
 * seeded operational rules map onto the generic allocator (allocator.ts).
 * Every policy is keyed on operational rule ids that exist in the seeded
 * configs (verified against the live scheme_versions before this was
 * written); nothing is inferred from rule text.
 *
 *   NOS v2        QUOTA          seats from nos_slots_allocation params
 *                                (17 ST, 3 PVTG, 30% female per pool);
 *                                ranked by QS World University Ranking,
 *                                lower is better (its guideline text:
 *                                "merit list based on QS ranking").
 *   NFST v4       RANKED_NO_CAP  ranked by nfst_selection_criteria (the
 *                                COMPUTED 50/50 NET + academic score).
 *                                NFST v4 HAS NO VERIFIED SEAT CAP in the
 *                                seeded policy data (its only quota table,
 *                                nfst_slots_quota, is in archived v2 for
 *                                2021-22) - so everyone is ranked and
 *                                everyone is selected. A seat cap is a
 *                                policy-data decision to be made outside
 *                                this code, never a default here.
 *   PRE_MATRIC v4, POST_MATRIC v2, TOP_CLASS v3
 *                 NO_COMPETITION no merit or quota rules: every approved
 *                                applicant is selected, unranked.
 * A version matching none of these fails loudly instead of guessing.
 *
 * Phase 16 (M51): a version may instead DECLARE its basis in
 * config.selection_policy (validated by the config JSON Schema and at
 * authoring time). A declaration is mapped onto the same three policy
 * shapes and the same allocator inputs - no new scoring and no allocator
 * change: the merit value is the declared operational rule's computed
 * result (RESULT_VALUE, as NFST's), and QUOTA pools use the existing
 * vertical keys and female earmark shape (as NOS's). No seeded version
 * declares one, so every seeded version maps exactly as before.
 */

export type SelectionBasis = 'NO_COMPETITION' | 'RANKED_NO_CAP' | 'QUOTA';

/** Where a candidate's merit value is read from (Phase 3 evidence, never recomputed). */
export type MeritSource =
  | { ruleId: string; scoreType: string; direction: ScoreDirection; read: 'RESULT_VALUE' }
  | {
      ruleId: string;
      scoreType: string;
      direction: ScoreDirection;
      read: 'TRACE_OPERAND';
      /** The declared input the rule compared, as stored in its trace. */
      operandPath: string;
    };

export type SelectionPolicy =
  | { basis: 'NO_COMPETITION'; description: string }
  | { basis: 'RANKED_NO_CAP'; description: string; merit: MeritSource; limitation: string }
  | { basis: 'QUOTA'; description: string; merit: MeritSource; pools: SeatPool[] };

/** Vertical categories (Selection.vertical_category) and the applicant categories in each. */
export const VERTICAL_FOR_CATEGORY: Readonly<Record<string, 'ST_OTHERS' | 'PVTG'>> = {
  ST: 'ST_OTHERS',
  PVTG: 'PVTG',
};

/** Horizontal reservation keys (Selection.is_female_reserved / is_pwd_reserved). */
export const FEMALE = 'FEMALE';
export const PWD = 'PWD';

/**
 * Horizontal reservations an applicant qualifies for, from recorded data
 * only. No gender recorded = not considered for FEMALE (not an error).
 * PWD: no seeded scheme defines a disability reservation or its
 * benchmark-disability threshold, so nobody is tagged PWD until policy data
 * provides one.
 */
export function reservationTagsFor(applicant: { gender: string | null }): string[] {
  return applicant.gender === 'FEMALE' ? [FEMALE] : [];
}

/**
 * Rounding for NOS's female earmark: decision C (2026-09-26), round half up.
 * Kept as data: a version's params may state its own rule
 * (female_earmark_rounding), which then wins.
 */
const DEFAULT_EARMARK_ROUNDING: RoundingRule = 'HALF_UP';
const ROUNDING_RULES: readonly RoundingRule[] = ['HALF_UP', 'FLOOR', 'CEIL'];

/** Operational rules known to carry no merit or capacity meaning (course tenure checks). */
const NON_COMPETITIVE_RULES: ReadonlySet<string> = new Set([
  'post_matric_course_tenure',
  'top_class_course_tenure',
]);

export class SelectionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectionPolicyError';
  }
}

interface ConfigRule {
  id: string;
  type: string;
  params: Record<string, unknown>;
}

function operationalRules(config: unknown): ConfigRule[] {
  const rules = (config as { rules?: unknown })?.rules;
  if (!Array.isArray(rules)) throw new SelectionPolicyError('scheme config has no rules array');
  return rules
    .filter(
      (r): r is ConfigRule =>
        typeof r === 'object' && r !== null && (r as ConfigRule).type === 'operational',
    )
    .map((r) => ({ id: String(r.id), type: r.type, params: r.params ?? {} }));
}

function nonNegativeInt(params: Record<string, unknown>, key: string, rule: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new SelectionPolicyError(`${rule}.params.${key} must be a non-negative integer`);
  }
  return v;
}

/** Pool key -> the applicant categories eligible for it (the NOS mapping, VERTICAL_FOR_CATEGORY). */
const DECLARED_POOL_TAGS: Readonly<Record<string, readonly string[]>> = {
  ST_OTHERS: ['ST'],
  PVTG: ['PVTG'],
};

interface DeclaredPolicy {
  basis?: unknown;
  merit?: { rule_id?: unknown; direction?: unknown };
  pools?: Array<{
    key?: unknown;
    seats?: unknown;
    female_percentage?: unknown;
    rounding?: unknown;
  }>;
}

/**
 * A declared basis (Phase 16, M51) as one of the existing policy shapes.
 * Refuses (never guesses) anything the shapes cannot express.
 */
function declaredPolicy(raw: unknown, rules: ConfigRule[]): SelectionPolicy {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SelectionPolicyError('selection_policy must be an object');
  }
  const d = raw as DeclaredPolicy;
  if (d.basis === 'NO_COMPETITION') {
    if (d.merit !== undefined || d.pools !== undefined) {
      throw new SelectionPolicyError('selection_policy NO_COMPETITION takes no merit or pools');
    }
    return {
      basis: 'NO_COMPETITION',
      description:
        'Declared by the scheme version: no merit or quota; every MINISTRY_APPROVED applicant is selected, not ranked.',
    };
  }
  if (d.basis !== 'RANKED_NO_CAP' && d.basis !== 'QUOTA') {
    throw new SelectionPolicyError(`unknown selection basis ${JSON.stringify(d.basis)}`);
  }
  const ruleId = d.merit?.rule_id;
  const direction = d.merit?.direction;
  if (typeof ruleId !== 'string' || !rules.some((r) => r.id === ruleId)) {
    throw new SelectionPolicyError(
      `selection_policy.merit.rule_id must name an operational rule of this version (got ${JSON.stringify(ruleId)})`,
    );
  }
  if (direction !== 'HIGHER_IS_BETTER' && direction !== 'LOWER_IS_BETTER') {
    throw new SelectionPolicyError(`unknown merit direction ${JSON.stringify(direction)}`);
  }
  const merit: MeritSource = { ruleId, scoreType: ruleId, direction, read: 'RESULT_VALUE' };
  const better = direction === 'HIGHER_IS_BETTER' ? 'higher' : 'lower';
  if (d.basis === 'RANKED_NO_CAP') {
    if (d.pools !== undefined) throw new SelectionPolicyError('RANKED_NO_CAP takes no pools');
    return {
      basis: 'RANKED_NO_CAP',
      description: `Declared by the scheme version: ranked by the ${ruleId} merit value (${better} is better); no capacity limit.`,
      merit,
      limitation:
        'Declared without a seat cap: every approved applicant with a merit value is ranked and selected.',
    };
  }
  if (!Array.isArray(d.pools) || d.pools.length === 0) {
    throw new SelectionPolicyError('QUOTA needs at least one pool');
  }
  const seen = new Set<string>();
  const pools: SeatPool[] = d.pools.map((p, i) => {
    const key = p.key;
    if (typeof key !== 'string' || !DECLARED_POOL_TAGS[key] || seen.has(key)) {
      throw new SelectionPolicyError(
        `selection_policy.pools[${i}].key must be ST_OTHERS or PVTG, once each`,
      );
    }
    seen.add(key);
    const seats = nonNegativeInt(p, 'seats', `selection_policy.pools[${i}]`);
    const reservations: HorizontalReservation[] = [];
    if (p.female_percentage !== undefined) {
      const pct = p.female_percentage;
      if (typeof pct !== 'number' || pct < 0 || pct > 100) {
        throw new SelectionPolicyError(`selection_policy.pools[${i}].female_percentage invalid`);
      }
      const rounding = (p.rounding ?? DEFAULT_EARMARK_ROUNDING) as RoundingRule;
      if (!ROUNDING_RULES.includes(rounding)) {
        throw new SelectionPolicyError(`unknown rounding rule ${JSON.stringify(p.rounding)}`);
      }
      reservations.push({ key: FEMALE, minimum: { percentage: pct, rounding } });
    } else if (p.rounding !== undefined) {
      throw new SelectionPolicyError(
        `selection_policy.pools[${i}].rounding needs female_percentage`,
      );
    }
    return { key, seats, eligibleTags: DECLARED_POOL_TAGS[key], reservations };
  });
  return {
    basis: 'QUOTA',
    description: `Declared by the scheme version: pools ${pools.map((p) => `${p.key} (${p.seats})`).join(', ')}, merit by ${ruleId} (${better} is better).`,
    merit,
    pools,
  };
}

export function selectionPolicyFor(config: unknown): SelectionPolicy {
  const rules = operationalRules(config);
  const declared = (config as { selection_policy?: unknown }).selection_policy;
  if (declared !== undefined) return declaredPolicy(declared, rules);
  const byId = new Map(rules.map((r) => [r.id, r]));

  const slots = byId.get('nos_slots_allocation');
  const priority = byId.get('nos_selection_priority_rules');
  if (slots && priority) {
    const pct = slots.params.female_earmarked_percentage;
    if (typeof pct !== 'number' || pct < 0 || pct > 100) {
      throw new SelectionPolicyError(
        'nos_slots_allocation.params.female_earmarked_percentage invalid',
      );
    }
    const stated = slots.params.female_earmark_rounding;
    const rounding = stated === undefined ? DEFAULT_EARMARK_ROUNDING : (stated as RoundingRule);
    if (!ROUNDING_RULES.includes(rounding)) {
      throw new SelectionPolicyError(`unknown rounding rule ${JSON.stringify(stated)}`);
    }
    const female: HorizontalReservation = {
      key: FEMALE,
      minimum: { percentage: pct, rounding },
    };
    return {
      basis: 'QUOTA',
      description:
        'NOS: vertical pools from nos_slots_allocation, female earmark within each pool, merit by QS World University Ranking (lower is better).',
      merit: {
        ruleId: 'nos_selection_priority_rules',
        scoreType: 'QS_WORLD_RANKING',
        direction: 'LOWER_IS_BETTER',
        read: 'TRACE_OPERAND',
        operandPath: 'applicant.university_qs_ranking',
      },
      pools: [
        {
          key: 'ST_OTHERS',
          seats: nonNegativeInt(slots.params, 'st_candidates', slots.id),
          eligibleTags: ['ST'],
          reservations: [female],
        },
        {
          key: 'PVTG',
          seats: nonNegativeInt(slots.params, 'pvtg_candidates', slots.id),
          eligibleTags: ['PVTG'],
          reservations: [female],
        },
      ],
    };
  }

  if (byId.has('nfst_selection_criteria')) {
    return {
      basis: 'RANKED_NO_CAP',
      description:
        'NFST: ranked by the nfst_selection_criteria merit score (higher is better); no capacity limit.',
      merit: {
        ruleId: 'nfst_selection_criteria',
        scoreType: 'nfst_selection_criteria',
        direction: 'HIGHER_IS_BETTER',
        read: 'RESULT_VALUE',
      },
      limitation:
        'NFST v4 has no verified seat cap in the seeded policy data (the only NFST quota table is archived v2, 2021-22). Every approved applicant is ranked and selected; a seat cap would be a policy-data decision, not a default.',
    };
  }

  const unknown = rules.filter((r) => !NON_COMPETITIVE_RULES.has(r.id)).map((r) => r.id);
  if (unknown.length > 0) {
    throw new SelectionPolicyError(
      `no selection policy for operational rule(s) ${unknown.join(', ')}; refusing to guess`,
    );
  }
  return {
    basis: 'NO_COMPETITION',
    description:
      'No merit or quota rules: every MINISTRY_APPROVED applicant is selected, not ranked.',
  };
}
