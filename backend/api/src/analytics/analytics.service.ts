import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { canonicalTypeForSlot } from '../documents/document-types';
import { HOLDING_STATUSES } from '../fraud/holding';
import { selectionPolicyFor, SelectionPolicyError } from '../selection/selection-policies';
import { rolesActingAt } from '../notifications/notification-intents';
import { STAGE_SLA_DAYS } from '../workflow/vidyasetu-workflow';
import type { AnalyticsQueryDto, JurisdictionQueryDto } from './analytics.dto';
import { SECONDARY_SUPPRESSED, SMALL_COUNT_THRESHOLD, suppressRows } from './suppression';

/**
 * Phase 6's "live" selection statuses (selection.service.ts LIVE_STATUSES,
 * not exported; analytics.spec.ts fails if the two ever differ).
 */
export const LIVE_SELECTION_STATUSES = ['PROVISIONAL', 'CONFIRMED'];
/** Longest window one request may aggregate. */
export const MAX_SPAN_DAYS = 366;
const DAY_MS = 86_400_000;

interface Scope {
  from: Date;
  to: Date;
  scheme: string | null;
  academicYear: string | null;
  includeFixtures: boolean;
  meta: Record<string, unknown>;
}

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const ratio = (num: number, den: number): number | null =>
  den === 0 ? null : Math.round((num / den) * 10_000) / 10_000;
const hours = (seconds: unknown): number | null =>
  seconds === null || seconds === undefined ? null : Math.round(Number(seconds) / 360) / 10;

/**
 * Read-only analytics (Phase 12). Every query runs in the caller's actor
 * transaction, switched to READ ONLY before the first read, so PostgreSQL
 * refuses any write, and row-level security scopes every row to the
 * caller's jurisdiction (raw SQL: the Phase 2 Prisma extension is not
 * involved - the database decides). Tables without RLS (workflow_transitions)
 * are only ever reached through RLS-scoped applications.
 *
 * Aggregates only: no name, date of birth, income, bank account,
 * certificate number, remark or document content is selected. Phase 16's
 * verification-quality view reads document_extractions' routing columns
 * only (review_status, corrected_fields as a count, classification match,
 * status) - never extracted_data, sensitive_values or the raw OCR text -
 * and reaches it only through RLS-scoped documents and applications.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DbContext,
    @InjectPinoLogger(AnalyticsService.name) private readonly logger: PinoLogger,
  ) {}

  private async begin(actor: Actor, q: AnalyticsQueryDto, view: string): Promise<Scope> {
    const from = new Date(`${q.from}T00:00:00.000Z`);
    const to = new Date(`${q.to}T00:00:00.000Z`);
    const bad = (field: string, constraint: string) =>
      new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field, constraints: { constraint } }],
      });
    if (Number.isNaN(from.getTime())) throw bad('from', 'not a valid date');
    if (Number.isNaN(to.getTime())) throw bad('to', 'not a valid date');
    if (to <= from) throw bad('to', 'must be after from');
    if (to.getTime() - from.getTime() > MAX_SPAN_DAYS * DAY_MS) {
      throw bad('to', `the window may span at most ${MAX_SPAN_DAYS} days`);
    }
    const includeFixtures = q.include_fixtures === 'true';
    if (includeFixtures && actor.role !== AppRole.SUPER_ADMIN) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        details: { reason: 'include_fixtures_requires_super_admin' },
      });
    }

    const client = this.db.client;
    await client.$executeRaw`SET TRANSACTION READ ONLY`;
    const [ro] = await client.$queryRaw<Array<{ ro: string }>>`
      SELECT current_setting('transaction_read_only') AS ro`;

    // Parameters only: never a row value.
    this.logger.info(
      { view, from: q.from, to: q.to, scheme: q.scheme ?? null, fixtures: includeFixtures },
      'analytics query',
    );
    return {
      from,
      to,
      scheme: q.scheme ?? null,
      academicYear: q.academic_year ?? null,
      includeFixtures,
      meta: {
        view,
        cohort: 'applications submitted in [from, to)',
        from: q.from,
        to: q.to,
        scheme: q.scheme ?? null,
        academic_year: q.academic_year ?? null,
        fixtures: includeFixtures ? 'included' : 'excluded',
        read_only_transaction: ro?.ro === 'on',
        scope: 'rows visible to the caller under database row-level security',
        small_count_threshold: SMALL_COUNT_THRESHOLD,
        generated_at: new Date().toISOString(),
      },
    };
  }

  /** The cohort: RLS-scoped applications in the window, fixtures excluded by default. */
  private cohort(s: Scope): Prisma.Sql {
    return Prisma.sql`
      SELECT a.id, a.current_stage, a.status, a.academic_year, a.scheme_version_id,
             a.jurisdiction_state, a.jurisdiction_district, a.institution_code,
             a.stage_due_at, s.code AS scheme_code, s.disbursement_mode
        FROM applications a
        JOIN schemes s ON s.id = a.scheme_id
       WHERE a.submitted_at >= ${s.from} AND a.submitted_at < ${s.to}
         ${s.scheme ? Prisma.sql`AND s.code = ${s.scheme}` : Prisma.empty}
         ${s.academicYear ? Prisma.sql`AND a.academic_year = ${s.academicYear}` : Prisma.empty}
         ${
           s.includeFixtures
             ? Prisma.empty
             : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM test_fixtures f
                          WHERE f.entity_type = 'application' AND f.entity_id = a.id)`
         }`;
  }

  /** Phase 11's hold rule (fraud/holding.ts), as SQL over cohort row c. */
  private held(): Prisma.Sql {
    return Prisma.sql`EXISTS (SELECT 1 FROM fraud_flags ff WHERE ff.application_id = c.id
      AND ff.severity = 'HIGH' AND ff.status = ANY(${[...HOLDING_STATUSES]}::text[]))`;
  }

  /** Phase 6's live selection, as SQL over cohort row c. */
  private selected(): Prisma.Sql {
    return Prisma.sql`EXISTS (SELECT 1 FROM selections sel WHERE sel.application_id = c.id
      AND sel.selection_status = ANY(${LIVE_SELECTION_STATUSES}::text[]))`;
  }

  // ---------------------------------------------------------------- B-1 funnel
  async funnel(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'funnel');
    const sanctioned = Prisma.sql`EXISTS (SELECT 1 FROM sanction_orders so WHERE so.application_id = c.id)`;
    const [r] = await this.db.client.$queryRaw<Array<Record<string, number>>>`
      WITH c AS (${this.cohort(s)})
      SELECT count(*)::int AS submitted,
             count(*) FILTER (WHERE c.status = 'PENDING')::int AS pending,
             count(*) FILTER (WHERE c.status = 'UNDER_REVIEW')::int AS under_review,
             count(*) FILTER (WHERE c.current_stage = 'DEFECTIVE')::int AS defective,
             count(*) FILTER (WHERE c.current_stage = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE c.current_stage IN ('MINISTRY_APPROVED', 'DISBURSED')
               OR EXISTS (SELECT 1 FROM workflow_transitions t
                           WHERE t.application_id = c.id AND t.to_stage = 'MINISTRY_APPROVED'))::int AS verified,
             count(*) FILTER (WHERE ${this.selected()})::int AS selected,
             count(*) FILTER (WHERE ${sanctioned})::int AS sanctioned,
             count(*) FILTER (WHERE ${sanctioned} AND c.disbursement_mode = 'SCHEDULED_BY_PLATFORM')::int AS sanctioned_platform,
             count(*) FILTER (WHERE c.disbursement_mode = 'SCHEDULED_BY_PLATFORM' AND (c.current_stage = 'DISBURSED'
               OR EXISTS (SELECT 1 FROM disbursements d WHERE d.application_id = c.id AND d.status = 'SUCCESS')))::int AS disbursed,
             count(*) FILTER (WHERE ${this.selected()} AND c.disbursement_mode = 'FORWARDED_TO_STATE')::int AS state_dbt,
             count(*) FILTER (WHERE ${this.held()})::int AS held
        FROM c`;
    const steps = [
      {
        step: 'submitted',
        count: n(r.submitted),
        of: null as string | null,
        base: null as number | null,
      },
      { step: 'verified', count: n(r.verified), of: 'submitted', base: n(r.submitted) },
      { step: 'selected', count: n(r.selected), of: 'verified', base: n(r.verified) },
      { step: 'sanctioned', count: n(r.sanctioned), of: 'selected', base: n(r.selected) },
      {
        step: 'disbursed',
        count: n(r.disbursed),
        of: 'sanctioned (schemes the platform disburses)',
        base: n(r.sanctioned_platform),
      },
    ].map((x) => ({ ...x, conversion: x.base === null ? null : ratio(x.count, x.base) }));
    return {
      meta: s.meta,
      steps,
      current: {
        pending: n(r.pending),
        under_review: n(r.under_review),
        defective: n(r.defective),
        rejected: n(r.rejected),
      },
      held: {
        count: n(r.held),
        note: 'Held by an unreviewed HIGH fraud flag; counted in its own stage, never as rejected.',
      },
      state_dbt: {
        count: n(r.state_dbt),
        status: 'SELECTED_DISBURSEMENT_BY_STATE_DBT',
        note: 'Selected; disbursement handled by State DBT (never a zero-amount payment).',
      },
    };
  }

  // ------------------------------------------------------ B-2 SLA / bottlenecks
  async sla(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'sla');
    const stages = Object.keys(STAGE_SLA_DAYS);
    const days = stages.map((k) => STAGE_SLA_DAYS[k as keyof typeof STAGE_SLA_DAYS]!);
    const rows = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)}),
      stays AS (
        SELECT t.application_id, t.to_stage AS stage, t.created_at AS entered_at,
               lead(t.created_at) OVER (PARTITION BY t.application_id ORDER BY t.created_at, t.id) AS left_at
          FROM workflow_transitions t JOIN c ON c.id = t.application_id),
      sla AS (SELECT * FROM unnest(${stages}::text[], ${days}::int[]) AS x(stage, days))
      SELECT sla.stage, sla.days AS sla_days,
             count(st.left_at)::int AS completed,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM st.left_at - st.entered_at))
               FILTER (WHERE st.left_at IS NOT NULL) AS median_s,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM st.left_at - st.entered_at))
               FILTER (WHERE st.left_at IS NOT NULL) AS p90_s,
             count(*) FILTER (WHERE st.left_at - st.entered_at > make_interval(days => sla.days))::int AS completed_breached,
             count(*) FILTER (WHERE st.entered_at IS NOT NULL AND st.left_at IS NULL)::int AS in_stage,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM now() - st.entered_at))
               FILTER (WHERE st.entered_at IS NOT NULL AND st.left_at IS NULL) AS open_median_age_s,
             count(*) FILTER (WHERE st.left_at IS NULL AND c.stage_due_at < now())::int AS in_stage_breached
        FROM sla
        LEFT JOIN stays st ON st.stage = sla.stage
        LEFT JOIN c ON c.id = st.application_id
       GROUP BY sla.stage, sla.days`;
    const out = rows.map((r) => ({
      stage: String(r.stage),
      sla_days: n(r.sla_days),
      completed_stays: n(r.completed),
      median_hours: hours(r.median_s),
      p90_hours: hours(r.p90_s),
      completed_past_sla: n(r.completed_breached),
      in_stage_now: n(r.in_stage),
      in_stage_median_age_hours: hours(r.open_median_age_s),
      in_stage_past_sla: n(r.in_stage_breached),
      in_stage_past_sla_share: ratio(n(r.in_stage_breached), n(r.in_stage)),
    }));
    const byWait = [...out]
      .filter((x) => x.median_hours !== null || x.in_stage_median_age_hours !== null)
      .sort(
        (a, b) =>
          Math.max(b.median_hours ?? 0, b.in_stage_median_age_hours ?? 0) -
          Math.max(a.median_hours ?? 0, a.in_stage_median_age_hours ?? 0),
      )
      .map((x) => x.stage);
    return {
      meta: {
        ...s.meta,
        sla_source: 'Phase 4 STAGE_SLA_DAYS; current breach = stage_due_at before now',
      },
      stages: out.sort((a, b) => stages.indexOf(a.stage) - stages.indexOf(b.stage)),
      longest_waits: byWait,
    };
  }

  // ------------------------------------------------------- B-3 scheme performance
  async schemes(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'schemes');
    const rejectedAt = (level: string) => Prisma.sql`count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM decision_records r WHERE r.application_id = c.id
         AND r.decision = 'REJECT' AND r.stage = ${level}))::int`;
    const rows = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.scheme_code, c.academic_year, c.disbursement_mode,
             count(*)::int AS applications,
             count(*) FILTER (WHERE c.status = 'UNDER_REVIEW')::int AS under_review,
             count(*) FILTER (WHERE c.current_stage = 'MINISTRY_APPROVED')::int AS approved,
             count(*) FILTER (WHERE ${this.selected()})::int AS selected,
             count(*) FILTER (WHERE ${this.held()})::int AS held,
             count(*) FILTER (WHERE c.current_stage = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE c.current_stage = 'DEFECTIVE')::int AS defective,
             ${rejectedAt('INSTITUTE')} AS rejected_at_institute,
             ${rejectedAt('DISTRICT')} AS rejected_at_district,
             ${rejectedAt('STATE')} AS rejected_at_state,
             array_agg(DISTINCT c.scheme_version_id::text) AS versions
        FROM c
       GROUP BY c.scheme_code, c.academic_year, c.disbursement_mode
       ORDER BY c.scheme_code, c.academic_year`;
    const defects = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.scheme_code, c.academic_year, r.reasons->>'deficiency_code' AS deficiency_code,
             count(DISTINCT c.id)::int AS applications
        FROM c JOIN decision_records r ON r.application_id = c.id AND r.decision = 'DEFECT'
       WHERE r.reasons ? 'deficiency_code'
       GROUP BY 1, 2, 3
       ORDER BY 4 DESC, 3
       LIMIT 100`;
    const out = [];
    for (const r of rows) {
      const seats = await this.seats(r.versions as string[]);
      out.push({
        scheme_code: String(r.scheme_code),
        academic_year: String(r.academic_year),
        disbursement_mode: String(r.disbursement_mode),
        applications: n(r.applications),
        under_review: n(r.under_review),
        approved: n(r.approved),
        selected: n(r.selected),
        held: n(r.held),
        rejected: n(r.rejected),
        defective: n(r.defective),
        rejected_at_institute: n(r.rejected_at_institute),
        rejected_at_district: n(r.rejected_at_district),
        rejected_at_state: n(r.rejected_at_state),
        seats_available: seats.seats,
        seats_used: seats.seats === null ? null : n(r.selected),
        seats_note: seats.note,
      });
    }
    return {
      meta: {
        ...s.meta,
        rejection_reasons:
          'Rejections record only free-text remarks (never reported); counted by review level. Defects by deficiency code.',
      },
      schemes: out,
      defect_reasons: suppressRows(defects, {
        applicantKey: 'applications',
        countKeys: ['applications'],
      }),
    };
  }

  /** Seats from Phase 6's own policy reader (selection-policies.ts); never re-derived. */
  private async seats(versionIds: string[]): Promise<{ seats: number | null; note: string }> {
    if (versionIds.length !== 1) {
      return { seats: null, note: 'applications span several scheme versions' };
    }
    const v = await this.db.client.schemeVersion.findUnique({
      where: { id: versionIds[0] },
      select: { config: true },
    });
    try {
      const policy = selectionPolicyFor(v?.config);
      if (policy.basis === 'QUOTA') {
        return {
          seats: policy.pools.reduce((sum, p) => sum + p.seats, 0),
          note: 'seats from the scheme version quota pools (Phase 6 policy)',
        };
      }
      return {
        seats: null,
        note:
          policy.basis === 'NO_COMPETITION'
            ? 'no seat cap: every approved application is selected'
            : 'no verified seat cap in the scheme data (ranked, uncapped)',
      };
    } catch (err) {
      if (err instanceof SelectionPolicyError) return { seats: null, note: 'no selection policy' };
      throw err;
    }
  }

  // ---------------------------------------------------------- B-4 disbursements
  async disbursements(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'disbursements');
    const rows = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.scheme_code, d.currency,
             CASE
               WHEN d.status = 'PENDING' AND ${this.held()} THEN 'HELD_BY_FRAUD_REVIEW'
               WHEN d.status = 'SUCCESS' THEN 'PAID'
               ELSE d.status
             END AS status,
             count(*)::int AS instalments,
             count(DISTINCT c.id)::int AS applications,
             sum(d.amount)::float8 AS amount
        FROM c JOIN disbursements d ON d.application_id = c.id
       WHERE c.disbursement_mode = 'SCHEDULED_BY_PLATFORM'
       GROUP BY 1, 2, 3
       ORDER BY 1, 2, 3`;
    const scheduled = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.scheme_code, d.currency, count(*)::int AS instalments,
             count(DISTINCT c.id)::int AS applications, sum(d.amount)::float8 AS amount
        FROM c JOIN disbursements d ON d.application_id = c.id
       WHERE c.disbursement_mode = 'SCHEDULED_BY_PLATFORM'
       GROUP BY 1, 2 ORDER BY 1, 2`;
    const state = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.scheme_code, count(*)::int AS applications
        FROM c WHERE c.disbursement_mode = 'FORWARDED_TO_STATE' AND ${this.selected()}
       GROUP BY 1 ORDER BY 1`;
    return {
      meta: {
        ...s.meta,
        statuses:
          'SCHEDULED (all rows) = PENDING + HELD_BY_FRAUD_REVIEW + PROCESSING + PAID + FAILED + REFUNDED',
      },
      scheduled: scheduled.map((r) => ({
        scheme_code: String(r.scheme_code),
        currency: String(r.currency),
        instalments: n(r.instalments),
        applications: n(r.applications),
        amount: Number(r.amount),
      })),
      by_status: rows.map((r) => ({
        scheme_code: String(r.scheme_code),
        currency: String(r.currency),
        status: String(r.status),
        instalments: n(r.instalments),
        applications: n(r.applications),
        amount: Number(r.amount),
      })),
      handled_by_state: state.map((r) => ({
        scheme_code: String(r.scheme_code),
        status: 'SELECTED_DISBURSEMENT_BY_STATE_DBT',
        applications: n(r.applications),
        instalments: null,
        amount: null,
      })),
    };
  }

  // -------------------------------------------------------------- B-5 fraud
  async fraud(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'fraud');
    const byKind = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT f.flag_type, f.severity, f.status,
             count(*)::int AS flags, count(DISTINCT f.application_id)::int AS applications
        FROM fraud_flags f JOIN c ON c.id = f.application_id
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
    const institution = s.scheme
      ? []
      : await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      SELECT f.flag_type, f.severity, f.status, count(*)::int AS flags
        FROM fraud_flags f
       WHERE f.subject_type = 'INSTITUTION' AND f.created_at >= ${s.from} AND f.created_at < ${s.to}
         ${
           s.includeFixtures
             ? Prisma.empty
             : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM test_fixtures x
                          WHERE x.entity_type = 'fraud_flag' AND x.entity_id = f.id)`
         }
       GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`;
    const held = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.current_stage, count(*)::int AS applications
        FROM c WHERE ${this.held()} GROUP BY 1 ORDER BY 1`;
    const toRows = (xs: Array<Record<string, unknown>>) =>
      xs.map((r) => ({
        flag_type: String(r.flag_type),
        severity: String(r.severity),
        status: String(r.status),
        flags: n(r.flags),
        ...(r.applications === undefined ? {} : { applications: n(r.applications) }),
      }));
    return {
      meta: { ...s.meta, content: 'counts only; no flag evidence or identifier is returned' },
      application_flags: toRows(byKind),
      institution_flags: toRows(institution),
      held_applications: {
        total: held.reduce((sum, r) => sum + n(r.applications), 0),
        by_stage: held.map((r) => ({
          stage: String(r.current_stage),
          applications: n(r.applications),
        })),
      },
    };
  }

  // ------------------------------------------------------- B-6 jurisdiction
  async jurisdiction(actor: Actor, q: JurisdictionQueryDto) {
    const s = await this.begin(actor, q, 'jurisdiction');
    const byInstitution = q.group_by === 'institution';
    const pageSize = Number(q.page_size ?? 50);
    const page = Number(q.page ?? 1);
    const inst = byInstitution ? Prisma.sql`c.institution_code` : Prisma.sql`NULL::text`;
    const metrics = Prisma.sql`
             count(*)::int AS applications,
             count(*) FILTER (WHERE c.status = 'UNDER_REVIEW')::int AS under_review,
             count(*) FILTER (WHERE c.current_stage = 'MINISTRY_APPROVED')::int AS approved,
             count(*) FILTER (WHERE ${this.selected()})::int AS selected,
             count(*) FILTER (WHERE ${this.held()})::int AS held,
             count(*) FILTER (WHERE c.current_stage = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE c.current_stage = 'DEFECTIVE')::int AS defective,
             count(*) FILTER (WHERE c.stage_due_at < now())::int AS past_sla_now,
             count(*) FILTER (WHERE c.disbursement_mode = 'FORWARDED_TO_STATE' AND ${this.selected()})::int AS state_dbt,
             coalesce(sum((SELECT sum(d.amount) FROM disbursements d WHERE d.application_id = c.id
                 AND d.status = 'SUCCESS' AND d.currency = 'INR')), 0)::float8 AS paid_amount_inr`;
    const detail = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.jurisdiction_state AS state, c.jurisdiction_district AS district,
             ${inst} AS institution_code, ${metrics},
             count(*) OVER ()::int AS total_rows
        FROM c
       GROUP BY c.jurisdiction_state, c.jurisdiction_district, ${inst}
       ORDER BY 1, 2 NULLS FIRST, 3 NULLS FIRST
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const states = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH c AS (${this.cohort(s)})
      SELECT c.jurisdiction_state AS state, ${metrics}
        FROM c GROUP BY c.jurisdiction_state ORDER BY 1`;
    const countKeys = [
      'applications',
      'under_review',
      'approved',
      'selected',
      'held',
      'rejected',
      'defective',
      'past_sla_now',
      'state_dbt',
    ];
    const clean = (r: Record<string, unknown>) => {
      const o: Record<string, unknown> = { state: r.state };
      if ('district' in r) o.district = r.district;
      if (byInstitution && 'institution_code' in r) o.institution_code = r.institution_code;
      for (const k of countKeys) o[k] = n(r[k]);
      o.paid_amount_inr = Number(r.paid_amount_inr);
      return o;
    };
    const opts = {
      applicantKey: 'applications',
      countKeys,
      amountKeys: ['paid_amount_inr'],
    };
    return {
      meta: {
        ...s.meta,
        group_by: byInstitution ? 'institution' : 'district',
        suppression: `counts 1-${SMALL_COUNT_THRESHOLD - 1} are shown as "<${SMALL_COUNT_THRESHOLD}"; a row with fewer than ${SMALL_COUNT_THRESHOLD} applications is masked entirely; where a single masked cell could be derived from the state total, the smallest other non-zero cell is shown as "suppressed" (its true value may be any size)`,
      },
      page,
      page_size: pageSize,
      total_rows: detail.length > 0 ? n(detail[0].total_rows) : 0,
      rows: suppressRows(detail.map(clean), { ...opts, groupKey: (r) => String(r.state) }),
      states: suppressRows(states.map(clean), opts),
    };
  }

  /**
   * Phase 16: the RLS-scoped applications of the scheme / year, fixtures
   * excluded by default - WITHOUT the submission window (the workload and
   * verification views window on when the action or upload happened).
   */
  private scopedApplications(s: Scope): Prisma.Sql {
    return Prisma.sql`
      SELECT a.id, a.current_stage, a.stage_due_at, sc.code AS scheme_code
        FROM applications a
        JOIN schemes sc ON sc.id = a.scheme_id
       WHERE TRUE
         ${s.scheme ? Prisma.sql`AND sc.code = ${s.scheme}` : Prisma.empty}
         ${s.academicYear ? Prisma.sql`AND a.academic_year = ${s.academicYear}` : Prisma.empty}
         ${
           s.includeFixtures
             ? Prisma.empty
             : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM test_fixtures f
                          WHERE f.entity_type = 'application' AND f.entity_id = a.id)`
         }`;
  }

  // ------------------------------------------------------ Phase 16 workload
  /**
   * Officer workload, by officer ROLE and jurisdiction LEVEL (district /
   * state / national) - never by officer: no officer id or name is
   * selected. Actions are counted in [from, to) on the applications the
   * caller can see (RLS). A row covering fewer than SMALL_COUNT_THRESHOLD
   * officers shows no handling times, so no single officer's speed can be
   * read from it. Bulk actions are not recorded as such (each item is an
   * ordinary action); officer effort is not recorded (handling time is the
   * time the application spent in the stage before the decision).
   */
  async workload(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'workload');
    const levelSql = Prisma.sql`CASE WHEN o.jurisdiction_state IS NULL THEN 'NATIONAL'
                                     WHEN o.jurisdiction_district IS NULL THEN 'STATE'
                                     ELSE 'DISTRICT' END`;
    const actions = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH apps AS (${this.scopedApplications(s)}),
      acts AS (
        SELECT d.officer_id,
               CASE d.decision WHEN 'APPROVE' THEN 'verify' WHEN 'REJECT' THEN 'reject'
                               WHEN 'DEFECT' THEN 'defective' ELSE 'other' END AS action,
               d.bulk_batch_id IS NOT NULL AS bulk,
               coalesce((d.reasons ->> 'eligibility_review_confirmed')::boolean, false) AS override,
               extract(epoch FROM t.created_at - (
                 SELECT max(p.created_at) FROM workflow_transitions p
                  WHERE p.application_id = d.application_id AND p.to_stage = t.from_stage
                    AND p.created_at < t.created_at)) AS handling_s
          FROM decision_records d
          JOIN apps ON apps.id = d.application_id
          LEFT JOIN workflow_transitions t
                 ON t.id = CASE WHEN d.reasons ->> 'workflow_transition_id' ~ '^[0-9a-f-]{36}$'
                                THEN (d.reasons ->> 'workflow_transition_id')::uuid END
                AND t.application_id = d.application_id
         WHERE d.created_at >= ${s.from} AND d.created_at < ${s.to}
        UNION ALL
        SELECT e.confirmed_by_officer_id, 'document_confirm', false,
               jsonb_array_length(coalesce(e.corrected_fields, '[]'::jsonb)) > 0
                 OR e.classification_matches_slot IS FALSE,
               NULL
          FROM document_extractions e
          JOIN documents doc ON doc.id = e.document_id
          JOIN apps ON apps.id = doc.application_id
         WHERE e.confirmed_by_officer_id IS NOT NULL
           AND e.confirmed_at >= ${s.from} AND e.confirmed_at < ${s.to}
        UNION ALL
        SELECT ff.reviewed_by_officer_id, 'fraud_review', false, ff.status = 'FALSE_POSITIVE', NULL
          FROM fraud_flags ff
          JOIN apps ON apps.id = ff.application_id
         WHERE ff.reviewed_by_officer_id IS NOT NULL
           AND ff.reviewed_at >= ${s.from} AND ff.reviewed_at < ${s.to}
        UNION ALL
        SELECT sel.confirmed_by_officer_id, 'selection_confirm', false, sel.objection_window_overridden, NULL
          FROM selections sel
          JOIN apps ON apps.id = sel.application_id
         WHERE sel.confirmed_by_officer_id IS NOT NULL
           AND sel.confirmed_at >= ${s.from} AND sel.confirmed_at < ${s.to}
        UNION ALL
        SELECT cd.officer_id, 'committee_decision', false, cd.kind LIKE 'OVERRIDE_%', NULL
          FROM selection_committee_decisions cd
          JOIN selection_list_entries le ON le.id = cd.entry_id
          JOIN apps ON apps.id = le.application_id
         WHERE cd.created_at >= ${s.from} AND cd.created_at < ${s.to}
      )
      SELECT r.name AS role, ${levelSql} AS level,
             count(*)::int AS actions_total,
             count(*) FILTER (WHERE acts.action = 'verify')::int AS verify,
             count(*) FILTER (WHERE acts.action = 'reject')::int AS reject,
             count(*) FILTER (WHERE acts.action = 'defective')::int AS defective,
             count(*) FILTER (WHERE acts.action = 'document_confirm')::int AS document_confirm,
             count(*) FILTER (WHERE acts.action = 'fraud_review')::int AS fraud_review,
             count(*) FILTER (WHERE acts.action = 'selection_confirm')::int AS selection_confirm,
             count(*) FILTER (WHERE acts.action = 'committee_decision')::int AS committee_decision,
             count(*) FILTER (WHERE acts.action = 'other')::int AS other,
             count(*) FILTER (WHERE acts.override)::int AS overrides,
             count(*) FILTER (WHERE acts.bulk)::int AS bulk_actions,
             count(DISTINCT acts.officer_id)::int AS officers_active,
             count(acts.handling_s)::int AS timed_decisions,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY acts.handling_s) AS median_s,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY acts.handling_s) AS p90_s
        FROM acts
        JOIN officers o ON o.id = acts.officer_id
        JOIN roles r ON r.id = o.role_id
       GROUP BY r.name, ${levelSql}
       ORDER BY 1, 2
       LIMIT 100`;
    const queueStages = Object.keys(STAGE_SLA_DAYS);
    const queues = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH apps AS (${this.scopedApplications(s)}),
      stages AS (SELECT unnest(${queueStages}::text[]) AS stage)
      SELECT st.stage,
             (SELECT count(*) FROM apps WHERE apps.current_stage = st.stage)::int AS in_queue_now,
             (SELECT count(*) FROM apps WHERE apps.current_stage = st.stage
                AND apps.stage_due_at < now())::int AS past_sla_now,
             (SELECT count(*) FROM sla_breaches b JOIN apps ON apps.id = b.application_id
               WHERE b.stage = st.stage AND b.detected_at >= ${s.from}
                 AND b.detected_at < ${s.to})::int AS breaches_recorded
        FROM stages st
       ORDER BY 1`;

    const countKeys = [
      'actions_total',
      'verify',
      'reject',
      'defective',
      'document_confirm',
      'fraud_review',
      'selection_confirm',
      'committee_decision',
      'other',
      'overrides',
      'bulk_actions',
      'officers_active',
    ];
    type WorkloadRow = Record<string, unknown> & {
      officers_active: number;
      timed_decisions: number;
      median_s: unknown;
      p90_s: unknown;
    };
    const plain: WorkloadRow[] = actions.map((r) => ({
      role: String(r.role),
      level: String(r.level),
      ...Object.fromEntries(countKeys.map((k) => [k, n(r[k])])),
      officers_active: n(r.officers_active),
      timed_decisions: n(r.timed_decisions),
      median_s: r.median_s,
      p90_s: r.p90_s,
    }));
    const masked = suppressRows(plain, { applicantKey: 'actions_total', countKeys });
    const rows = masked.map((r, i) => {
      const src = plain[i];
      const timesShown =
        src.officers_active >= SMALL_COUNT_THRESHOLD &&
        src.timed_decisions >= SMALL_COUNT_THRESHOLD;
      const rest = { ...r };
      delete rest.median_s;
      delete rest.p90_s;
      delete rest.timed_decisions;
      return {
        ...rest,
        median_handling_hours: timesShown ? hours(src.median_s) : SECONDARY_SUPPRESSED,
        p90_handling_hours: timesShown ? hours(src.p90_s) : SECONDARY_SUPPRESSED,
      };
    });
    const queueRows = suppressRows(
      queues.map((r) => ({
        stage: String(r.stage),
        role: rolesActingAt(String(r.stage)).join(' / ') || null,
        sla_days: STAGE_SLA_DAYS[String(r.stage) as keyof typeof STAGE_SLA_DAYS] ?? null,
        in_queue_now: n(r.in_queue_now),
        past_sla_now: n(r.past_sla_now),
        breaches_recorded: n(r.breaches_recorded),
      })),
      {
        applicantKey: 'in_queue_now',
        countKeys: ['in_queue_now', 'past_sla_now', 'breaches_recorded'],
      },
    );
    return {
      meta: {
        ...s.meta,
        cohort: 'officer actions in [from, to) on applications visible to the caller',
        identification:
          'officers are grouped by role and jurisdiction level (DISTRICT, STATE, NATIONAL); no officer id or name is shown',
        overrides:
          'actions that set aside a machine or system result: eligibility-review confirmations, document confirmations with corrected values or a different document type, fraud flags marked FALSE_POSITIVE, selections confirmed inside the objection window, committee row overrides',
        handling_time:
          'hours from the application entering the stage to the decision (verify / reject / defective); not officer effort, which is not recorded',
        bulk_actions:
          'decisions (verify / reject / defective) taken as part of a bulk action - each also counted in its own column; recorded from Phase 17 on (decision_records.bulk_batch_id), earlier bulk decisions count as individual',
        suppression: `counts 1-${SMALL_COUNT_THRESHOLD - 1} are shown as "<${SMALL_COUNT_THRESHOLD}"; a row with fewer than ${SMALL_COUNT_THRESHOLD} actions is masked entirely; a lone masked cell also masks the smallest other non-zero cell ("suppressed"); handling times are "suppressed" for a row covering fewer than ${SMALL_COUNT_THRESHOLD} officers or ${SMALL_COUNT_THRESHOLD} timed decisions`,
        queue:
          'queues are the current stage of the visible applications (a snapshot, not windowed); breaches_recorded counts sla_breaches detected in [from, to)',
      },
      actions: rows,
      queues: queueRows,
    };
  }

  // ------------------------------------------- Phase 16 verification quality
  /**
   * How often officers change the machine's result, per document type and
   * scheme, for documents uploaded in [from, to). This is ROUTING, not
   * accuracy: an auto-accepted document was never checked by a person, and
   * an unchanged confirmation does not prove the machine was right.
   */
  async verificationQuality(actor: Actor, q: AnalyticsQueryDto) {
    const s = await this.begin(actor, q, 'verification_quality');
    const raw = await this.db.client.$queryRaw<Array<Record<string, unknown>>>`
      WITH apps AS (${this.scopedApplications(s)}),
      docs AS (
        SELECT apps.scheme_code, d.document_type AS slot, d.source, d.intake_status,
               x.status AS extraction_status, x.review_status,
               jsonb_array_length(coalesce(x.corrected_fields, '[]'::jsonb)) AS corrected,
               x.classification_matches_slot AS matches_slot
          FROM documents d
          JOIN apps ON apps.id = d.application_id
          LEFT JOIN LATERAL (
            SELECT e.status, e.review_status, e.corrected_fields, e.classification_matches_slot
              FROM document_extractions e WHERE e.document_id = d.id
             ORDER BY e.created_at DESC, e.id LIMIT 1) x ON TRUE
         WHERE d.created_at >= ${s.from} AND d.created_at < ${s.to}
      )
      SELECT scheme_code, slot, source,
             count(*)::int AS uploaded,
             count(*) FILTER (WHERE intake_status = 'QUALITY_REJECTED')::int AS rejected_unreadable,
             count(*) FILTER (WHERE extraction_status IS NOT NULL)::int AS processed,
             count(*) FILTER (WHERE extraction_status = 'FAILED')::int AS extraction_failed,
             count(*) FILTER (WHERE review_status = 'AUTO_ACCEPTED')::int AS auto_verified,
             count(*) FILTER (WHERE review_status IN ('NEEDS_REVIEW', 'OFFICER_CONFIRMED'))::int AS sent_to_review,
             count(*) FILTER (WHERE review_status = 'NEEDS_REVIEW')::int AS awaiting_officer,
             count(*) FILTER (WHERE review_status = 'OFFICER_CONFIRMED')::int AS officer_decided,
             count(*) FILTER (WHERE review_status = 'OFFICER_CONFIRMED' AND corrected > 0)::int AS officer_corrected,
             count(*) FILTER (WHERE review_status = 'OFFICER_CONFIRMED' AND matches_slot IS FALSE)::int AS type_overridden,
             count(*) FILTER (WHERE review_status = 'OFFICER_CONFIRMED'
                                AND (corrected > 0 OR matches_slot IS FALSE))::int AS overridden
        FROM docs
       GROUP BY scheme_code, slot, source
       LIMIT 2000`;
    const countKeys = [
      'uploaded',
      'rejected_unreadable',
      'processed',
      'extraction_failed',
      'auto_verified',
      'sent_to_review',
      'awaiting_officer',
      'officer_decided',
      'officer_corrected',
      'type_overridden',
      'overridden',
    ];
    // Slots are checklist labels; the same canonical mapping as the pipeline.
    const byKey = new Map<string, Record<string, unknown> & Record<string, number>>();
    for (const r of raw) {
      const type = canonicalTypeForSlot(String(r.slot)) ?? 'UNMAPPED';
      const key = `${String(r.scheme_code)}|${type}|${String(r.source)}`;
      const acc =
        byKey.get(key) ??
        ({
          scheme_code: r.scheme_code,
          document_type: type,
          source: r.source,
          ...Object.fromEntries(countKeys.map((k) => [k, 0])),
        } as unknown as Record<string, unknown> & Record<string, number>);
      for (const k of countKeys) acc[k] += n(r[k]);
      byKey.set(key, acc);
    }
    const plain = [...byKey.values()].sort((a, b) =>
      `${String(a.scheme_code)}|${String(a.document_type)}|${String(a.source)}`.localeCompare(
        `${String(b.scheme_code)}|${String(b.document_type)}|${String(b.source)}`,
      ),
    );
    const masked = suppressRows(plain, {
      applicantKey: 'uploaded',
      countKeys,
      groupKey: (r) => String(r.scheme_code),
    });
    const rate = (num: unknown, den: unknown) =>
      typeof num === 'number' && typeof den === 'number'
        ? den === 0
          ? null
          : Math.round((num / den) * 10_000) / 10_000
        : SECONDARY_SUPPRESSED;
    const rows = masked.map((r) => {
      const machineRouted =
        typeof r.auto_verified === 'number' && typeof r.sent_to_review === 'number'
          ? r.auto_verified + r.sent_to_review
          : SECONDARY_SUPPRESSED;
      return {
        ...r,
        auto_accept_rate: r.source === 'DIGILOCKER' ? null : rate(r.auto_verified, machineRouted),
        override_rate: rate(r.overridden, r.officer_decided),
      };
    });
    return {
      meta: {
        ...s.meta,
        cohort: 'documents uploaded in [from, to) to applications visible to the caller',
        meaning:
          'Routing outcomes, not accuracy. auto_accept_rate = auto_verified / (auto_verified + sent_to_review): how often the machine routed a document past officers. override_rate = overridden / officer_decided: how often an officer who reviewed a document changed the machine result (corrected a value or accepted a different document type). Neither says whether the machine was right: an auto-accepted document was never checked by a person.',
        document_type:
          'the checklist slot mapped to a canonical document type (UNMAPPED when the slot has none); DIGILOCKER rows are issuer data, not machine-read (no auto_accept_rate)',
        officer_actions:
          'officers can only confirm a document, with or without corrections; there is no officer rejection of a document (rejected_unreadable is the automatic quality gate)',
        read: 'routing columns only: review_status, the number of corrected fields, the document-type match, extraction status; never extracted values',
        suppression: `counts 1-${SMALL_COUNT_THRESHOLD - 1} are shown as "<${SMALL_COUNT_THRESHOLD}"; a row with fewer than ${SMALL_COUNT_THRESHOLD} uploads is masked entirely; within a scheme a lone masked cell also masks the smallest other non-zero cell ("suppressed"); a rate is shown only when both of its counts are`,
      },
      rows,
    };
  }
}
