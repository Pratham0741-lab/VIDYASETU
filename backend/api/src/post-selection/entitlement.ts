import { safeEvaluate } from '../rules-engine';
import { readBenefits, SchemeBenefit } from '../schemes/scheme-config';

/**
 * The annual entitlement of one application, from its FROZEN scheme
 * version's benefits[] (read with Phase 3's config reader; conditions
 * evaluated with Phase 3's evaluator against recorded data).
 *
 * Decision B (Phase 9): one instalment per academic year = the sum of the
 * lines whose amount is numeric and whose condition evaluates true. Nothing
 * is guessed: a line is SCHEDULED, NOT_APPLICABLE (condition false), or
 * UNSCHEDULABLE with a stated reason (null amount, monthly-only amount,
 * unrecorded condition input, no currency, no known channel).
 * No currency conversion: every currency gets its own instalment row
 * (out of scope for this build; stated in the Phase 9 report).
 */
export type BeneficiaryType = 'STUDENT_DBT' | 'INSTITUTE_PFMS';

/** benefits[].disbursement_channel -> the Disbursement columns (existing vocabulary). */
const CHANNELS: Readonly<
  Record<string, { beneficiary_type: BeneficiaryType; payment_mode: string }>
> = {
  STUDENT_DBT: { beneficiary_type: 'STUDENT_DBT', payment_mode: 'PFMS_DBT' },
  INSTITUTE_PFMS: { beneficiary_type: 'INSTITUTE_PFMS', payment_mode: 'PFMS_INSTITUTE' },
  MEA_MISSION: { beneficiary_type: 'INSTITUTE_PFMS', payment_mode: 'MEA_MISSION' },
};

export interface ScheduledLine {
  benefit_id: string;
  description: string | null;
  currency: string;
  amount_annual: number;
  channel: string;
}

export interface UnschedulableLine {
  benefit_id: string;
  reason: string;
}

export interface Instalment {
  currency: string;
  beneficiary_type: BeneficiaryType;
  payment_mode: string;
  amount: number;
  lines: ScheduledLine[];
}

export interface Entitlement {
  instalments: Instalment[];
  scheduled: ScheduledLine[];
  not_applicable: Array<{ benefit_id: string; condition: string }>;
  unschedulable: UnschedulableLine[];
}

function conditionHolds(
  b: SchemeBenefit,
  profile: Readonly<Record<string, unknown>>,
): { holds: boolean } | { reason: string } {
  const result = safeEvaluate(b.condition, { applicant: profile, params: {} });
  if (!result.ok) {
    // RuleError messages carry paths and types, never values.
    return { reason: `condition "${b.condition}" could not be evaluated: ${result.error.message}` };
  }
  if (typeof result.result.value !== 'boolean') {
    return { reason: `condition "${b.condition}" does not produce true/false` };
  }
  return { holds: result.result.value };
}

export function computeEntitlement(
  config: unknown,
  profile: Readonly<Record<string, unknown>>,
): Entitlement {
  const { benefits, malformed } = readBenefits(config);
  const out: Entitlement = {
    instalments: [],
    scheduled: [],
    not_applicable: [],
    unschedulable: malformed.map((m) => ({ benefit_id: `benefits[${m.index}]`, reason: m.reason })),
  };

  for (const b of benefits) {
    const cond = conditionHolds(b, profile);
    if ('reason' in cond) {
      out.unschedulable.push({ benefit_id: b.id, reason: cond.reason });
      continue;
    }
    if (!cond.holds) {
      out.not_applicable.push({ benefit_id: b.id, condition: b.condition });
      continue;
    }
    if (b.amount_annual === null) {
      out.unschedulable.push({
        benefit_id: b.id,
        reason:
          b.amount_monthly !== null
            ? 'only a monthly amount is stated; the number of months per year is not'
            : 'no numeric amount is stated',
      });
      continue;
    }
    if (!b.currency) {
      out.unschedulable.push({ benefit_id: b.id, reason: 'no currency is stated' });
      continue;
    }
    if (!b.disbursement_channel || !CHANNELS[b.disbursement_channel]) {
      out.unschedulable.push({
        benefit_id: b.id,
        reason: `no known disbursement channel (${b.disbursement_channel ?? 'none'})`,
      });
      continue;
    }
    out.scheduled.push({
      benefit_id: b.id,
      description: b.description,
      currency: b.currency,
      amount_annual: b.amount_annual,
      channel: b.disbursement_channel,
    });
  }

  // One instalment per (currency, beneficiary channel): never sum across
  // currencies, never send an institute's money to a student's account.
  const groups = new Map<string, Instalment>();
  for (const line of out.scheduled) {
    const ch = CHANNELS[line.channel];
    const key = `${line.currency}|${ch.beneficiary_type}|${ch.payment_mode}`;
    const g = groups.get(key) ?? { currency: line.currency, ...ch, amount: 0, lines: [] };
    g.amount += line.amount_annual;
    g.lines.push(line);
    groups.set(key, g);
  }
  out.instalments = [...groups.values()].sort((a, b) =>
    `${a.currency}${a.beneficiary_type}`.localeCompare(`${b.currency}${b.beneficiary_type}`),
  );
  return out;
}

/**
 * Release cadence of a scheme version (Phase 12, M16 decision D1): the
 * optional config.disbursement_schedule. Absent = one instalment per
 * academic year (Decision B, unchanged).
 */
export interface ReleaseSchedule {
  cadence: 'ANNUAL' | 'QUARTERLY';
  instalments_per_year: 1 | 4;
  rates_status: string | null;
}

export function readReleaseSchedule(config: unknown): ReleaseSchedule {
  const raw =
    typeof config === 'object' && config !== null
      ? (config as { disbursement_schedule?: unknown }).disbursement_schedule
      : undefined;
  const s = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const ratesStatus = typeof s.rates_status === 'string' ? s.rates_status : null;
  return s.cadence === 'QUARTERLY'
    ? { cadence: 'QUARTERLY', instalments_per_year: 4, rates_status: ratesStatus }
    : { cadence: 'ANNUAL', instalments_per_year: 1, rates_status: ratesStatus };
}

/**
 * An annual amount split into equal parts that sum exactly to it, in paise
 * (any remainder goes to the last part): 444000 / 4 = 4 x 111000.
 */
export function splitAnnualAmount(amount: number, parts: number): number[] {
  const paise = Math.round(amount * 100);
  const each = Math.floor(paise / parts);
  return Array.from({ length: parts }, (_, k) =>
    k === parts - 1 ? (paise - each * (parts - 1)) / 100 : each / 100,
  );
}
