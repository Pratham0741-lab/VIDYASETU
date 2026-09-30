import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { REVIEWER_ROLES } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { EligibilityGateResult, WorkflowService } from '../workflow/workflow.service';
import { privacyMessage } from '../privacy/privacy-messages';
import { PrivacyService } from '../privacy/privacy.service';
import { CreateApplicationDto } from './applications.dto';

/** Fields returned to clients: no PII. */
const APPLICATION_SELECT = {
  id: true,
  application_no: true,
  applicant_id: true,
  scheme_id: true,
  scheme_version_id: true,
  academic_year: true,
  current_stage: true,
  status: true,
  jurisdiction_state: true,
  jurisdiction_district: true,
  institution_name: true,
  institution_code: true,
  course_name: true,
  course_year: true,
  assigned_officer_id: true,
  submitted_at: true,
  stage_entered_at: true,
  stage_due_at: true,
  needs_eligibility_review: true,
} satisfies Prisma.ApplicationSelect;

export type ApplicationView = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

/**
 * Application record access for Phase 2. Every query goes through
 * DbContext.client (the request's actor transaction), so jurisdiction scope
 * and RLS apply automatically; no method adds its own jurisdiction filter.
 * Stage changes happen only in WorkflowService (src/workflow), which also
 * derives status from current_stage.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly db: DbContext,
    private readonly workflow: WorkflowService,
    private readonly privacy: PrivacyService,
  ) {}

  list(): Promise<ApplicationView[]> {
    return this.db.client.application.findMany({
      select: APPLICATION_SELECT,
      orderBy: { submitted_at: 'desc' },
      take: 100,
    });
  }

  async get(id: string): Promise<ApplicationView> {
    const application = await this.db.client.application.findFirst({
      where: { id },
      select: APPLICATION_SELECT,
    });
    // Out-of-jurisdiction and nonexistent look identical: never reveal existence.
    if (!application) throw new AppError(ErrorCode.NOT_FOUND);
    return application;
  }

  /**
   * The officer application view (Phase 16, M55): for a reviewer role, the
   * applicant's Aadhaar authentication status - outcome and the last four
   * digits only - through aadhaar_status_for_application(), which answers
   * only an in-jurisdiction reviewer. Other callers get the application
   * alone (applicants read their own status at /applicants/me/...).
   */
  async getForCaller(actor: Actor, id: string) {
    const application = await this.get(id);
    if (!(REVIEWER_ROLES as readonly string[]).includes(actor.role)) return application;
    const rows = await this.db.client.$queryRaw<
      Array<{ outcome: string; uid_last4: string | null; authenticated_at: Date | null }>
    >`SELECT * FROM aadhaar_status_for_application(${id}::uuid)`;
    const r = rows[0];
    return {
      ...application,
      aadhaar_authentication: r
        ? {
            status: r.outcome,
            aadhaar_masked: r.uid_last4 ? `XXXX XXXX ${r.uid_last4}` : null,
            at: r.authenticated_at?.toISOString() ?? null,
          }
        : null,
    };
  }

  /**
   * An applicant applies to a scheme version; jurisdiction comes from their
   * domicile. The application enters the workflow's initial stage
   * (SUBMITTED) and the automatic eligibility gate runs in this same
   * transaction, so it lands in INO_VERIFIED or DEFECTIVE before the
   * response is sent.
   */
  async create(
    actor: Actor,
    dto: CreateApplicationDto,
  ): Promise<ApplicationView & { eligibility_gate: EligibilityGateResult | null }> {
    const client = this.db.client;
    const applicant = await client.applicant.findUnique({
      where: { user_id: actor.accountId },
      select: { id: true, domicile_state: true, domicile_district: true },
    });
    if (!applicant) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_applicant_profile' } });
    }
    // Phase 17 (B2): a current consent for every required purpose. Nobody's
    // consent is backfilled: an applicant without one is asked for it here
    // (and GET /applicants/me/consents lists what is missing).
    const missing = await this.privacy.missingForSubmission(applicant.id);
    if (missing.length > 0) {
      throw new AppError(ErrorCode.CONFLICT, {
        message: privacyMessage('consent.required', 'en', { purposes: missing.join(', ') }),
        details: {
          reason: 'consent_required',
          message_key: 'consent.required',
          missing_purposes: missing,
        },
      });
    }

    const version = await client.schemeVersion.findUnique({
      where: { id: dto.scheme_version_id },
      select: { id: true, scheme_id: true, status: true },
    });
    if (!version || version.status !== 'active') {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'scheme_version_id' } });
    }

    const created = await client.application.create({
      data: {
        application_no: `VS-${dto.academic_year}-${randomBytes(5).toString('hex').toUpperCase()}`,
        applicant_id: applicant.id,
        scheme_id: version.scheme_id,
        scheme_version_id: version.id,
        academic_year: dto.academic_year,
        jurisdiction_state: applicant.domicile_state,
        jurisdiction_district: applicant.domicile_district,
        institution_name: dto.institution_name,
        institution_code: dto.institution_code,
        course_name: dto.course_name,
        course_year: dto.course_year,
        is_hosteller: dto.is_hosteller ?? false,
        ...this.workflow.initialStageColumns(new Date()),
      },
      select: { id: true },
    });

    const gate = await this.workflow.runAutomatic(created.id, dto.declared);
    return { ...(await this.get(created.id)), eligibility_gate: gate };
  }

  /** Officer takes ownership of an application in their jurisdiction. */
  async assignToMe(actor: Actor, id: string): Promise<ApplicationView> {
    try {
      return await this.db.client.application.update({
        where: { id },
        data: { assigned_officer_id: actor.officerId },
        select: APPLICATION_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new AppError(ErrorCode.NOT_FOUND);
      }
      throw err;
    }
  }
}
