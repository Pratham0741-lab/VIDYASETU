import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { RequestContext } from '../common/context/request-context';
import { DbContext } from '../database/db-context';
import { DOMAIN_EVENTS, eventActor } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { HOLDING_STATUSES } from '../fraud/holding';
import {
  AllocationResult,
  allocateQuota,
  Candidate,
  rankAllNoCap,
  requiredSeats,
} from './allocator';
import { SelectionListsService } from '../selection-lists/selection-lists.service';
import {
  FEMALE,
  MeritSource,
  PWD,
  reservationTagsFor,
  SelectionBasis,
  SelectionPolicy,
  SelectionPolicyError,
  selectionPolicyFor,
  VERTICAL_FOR_CATEGORY,
} from './selection-policies';

/** Applications eligible for selection: the stage MINISTRY_APPROVED (Phase 4 graph). */
const SELECTABLE_STAGE = 'MINISTRY_APPROVED';
const LIVE_STATUSES = ['PROVISIONAL', 'CONFIRMED'];

interface MeritValue {
  value: number;
  rule_evaluation_id: string;
  evaluation_run_id: string;
}

interface Applicant {
  application_id: string;
  application_no: string;
  submitted_at: Date;
  category: string;
  gender: string | null;
  merit: MeritValue | null;
  merit_problem: string | null;
}

export interface SelectedView {
  application_id: string;
  application_no: string;
  merit_rank: number | null;
  vertical_category: string;
  /** Horizontal reservation the candidate was SELECTED UNDER (null = general / merit). */
  horizontal_reservation: string | null;
  is_female_reserved: boolean;
  is_pwd_reserved: boolean;
  /** Reservations the candidate qualified for (whether or not used). */
  qualifies_for: string[];
  merit_value: number | null;
  selection_id: string | null;
  score_id: string | null;
}

export interface NotSelectedView {
  application_id: string;
  application_no: string;
  merit_rank: number | null;
  vertical_category: string;
  qualifies_for: string[];
  merit_value: number | null;
  reason: string;
  detail: string | null;
}

/** Left out of the run pending fraud review: not selected, not rejected, not ranked. */
export interface HeldView {
  application_id: string;
  application_no: string;
  applicant_id: string;
  status: 'HELD_FRAUD_REVIEW';
  fraud_flag_ids: string[];
}

/**
 * Runs selection for one scheme + academic year, in the request's actor
 * transaction (Phase 2): reads, score capture, allocation and every
 * Selection / Score row commit or roll back together, each with its audit
 * row attributed to the triggering officer.
 *
 * Three explicit paths, chosen by selection-policies.ts from the frozen
 * scheme version's real rules:
 *   NO_COMPETITION  select every approved application, unranked; no scores,
 *                   no allocator.
 *   RANKED_NO_CAP   rank by the captured merit score; select everyone.
 *   QUOTA           rank, then the allocator's compartment method.
 */
@Injectable()
export class SelectionService {
  constructor(
    private readonly db: DbContext,
    private readonly events: DomainEvents,
    private readonly lists: SelectionListsService,
  ) {}

  async run(schemeCode: string, academicYear: string, dryRun: boolean) {
    const client = this.db.client;
    // Serialise runs for the same scheme + year (released at commit).
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`selection:${schemeCode}:${academicYear}`}))`;

    const scheme = await client.scheme.findUnique({
      where: { code: schemeCode },
      select: { code: true },
    });
    if (!scheme) throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'code' } });

    const live = await client.selection.count({
      where: {
        scheme_code: schemeCode,
        academic_year: academicYear,
        selection_status: { in: LIVE_STATUSES },
      },
    });
    if (live > 0 && !dryRun) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: `Selection has already been run for ${schemeCode} ${academicYear}.`,
        details: { reason: 'selection_exists', live_selections: live },
      });
    }

    const approved = {
      current_stage: SELECTABLE_STAGE,
      academic_year: academicYear,
      scheme: { code: schemeCode },
    };
    // Phase 11.5 candidate-pool filter: a HIGH fraud flag awaiting review
    // (the same rule as the fraud hold guard) keeps an application out of
    // the run. It is reported as held - never as not selected - and is back
    // in the pool on the next run once an officer releases the flag.
    const holding = {
      severity: 'HIGH',
      status: { in: [...HOLDING_STATUSES] },
    };
    const applications = await client.application.findMany({
      where: { ...approved, fraud_flags: { none: holding } },
      select: {
        id: true,
        application_no: true,
        submitted_at: true,
        scheme_version_id: true,
        applicant_id: true,
      },
      orderBy: [{ submitted_at: 'asc' }, { application_no: 'asc' }],
    });
    const held: HeldView[] = (
      await client.application.findMany({
        where: { ...approved, fraud_flags: { some: holding } },
        select: {
          id: true,
          application_no: true,
          applicant_id: true,
          fraud_flags: { where: holding, select: { id: true }, orderBy: { id: 'asc' } },
        },
        orderBy: [{ submitted_at: 'asc' }, { application_no: 'asc' }],
      })
    ).map((a) => ({
      application_id: a.id,
      application_no: a.application_no,
      applicant_id: a.applicant_id,
      status: 'HELD_FRAUD_REVIEW',
      fraud_flag_ids: a.fraud_flags.map((f) => f.id),
    }));

    const versionIds = [...new Set(applications.map((a) => a.scheme_version_id))].sort();
    if (versionIds.length > 1) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Approved applications for this scheme and year span several scheme versions.',
        details: { reason: 'multiple_scheme_versions', scheme_version_ids: versionIds },
      });
    }
    if (versionIds.length === 0) {
      return {
        scheme_code: schemeCode,
        academic_year: academicYear,
        dry_run: dryRun,
        selection_run_id: null,
        basis: null,
        message:
          held.length > 0
            ? 'Every MINISTRY_APPROVED application for this scheme and academic year is held for fraud review.'
            : 'No MINISTRY_APPROVED applications for this scheme and academic year.',
        selected: [],
        not_selected: [],
        held,
      };
    }

    const version = await client.schemeVersion.findUniqueOrThrow({
      where: { id: versionIds[0] },
      select: { id: true, version_no: true, config: true },
    });
    let policy: SelectionPolicy;
    try {
      policy = selectionPolicyFor(version.config);
    } catch (err) {
      if (err instanceof SelectionPolicyError) {
        throw new AppError(ErrorCode.CONFLICT, {
          message: err.message,
          details: { reason: 'no_selection_policy', scheme_version_id: version.id },
        });
      }
      throw err;
    }

    // Not an include from applications: applicants carry encrypted PII and
    // only non-PII columns are needed here.
    const people = await client.applicant.findMany({
      where: { id: { in: applications.map((a) => a.applicant_id) } },
      select: { id: true, category: true, gender: true },
    });
    const personById = new Map(people.map((p) => [p.id, p]));

    const applicants: Applicant[] = [];
    for (const app of applications) {
      const person = personById.get(app.applicant_id)!;
      const merit =
        policy.basis === 'NO_COMPETITION'
          ? { value: null, problem: null }
          : await this.readMerit(app.id, policy.merit);
      applicants.push({
        application_id: app.id,
        application_no: app.application_no,
        submitted_at: app.submitted_at,
        category: person.category,
        gender: person.gender,
        merit: merit.value,
        merit_problem: merit.problem,
      });
    }

    const runId = dryRun ? null : randomUUID();
    const outcome =
      policy.basis === 'NO_COMPETITION'
        ? this.noCompetition(applicants)
        : this.allocate(policy, applicants);

    const byId = new Map(applicants.map((a) => [a.application_id, a]));
    const selected: SelectedView[] = outcome.selected.map((s) => {
      const a = byId.get(s.candidateId)!;
      const vertical = s.pool ?? VERTICAL_FOR_CATEGORY[a.category];
      return {
        application_id: a.application_id,
        application_no: a.application_no,
        merit_rank: s.rank,
        vertical_category: vertical,
        horizontal_reservation: s.selectedUnder,
        is_female_reserved: s.selectedUnder === FEMALE,
        is_pwd_reserved: s.selectedUnder === PWD,
        qualifies_for: reservationTagsFor(a),
        merit_value: a.merit?.value ?? null,
        selection_id: null,
        score_id: null,
      };
    });
    const notSelected: NotSelectedView[] = outcome.notSelected.map((n) => {
      const a = byId.get(n.candidateId)!;
      return {
        application_id: a.application_id,
        application_no: a.application_no,
        merit_rank: n.rank,
        vertical_category: n.pool ?? VERTICAL_FOR_CATEGORY[a.category],
        qualifies_for: reservationTagsFor(a),
        merit_value: a.merit?.value ?? null,
        reason: n.reason,
        detail: n.reason === 'NO_RANKING_VALUE' ? a.merit_problem : null,
      };
    });

    let selectionListId: string | null = null;
    if (!dryRun) {
      await this.persist(schemeCode, academicYear, runId!, policy, selected, byId);
      // Phase 13E: the committed run becomes a DRAFT selection list for the
      // committee (the allocator's result above is recorded as computed).
      selectionListId = await this.lists.createForRun({
        runId: runId!,
        schemeCode,
        academicYear,
        selected: selected.map((s) => ({
          application_id: s.application_id,
          selection_id: s.selection_id,
          merit_rank: s.merit_rank,
          vertical_category: s.vertical_category,
          horizontal_reservation: s.horizontal_reservation,
        })),
        notSelected: notSelected.map((n) => ({
          application_id: n.application_id,
          merit_rank: n.merit_rank,
          vertical_category: n.vertical_category,
          reason: n.reason,
        })),
        held: held.map((h) => ({ application_id: h.application_id })),
      });

      // One event per committed run, emitted after the request's
      // transaction commits (DomainEvents). Never for a dry run.
      const applicantOf = new Map(applications.map((a) => [a.id, a.applicant_id]));
      this.events.record(DOMAIN_EVENTS.SELECTION_RUN_COMPLETED, {
        selection_run_id: runId!,
        scheme_code: schemeCode,
        academic_year: academicYear,
        scheme_version_id: version.id,
        basis: policy.basis,
        actor: eventActor(RequestContext.actor() ?? null),
        selected: selected.map((s) => ({
          selection_id: s.selection_id!,
          application_id: s.application_id,
          application_no: s.application_no,
          applicant_id: applicantOf.get(s.application_id)!,
          merit_rank: s.merit_rank,
          vertical_category: s.vertical_category,
          horizontal_reservation: s.horizontal_reservation,
        })),
        not_selected: notSelected.map((n) => ({
          application_id: n.application_id,
          application_no: n.application_no,
          applicant_id: applicantOf.get(n.application_id)!,
          merit_rank: n.merit_rank,
          reason: n.reason,
        })),
        held: held.map(({ status: _status, ...h }) => h),
        reservations: outcome.reservations,
        list_managed: true,
        occurred_at: new Date().toISOString(),
      });
    }

    return {
      scheme_code: schemeCode,
      academic_year: academicYear,
      scheme_version: { id: version.id, version_no: version.version_no },
      dry_run: dryRun,
      selection_run_id: runId,
      selection_list_id: selectionListId,
      selection_status: dryRun ? null : 'PROVISIONAL',
      basis: policy.basis,
      policy: this.describe(policy),
      counts: {
        approved_applications: applicants.length,
        selected: selected.length,
        not_selected: notSelected.length,
        held: held.length,
      },
      selected,
      not_selected: notSelected,
      held,
      pools: outcome.pools,
      reservations: outcome.reservations,
    };
  }

  /** Part 4: every approved application selected, unranked. No allocator. */
  private noCompetition(
    applicants: Applicant[],
  ): Pick<AllocationResult, 'selected' | 'notSelected' | 'pools' | 'reservations'> {
    return {
      // applicants is already in (submitted_at, application_no) order.
      selected: applicants.map((a) => ({
        candidateId: a.application_id,
        rank: null,
        pool: null,
        selectedUnder: null,
      })),
      notSelected: [],
      pools: [],
      reservations: [],
    };
  }

  private allocate(
    policy: Exclude<SelectionPolicy, { basis: 'NO_COMPETITION' }>,
    applicants: Applicant[],
  ): AllocationResult {
    const candidates: Candidate[] = applicants.map((a) => ({
      id: a.application_id,
      score: a.merit?.value ?? null,
      submittedAtMs: a.submitted_at.getTime(),
      tieKey: a.application_no,
      verticalTags: [a.category],
      reservationTags: reservationTagsFor(a),
    }));
    return policy.basis === 'RANKED_NO_CAP'
      ? rankAllNoCap(candidates, policy.merit.direction)
      : allocateQuota(candidates, policy.merit.direction, policy.pools);
  }

  /**
   * Part 2: the merit value recorded by the automatic eligibility gate of
   * the application's most recent submission - the evaluation run the
   * officers then approved (Phase 4 records its evaluation_run_id on the
   * SYSTEM transition). Not the newest rule_evaluations row overall: a later
   * POST /evaluate-eligibility with different declared inputs must not
   * change merit after approval. Read, never recomputed.
   */
  private async readMerit(
    applicationId: string,
    source: MeritSource,
  ): Promise<{ value: MeritValue | null; problem: string | null }> {
    const client = this.db.client;
    const gate = await client.workflowTransition.findFirst({
      where: { application_id: applicationId, triggered_by: 'SYSTEM' },
      orderBy: { created_at: 'desc' },
      select: { metadata: true },
    });
    const runId = (gate?.metadata as { evaluation_run_id?: unknown } | null)?.evaluation_run_id;
    if (typeof runId !== 'string') {
      return { value: null, problem: 'no automatic eligibility evaluation on record' };
    }
    const row = await client.ruleEvaluation.findFirst({
      where: { evaluation_run_id: runId, application_id: applicationId, rule_id: source.ruleId },
      select: { id: true, verdict: true, result_value: true, trace: true },
    });
    if (!row) return { value: null, problem: `${source.ruleId} was not evaluated` };
    if (row.verdict !== 'COMPUTED') {
      return { value: null, problem: `${source.ruleId} could not be computed (${row.verdict})` };
    }

    let value: unknown;
    if (source.read === 'RESULT_VALUE') {
      value = row.result_value;
    } else {
      const nodes = (row.trace as { trace?: unknown })?.trace;
      const operands = Array.isArray(nodes)
        ? nodes.flatMap((n: { left?: unknown; right?: unknown }) => [n.left, n.right])
        : [];
      const operand = operands.find(
        (o): o is { path: string; resolvedValue?: unknown; redacted?: boolean } =>
          typeof o === 'object' &&
          o !== null &&
          (o as { path?: unknown }).path === source.operandPath,
      );
      value = operand?.redacted ? { redacted: true } : operand?.resolvedValue;
    }
    // A redacted value (merit derived from a sensitive field) is never
    // un-redacted here: the candidate is reported as unrankable instead.
    if (typeof value === 'object' && value !== null && 'redacted' in value) {
      return { value: null, problem: `${source.ruleId}: stored value is redacted (sensitive)` };
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { value: null, problem: `${source.ruleId}: no numeric value recorded` };
    }
    return {
      value: { value, rule_evaluation_id: row.id, evaluation_run_id: runId },
      problem: null,
    };
  }

  /** Attribution: the actor transaction's settings, recorded by the audit trigger. */
  private async persist(
    schemeCode: string,
    academicYear: string,
    runId: string,
    policy: SelectionPolicy,
    selected: SelectedView[],
    byId: Map<string, Applicant>,
  ): Promise<void> {
    const client = this.db.client;
    const merit = policy.basis === 'NO_COMPETITION' ? null : policy.merit;
    for (const s of selected) {
      const a = byId.get(s.application_id)!;
      let scoreId: string | null = null;
      if (merit && a.merit) {
        // Reuse the Score already captured from the same evaluation row.
        const existing = await client.score.findFirst({
          where: {
            application_id: a.application_id,
            rule_evaluation_id: a.merit.rule_evaluation_id,
            score_type: merit.scoreType,
          },
          select: { id: true },
        });
        scoreId =
          existing?.id ??
          (
            await client.score.create({
              data: {
                application_id: a.application_id,
                officer_id: null, // machine value, read from Phase 3 evidence
                score_type: merit.scoreType,
                score_value: a.merit.value,
                rule_evaluation_id: a.merit.rule_evaluation_id,
                breakdown: {
                  rule_id: merit.ruleId,
                  evaluation_run_id: a.merit.evaluation_run_id,
                  read_from:
                    merit.read === 'RESULT_VALUE'
                      ? 'rule_evaluations.result_value'
                      : `rule_evaluations.trace operand ${merit.operandPath}`,
                  direction: merit.direction,
                },
              },
              select: { id: true },
            })
          ).id;
      }
      const row = await client.selection.create({
        data: {
          application_id: s.application_id,
          scheme_code: schemeCode,
          academic_year: academicYear,
          merit_rank: s.merit_rank,
          vertical_category: s.vertical_category,
          is_female_reserved: s.is_female_reserved,
          is_pwd_reserved: s.is_pwd_reserved,
          selection_basis: policy.basis,
          selection_run_id: runId,
          score_id: scoreId,
          selection_status: 'PROVISIONAL',
        },
        select: { id: true },
      });
      s.selection_id = row.id;
      s.score_id = scoreId;
    }
  }

  private describe(policy: SelectionPolicy) {
    const base: { basis: SelectionBasis; description: string } = {
      basis: policy.basis,
      description: policy.description,
    };
    if (policy.basis === 'NO_COMPETITION') return base;
    const merit = {
      rule_id: policy.merit.ruleId,
      score_type: policy.merit.scoreType,
      direction: policy.merit.direction,
    };
    if (policy.basis === 'RANKED_NO_CAP') {
      return { ...base, merit, limitation: policy.limitation };
    }
    return {
      ...base,
      merit,
      pools: policy.pools.map((p) => ({
        pool: p.key,
        seats: p.seats,
        eligible_categories: p.eligibleTags,
        reservations: p.reservations.map((r) => ({
          reservation: r.key,
          minimum: r.minimum,
          required_seats: requiredSeats(r.minimum, p.seats),
        })),
      })),
    };
  }
}

export type SelectionRunResult = Awaited<ReturnType<SelectionService['run']>>;
