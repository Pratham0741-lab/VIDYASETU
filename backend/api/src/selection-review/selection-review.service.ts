import { Injectable } from '@nestjs/common';
import { DbContext } from '../database/db-context';
import type { SelectionListQueryDto } from './selection-review.dto';

/**
 * Phase 13B: the selection list as the committee reviews it - ranks,
 * reservations, the score each rank used (with its breakdown) and the
 * objections raised against the run. Read-only (READ ONLY transaction);
 * every row is scoped by row-level security on selections, scores,
 * applications and grievances. Objection text is not listed here (open one
 * with GET /api/v1/grievances/:id).
 */
@Injectable()
export class SelectionReviewService {
  constructor(private readonly db: DbContext) {}

  async list(q: SelectionListQueryDto) {
    const client = this.db.client;
    await client.$executeRaw`SET TRANSACTION READ ONLY`;
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.page_size ?? 50);
    const where = {
      scheme_code: q.scheme,
      academic_year: q.academic_year,
      ...(q.status ? { selection_status: q.status } : {}),
    };
    const [total, rows] = await Promise.all([
      client.selection.count({ where }),
      client.selection.findMany({
        where,
        select: {
          id: true,
          application_id: true,
          merit_rank: true,
          vertical_category: true,
          is_female_reserved: true,
          is_pwd_reserved: true,
          selection_basis: true,
          selection_run_id: true,
          selection_status: true,
          confirmed_at: true,
          application: { select: { application_no: true, current_stage: true } },
          score: { select: { score_type: true, score_value: true, breakdown: true } },
        },
        orderBy: [{ merit_rank: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const runIds = [...new Set(rows.map((r) => r.selection_run_id))];
    const objections =
      runIds.length === 0
        ? []
        : await client.grievance.findMany({
            where: { subject_type: 'SELECTION_OBJECTION', selection_run_id: { in: runIds } },
            select: {
              id: true,
              application_id: true,
              selection_run_id: true,
              status: true,
              created_at: true,
              sla_due_at: true,
            },
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          });
    return {
      scheme: q.scheme,
      academic_year: q.academic_year,
      page,
      page_size: pageSize,
      total,
      selections: rows.map((r) => ({
        selection_id: r.id,
        application_id: r.application_id,
        application_no: r.application.application_no,
        current_stage: r.application.current_stage,
        merit_rank: r.merit_rank,
        vertical_category: r.vertical_category,
        is_female_reserved: r.is_female_reserved,
        is_pwd_reserved: r.is_pwd_reserved,
        selection_basis: r.selection_basis,
        selection_run_id: r.selection_run_id,
        selection_status: r.selection_status,
        confirmed_at: r.confirmed_at,
        score: r.score
          ? {
              score_type: r.score.score_type,
              score_value: r.score.score_value,
              breakdown: r.score.breakdown,
            }
          : null,
      })),
      objections,
    };
  }
}
