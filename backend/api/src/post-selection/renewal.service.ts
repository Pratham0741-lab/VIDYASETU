import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { evaluateScheme } from '../schemes/eligibility-engine';
import { EligibilityService } from '../schemes/eligibility.service';
import { toPersisted } from '../schemes/redaction';
import { computeEntitlement, readReleaseSchedule, splitAnnualAmount } from './entitlement';
import { NOT_RENEWABLE_REASON, RENEWAL_TENURE_RULES } from './policies';

export interface SubmitRenewalInput {
  academic_year: string;
  academic_year_number: number;
  passed_previous_year: boolean;
  percentage_obtained?: number;
  progress_report: string;
}

const RENEWAL_SELECT = {
  id: true,
  parent_application_id: true,
  scheme_version_id: true,
  academic_year: true,
  academic_year_number: true,
  passed_previous_year: true,
  percentage_obtained: true,
  progress_report: true,
  verification_status: true,
  endorsed_by_officer_id: true,
  endorsed_at: true,
  endorsement_remarks: true,
  continuation_rule_id: true,
  continuation_verdict: true,
  continuation_evaluation_run_id: true,
  continuation_checked_at: true,
  decided_by_officer_id: true,
  decision_remarks: true,
  verified_at: true,
  year_advanced_from: true,
  year_advanced_to: true,
  year_advanced_at: true,
  created_at: true,
} satisfies Prisma.RenewalSelect;

function requireOfficer(actor: Actor): string {
  if (!actor.officerId) {
    throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
  }
  return actor.officerId;
}

/**
 * Renewal cycle - NFST and NOS only (decision A): the schemes whose frozen
 * version holds a machine-checkable tenure rule. Every other scheme is
 * refused cleanly on every renewal endpoint; no manual fallback.
 *
 * The continuation check evaluates the tenure rule of the application's
 * FROZEN scheme_version_id with Phase 3's evaluator - never the scheme's
 * currently active version.
 */
@Injectable()
export class RenewalService {
  constructor(
    private readonly db: DbContext,
    private readonly eligibility: EligibilityService,
  ) {}

  /** The application with its frozen version; refuses non-renewable schemes. */
  private async renewableApplication(applicationId: string) {
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: {
        id: true,
        applicant_id: true,
        scheme_version_id: true,
        scheme_version: {
          select: { id: true, version_no: true, config: true, scheme: { select: { code: true } } },
        },
      },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    const code = app.scheme_version.scheme.code;
    const ruleId = RENEWAL_TENURE_RULES[code];
    if (!ruleId) {
      throw new AppError(ErrorCode.CONFLICT, {
        message:
          NOT_RENEWABLE_REASON[code] ??
          `${code} has no machine-checkable tenure rule; renewal is not supported by this system.`,
        details: { reason: 'scheme_not_renewable', scheme_code: code },
      });
    }
    return { app, code, ruleId };
  }

  async listForApplication(applicationId: string) {
    const { app, code } = await this.renewableApplication(applicationId);
    const rows = await this.db.client.renewal.findMany({
      where: { parent_application_id: app.id },
      select: RENEWAL_SELECT,
      orderBy: { academic_year_number: 'asc' },
    });
    return { application_id: app.id, scheme_code: code, renewals: rows };
  }

  async submit(actor: Actor, applicationId: string, input: SubmitRenewalInput) {
    const { app } = await this.renewableApplication(applicationId);
    const confirmed = await this.db.client.selection.count({
      where: { application_id: app.id, selection_status: 'CONFIRMED' },
    });
    if (confirmed === 0) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Renewal needs a CONFIRMED selection for this application.',
        details: { reason: 'no_confirmed_selection' },
      });
    }
    if (input.academic_year_number < 2) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          { field: 'academic_year_number', constraints: { min: 'renewal years start at 2' } },
        ],
      });
    }
    try {
      return await this.db.client.renewal.create({
        data: {
          parent_application_id: app.id,
          scheme_version_id: app.scheme_version_id, // frozen
          academic_year: input.academic_year,
          academic_year_number: input.academic_year_number,
          passed_previous_year: input.passed_previous_year,
          percentage_obtained: input.percentage_obtained,
          progress_report: input.progress_report,
          submitted_by_account_id: actor.accountId,
        },
        select: RENEWAL_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: 'renewal_year_exists' } });
      }
      throw err;
    }
  }

  private async load(id: string) {
    const r = await this.db.client.renewal.findFirst({ where: { id }, select: RENEWAL_SELECT });
    if (!r) throw new AppError(ErrorCode.NOT_FOUND);
    return r;
  }

  /** INSTITUTE_NODAL_OFFICER endorses the progress report (PENDING -> ENDORSED). */
  async endorse(actor: Actor, id: string, remarks: string | undefined) {
    const officerId = requireOfficer(actor);
    const r = await this.load(id);
    await this.renewableApplication(r.parent_application_id);
    if (r.verification_status !== 'PENDING') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'not_pending', status: r.verification_status },
      });
    }
    await this.db.client.renewal.update({
      where: { id: r.id },
      data: {
        verification_status: 'ENDORSED',
        endorsed_by_officer_id: officerId,
        endorsed_at: new Date(),
        endorsement_remarks: remarks ?? null,
      },
    });
    return this.load(r.id);
  }

  /**
   * Continuation re-check: the frozen version's tenure rule, evaluated by
   * Phase 3's evaluator, with tenure_years = the renewal year and the
   * degree the applicant declared at submission (read from the gate's
   * stored evaluation). Persisted to rule_evaluations (redacted, Phase 3).
   */
  async continuationCheck(actor: Actor, id: string) {
    requireOfficer(actor);
    const r = await this.load(id);
    const { app, code, ruleId } = await this.renewableApplication(r.parent_application_id);
    if (r.verification_status !== 'ENDORSED') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'The progress report must be endorsed before the continuation check.',
        details: { reason: 'not_endorsed', status: r.verification_status },
      });
    }
    // Frozen version: the one stored on the renewal, which is the
    // application's scheme_version_id (checked, not assumed).
    if (r.scheme_version_id !== app.scheme_version_id) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, {
        details: { reason: 'renewal_version_mismatch' },
      });
    }
    const frozen = app.scheme_version;
    const rawRules = (frozen.config as { rules?: unknown[] }).rules ?? [];
    const rawRule = rawRules.find(
      (x): x is Record<string, unknown> =>
        typeof x === 'object' && x !== null && (x as { id?: unknown }).id === ruleId,
    );
    if (!rawRule || rawRule.type !== 'eligibility') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: {
          reason: 'tenure_rule_missing_in_frozen_version',
          rule_id: ruleId,
          scheme_version_id: frozen.id,
        },
      });
    }

    const degree = await this.declaredAtSubmission(app.id, 'applicant.degree_enrolled');
    const profile: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    if (degree !== undefined) profile.degree_enrolled = degree;
    profile.tenure_years = r.academic_year_number;

    const outcome = evaluateScheme({ rules: [rawRule] }, profile).rules[0];
    const verdict =
      outcome.verdict === 'PASS' || outcome.verdict === 'FAIL' ? outcome.verdict : 'ERROR';
    const runId = randomUUID();
    const stored = toPersisted(outcome);
    const now = new Date();
    await this.db.client.ruleEvaluation.create({
      data: {
        evaluation_run_id: runId,
        scheme_version_id: frozen.id,
        application_id: app.id,
        rule_id: outcome.rule_id,
        rule_type: outcome.rule_type,
        expr: outcome.expr,
        verdict: outcome.verdict,
        result_value:
          stored.result_value === null
            ? Prisma.JsonNull
            : (stored.result_value as Prisma.InputJsonValue),
        trace: JSON.parse(JSON.stringify(stored.trace)) as Prisma.InputJsonValue,
        explanation: stored.explanation,
        message_key: outcome.message_key,
      },
    });
    await this.db.client.renewal.update({
      where: { id: r.id },
      data: {
        continuation_rule_id: ruleId,
        continuation_verdict: verdict,
        continuation_evaluation_run_id: runId,
        continuation_checked_at: now,
      },
    });

    const active = await this.db.client.schemeVersion.findMany({
      where: { scheme: { code }, status: 'active' },
      select: { id: true, version_no: true },
      orderBy: { version_no: 'asc' },
    });
    return {
      renewal: await this.load(r.id),
      application_scheme_version_id: app.scheme_version_id,
      evaluated_scheme_version: { id: frozen.id, version_no: frozen.version_no },
      currently_active_versions: active,
      rule: { id: ruleId, expr: rawRule.expr, params: rawRule.params },
      inputs: { degree_enrolled: degree ?? null, tenure_years: r.academic_year_number },
      verdict,
      explanation: outcome.explanation,
      evaluation_run_id: runId,
    };
  }

  /** MINISTRY_OFFICER decides: APPROVE (needs a PASS check) or DISCONTINUE. */
  async decide(
    actor: Actor,
    id: string,
    decision: 'APPROVE' | 'DISCONTINUE',
    remarks: string | undefined,
  ) {
    const officerId = requireOfficer(actor);
    const r = await this.load(id);
    await this.renewableApplication(r.parent_application_id);
    if (r.verification_status !== 'ENDORSED') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'not_endorsed', status: r.verification_status },
      });
    }
    if (decision === 'APPROVE' && r.continuation_verdict !== 'PASS') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Approval needs a PASS continuation check against the frozen scheme version.',
        details: {
          reason: 'continuation_not_passed',
          continuation_verdict: r.continuation_verdict,
        },
      });
    }
    if (decision === 'DISCONTINUE' && !remarks?.trim()) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          { field: 'remarks', constraints: { required: 'a discontinuation needs remarks' } },
        ],
      });
    }
    const now = new Date();
    // Phase 14 loose ends (D1, M21): an approval records the year advance
    // in the same UPDATE (DB CHECK: one year forward, APPROVED only).
    const advance = decision === 'APPROVE' ? await this.yearAdvance(r) : null;
    await this.db.client.renewal.update({
      where: { id: r.id },
      data: {
        verification_status: decision === 'APPROVE' ? 'APPROVED' : 'DISCONTINUED',
        decided_by_officer_id: officerId,
        verified_at: now,
        decision_remarks: remarks ?? null,
        ...(advance
          ? {
              year_advanced_from: advance.from,
              year_advanced_to: advance.to,
              year_advanced_at: now,
            }
          : {}),
      },
    });
    if (decision !== 'APPROVE') return this.load(r.id);
    const schedule = await this.scheduleRenewalYear(r.id, now);
    return { ...(await this.load(r.id)), year_advance: advance, schedule };
  }

  /**
   * The recorded PhD year before this renewal: the last APPROVED renewal's
   * advanced year, else the application's course year (entered by the
   * applicant, verified by the institute). The renewal must be exactly the
   * next year - never skipped, never inferred.
   */
  private async yearAdvance(r: {
    id: string;
    parent_application_id: string;
    academic_year_number: number;
  }) {
    const app = await this.db.client.application.findFirst({
      where: { id: r.parent_application_id },
      select: { course_year: true },
    });
    const last = await this.db.client.renewal.aggregate({
      where: {
        parent_application_id: r.parent_application_id,
        verification_status: 'APPROVED',
        id: { not: r.id },
      },
      _max: { year_advanced_to: true },
    });
    const from = last._max.year_advanced_to ?? app?.course_year ?? null;
    if (from !== null && r.academic_year_number !== from + 1) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `The recorded year is ${from}; this renewal is for year ${r.academic_year_number}. A renewal advances exactly one year.`,
        details: {
          reason: 'renewal_year_not_next',
          recorded_year: from,
          renewal_year: r.academic_year_number,
        },
      });
    }
    return {
      from,
      to: r.academic_year_number,
      basis:
        last._max.year_advanced_to !== null
          ? 'the previous approved renewal year'
          : from !== null
            ? 'applications.course_year (institute-verified)'
            : 'no year recorded before this renewal',
    };
  }

  /**
   * Schedules the approved renewal year (M21): the FROZEN version's
   * benefits with the recorded year as applicant.academic_year_number (so
   * NFST year 3+ is SRF - from the recorded year, never an automatic
   * upgrade), at the version's release cadence, as disbursement rows linked
   * to this renewal, the confirmed selection and its sanction order.
   * Nothing is scheduled when the State disburses (FORWARDED_TO_STATE) or
   * no sanction order exists; lines without a stated amount (HRA, the
   * contingency grant) stay unscheduled, as for the sanctioned year.
   */
  private async scheduleRenewalYear(renewalId: string, approvedAt: Date) {
    const client = this.db.client;
    const r = await this.load(renewalId);
    const app = await client.application.findFirst({
      where: { id: r.parent_application_id },
      select: {
        id: true,
        scheme: { select: { disbursement_mode: true } },
        scheme_version: { select: { id: true, config: true } },
      },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    if (app.scheme.disbursement_mode === 'FORWARDED_TO_STATE') {
      return { scheduled: false, reason: 'FORWARDED_TO_STATE', instalments: [] };
    }
    const selection = await client.selection.findFirst({
      where: { application_id: app.id, selection_status: 'CONFIRMED' },
      select: { id: true },
    });
    const order = selection
      ? await client.sanctionOrder.findFirst({
          where: { selection_id: selection.id },
          select: { id: true },
        })
      : null;
    if (!selection || !order) {
      return { scheduled: false, reason: 'no_sanction_order', instalments: [] };
    }
    const existing = await client.disbursement.count({ where: { renewal_id: r.id } });
    if (existing > 0) {
      return { scheduled: false, reason: 'renewal_year_already_scheduled', instalments: [] };
    }
    const prepared = await this.eligibility.prepareApplicationEvaluation(app.id, {});
    const profile = { ...prepared.profile, academic_year_number: r.academic_year_number };
    const ent = computeEntitlement(app.scheme_version.config, profile);
    const release = readReleaseSchedule(app.scheme_version.config);
    const last = await client.disbursement.aggregate({
      where: { application_id: app.id },
      _max: { installment_no: true },
    });
    const base = last._max.installment_no ?? 0;
    const start = new Date(`${approvedAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
    for (const e of ent.instalments) {
      const parts = splitAnnualAmount(e.amount, release.instalments_per_year);
      for (const [k, amount] of parts.entries()) {
        const due = new Date(start);
        due.setUTCMonth(due.getUTCMonth() + k * (12 / release.instalments_per_year));
        await client.disbursement.create({
          data: {
            application_id: app.id,
            selection_id: selection.id,
            sanction_order_id: order.id,
            renewal_id: r.id,
            installment_no: base + k + 1,
            academic_year: r.academic_year,
            financial_year: r.academic_year,
            component_type:
              release.cadence === 'QUARTERLY' ? 'QUARTERLY_ENTITLEMENT' : 'ANNUAL_ENTITLEMENT',
            amount,
            currency: e.currency,
            beneficiary_type: e.beneficiary_type,
            payment_mode: e.payment_mode,
            scheduled_date: due,
            benefit_lines: e.lines as unknown as Prisma.InputJsonArray,
          },
        });
      }
    }
    const rows = await client.disbursement.findMany({
      where: { renewal_id: r.id },
      select: {
        id: true,
        installment_no: true,
        academic_year: true,
        amount: true,
        currency: true,
        component_type: true,
        scheduled_date: true,
        status: true,
        benefit_lines: true,
      },
      orderBy: [{ installment_no: 'asc' }, { currency: 'asc' }],
    });
    return {
      scheduled: rows.length > 0,
      recorded_year_used: r.academic_year_number,
      release_cadence: release.cadence,
      rates_status: release.rates_status,
      scheduled_date_basis:
        'approval date, then every 12 / instalments-per-year months (the scheme data defines no release calendar)',
      instalments: rows,
      unschedulable_benefits: ent.unschedulable,
      not_applicable_benefits: ent.not_applicable,
    };
  }

  /** A declared input as the application's automatic gate resolved it (stored trace). */
  private async declaredAtSubmission(applicationId: string, path: string): Promise<unknown> {
    const gate = await this.db.client.workflowTransition.findFirst({
      where: { application_id: applicationId, triggered_by: 'SYSTEM' },
      orderBy: { created_at: 'desc' },
      select: { metadata: true },
    });
    const runId = (gate?.metadata as { evaluation_run_id?: unknown } | null)?.evaluation_run_id;
    if (typeof runId !== 'string') return undefined;
    const rows = await this.db.client.ruleEvaluation.findMany({
      where: { evaluation_run_id: runId, application_id: applicationId },
      select: { trace: true },
    });
    for (const row of rows) {
      const nodes = (row.trace as { trace?: unknown } | null)?.trace;
      if (!Array.isArray(nodes)) continue;
      for (const node of nodes as Array<Record<string, unknown>>) {
        for (const side of [node.left, node.right] as Array<Record<string, unknown> | undefined>) {
          if (side?.path === path && side.redacted !== true && 'resolvedValue' in side)
            return side.resolvedValue;
        }
      }
    }
    return undefined;
  }
}
