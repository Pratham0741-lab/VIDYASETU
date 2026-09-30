import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { toCsv } from '../analytics/csv';
import {
  SMALL_COUNT_THRESHOLD,
  SUPPRESSED,
  SECONDARY_SUPPRESSED,
  suppressRows,
} from '../analytics/suppression';
import type { Actor } from '../auth/actor';
import { AppRole } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import type { FairnessQueryDto } from './fairness.dto';

export const FAIRNESS_DIMENSIONS = [
  'category',
  'gender',
  'pwd_status',
  'district',
  'institution_type',
] as const;
export type FairnessDimension = (typeof FAIRNESS_DIMENSIONS)[number];

/** At most this many buckets per dimension (districts are the only open-ended one). */
export const MAX_BUCKETS = 100;

/**
 * Institution type is not recorded anywhere; it is derived from the code's
 * family (applications.institution_code: "AISHE / U-DISE / NCVT / QS Rank").
 * A heuristic, documented bucket - not a registry lookup.
 */
const INSTITUTION_TYPE_SQL = Prisma.sql`CASE
  WHEN a.institution_code IS NULL OR btrim(a.institution_code) = '' THEN 'NOT_RECORDED'
  WHEN a.institution_code ~ '^U-[0-9]+$' THEN 'AISHE_UNIVERSITY'
  WHEN a.institution_code ~ '^C-[0-9]+$' THEN 'AISHE_COLLEGE'
  WHEN a.institution_code ~ '^S-[0-9]+$' THEN 'AISHE_STANDALONE'
  WHEN a.institution_code ~ '^[0-9]{11}$' THEN 'UDISE_SCHOOL'
  ELSE 'OTHER' END`;

type Bucket = { dimension: string; bucket: string; applied: number; selected: number };

/**
 * Phase 13E (plan Phase 13/16): fairness data - applied vs selected by
 * category, gender, PwD status, district and institution type, with the
 * selection rate. The analytics module's rules, applied the same way (its
 * code is reused, not changed):
 *   * the cohort is RLS-scoped (the caller's jurisdiction, in the database),
 *     one scheme and academic year (a bounded query), in a READ ONLY
 *     transaction; fixtures excluded unless a SUPER_ADMIN asks;
 *   * aggregates only - no identifier or name leaves the query; only
 *     applicant profile columns (category, gender, is_disabled) and
 *     application columns are read, never an OCR or encrypted column;
 *   * small counts: 1-4 shown as "<5", and secondary suppression inside each
 *     dimension (each is published with its total); a rate is shown only when
 *     both of its counts are.
 * "Selected" is the final list's outcome where the run's final list is
 * published, otherwise a live selection (PROVISIONAL / CONFIRMED).
 */
@Injectable()
export class FairnessService {
  constructor(
    private readonly db: DbContext,
    @InjectPinoLogger(FairnessService.name) private readonly logger: PinoLogger,
  ) {}

  async report(actor: Actor, q: FairnessQueryDto) {
    const includeFixtures = q.include_fixtures === 'true';
    if (includeFixtures && actor.role !== AppRole.SUPER_ADMIN) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        details: { reason: 'include_fixtures_requires_super_admin' },
      });
    }
    const client = this.db.client;
    await client.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await client.$queryRaw<Array<Bucket & { applied: bigint; selected: bigint }>>`
      WITH cohort AS (
        SELECT a.id, a.jurisdiction_district, ${INSTITUTION_TYPE_SQL} AS institution_type,
               p.category, p.gender, p.is_disabled,
               CASE
                 WHEN EXISTS (SELECT 1 FROM selection_list_entries e JOIN selection_lists l ON l.id = e.selection_list_id
                               WHERE e.application_id = a.id AND l.status = 'FINAL_PUBLISHED')
                 THEN EXISTS (SELECT 1 FROM selection_list_entries e JOIN selection_lists l ON l.id = e.selection_list_id
                               WHERE e.application_id = a.id AND l.status = 'FINAL_PUBLISHED'
                                 AND e.final_outcome = 'SELECTED')
                 ELSE EXISTS (SELECT 1 FROM selections s WHERE s.application_id = a.id
                               AND s.selection_status IN ('PROVISIONAL', 'CONFIRMED'))
               END AS is_selected
          FROM applications a
          JOIN schemes sc ON sc.id = a.scheme_id
          JOIN applicants p ON p.id = a.applicant_id
         WHERE sc.code = ${q.scheme} AND a.academic_year = ${q.academic_year}
           AND a.submitted_at IS NOT NULL
           ${
             includeFixtures
               ? Prisma.empty
               : Prisma.sql`AND NOT EXISTS (SELECT 1 FROM test_fixtures f
                            WHERE f.entity_type = 'application' AND f.entity_id = a.id)`
           }
      ),
      buckets AS (
        SELECT 'category' AS dimension, coalesce(category, 'NOT_RECORDED') AS bucket, is_selected FROM cohort
        UNION ALL SELECT 'gender', coalesce(gender, 'NOT_RECORDED'), is_selected FROM cohort
        UNION ALL SELECT 'pwd_status', CASE WHEN is_disabled THEN 'PWD' ELSE 'NOT_PWD' END, is_selected FROM cohort
        UNION ALL SELECT 'district', coalesce(jurisdiction_district, 'NOT_RECORDED'), is_selected FROM cohort
        UNION ALL SELECT 'institution_type', institution_type, is_selected FROM cohort
      ),
      counted AS (
        SELECT dimension, bucket, count(*) AS applied, count(*) FILTER (WHERE is_selected) AS selected,
               row_number() OVER (PARTITION BY dimension ORDER BY count(*) DESC, bucket) AS n
          FROM buckets GROUP BY dimension, bucket
      )
      SELECT dimension, bucket, applied, selected FROM counted
       WHERE n <= ${MAX_BUCKETS}
       ORDER BY dimension, bucket`;
    const plain: Bucket[] = rows.map((r) => ({
      dimension: r.dimension,
      bucket: r.bucket,
      applied: Number(r.applied),
      selected: Number(r.selected),
    }));
    const total = plain
      .filter((r) => r.dimension === 'gender')
      .reduce((t, r) => ({ applied: t.applied + r.applied, selected: t.selected + r.selected }), {
        applied: 0,
        selected: 0,
      });
    const masked = suppressRows(plain, {
      applicantKey: 'applied',
      countKeys: ['applied', 'selected'],
      groupKey: (r) => r.dimension,
    });
    const dimensions = Object.fromEntries(
      FAIRNESS_DIMENSIONS.map((d) => [
        d,
        masked
          .filter((r) => r.dimension === d)
          .map((r) => ({
            bucket: r.bucket,
            applied: r.applied,
            selected: r.selected,
            selection_rate:
              typeof r.applied === 'number' && typeof r.selected === 'number' && r.applied > 0
                ? Math.round((r.selected / r.applied) * 1000) / 1000
                : r.applied === 0
                  ? null
                  : 'suppressed',
          })),
      ]),
    );
    const totalMasked = suppressRows([total], {
      applicantKey: 'applied',
      countKeys: ['applied', 'selected'],
    })[0];
    // Parameters and counts of buckets only: never a row value.
    this.logger.info(
      {
        scheme: q.scheme,
        academicYear: q.academic_year,
        fixtures: includeFixtures,
        buckets: plain.length,
      },
      'fairness query',
    );
    return {
      meta: {
        view: 'fairness',
        scheme: q.scheme,
        academic_year: q.academic_year,
        cohort: 'submitted applications of the scheme and academic year',
        selected_means:
          'the final list outcome where the run has a published final list, otherwise a live selection (PROVISIONAL / CONFIRMED)',
        scope: 'rows visible to the caller under database row-level security',
        fixtures: includeFixtures ? 'included' : 'excluded',
        small_count_threshold: SMALL_COUNT_THRESHOLD,
        suppression: `counts 1-${SMALL_COUNT_THRESHOLD - 1} are shown as "${SUPPRESSED}"; within each dimension a lone suppressed cell also hides the smallest other non-zero cell ("${SECONDARY_SUPPRESSED}"); a rate is shown only when both counts are`,
        institution_type:
          'derived from the institution code family (AISHE U- / C- / S-, 11-digit U-DISE, else OTHER); no institution registry exists',
        max_buckets_per_dimension: MAX_BUCKETS,
        generated_at: new Date().toISOString(),
      },
      total: {
        applied: totalMasked.applied,
        selected: totalMasked.selected,
        selection_rate:
          typeof totalMasked.applied === 'number' &&
          typeof totalMasked.selected === 'number' &&
          total.applied > 0
            ? Math.round((total.selected / total.applied) * 1000) / 1000
            : total.applied === 0
              ? null
              : 'suppressed',
      },
      dimensions,
    };
  }

  /** Phase 16: the export table (CSV, XLSX and PDF all use it). */
  async table(actor: Actor, q: FairnessQueryDto) {
    const r = await this.report(actor, q);
    const rows = FAIRNESS_DIMENSIONS.flatMap((d) =>
      (r.dimensions[d] as Array<Record<string, unknown>>).map((b) => ({ dimension: d, ...b })),
    );
    return {
      meta: r.meta as Record<string, unknown>,
      table: { columns: ['dimension', 'bucket', 'applied', 'selected', 'selection_rate'], rows },
    };
  }

  async csv(actor: Actor, q: FairnessQueryDto): Promise<string> {
    const { table } = await this.table(actor, q);
    return toCsv(table.columns, table.rows);
  }
}
