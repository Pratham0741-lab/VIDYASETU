import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';
import { RECORDED_FIELDS } from '../schemes/eligibility.service';
import { sanitizeProfile } from '../schemes/profile';
import { SENSITIVE_PROFILE_KEYS } from '../schemes/sensitive-fields';
import type { CreateApplicationDto, SaveApplicationDraftDto } from './applications.dto';
import { ApplicationsService } from './applications.service';

const DRAFT_SELECT = {
  id: true,
  status: true,
  scheme_version_id: true,
  academic_year: true,
  institution_name: true,
  institution_code: true,
  course_name: true,
  course_year: true,
  is_hosteller: true,
  declared: true,
  submitted_application_id: true,
  submitted_at: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.ApplicationDraftSelect;

/** Open drafts one applicant may keep (a bound on what a single account stores). */
export const MAX_OPEN_DRAFTS = 20;

/**
 * Application drafts (Phase 14 loose ends, Part C; plan Phase 6). A draft is
 * the applicant's own, unsubmitted copy of what POST /applications takes:
 * saved, resumed and edited freely, visible to nobody else (owner-only RLS;
 * it is not an application, so no queue, analytics, fraud detector or
 * selection reads it). Submitting it runs the unchanged submit path
 * (ApplicationsService.create: version must be active, jurisdiction from
 * domicile, automatic eligibility gate) in the same transaction, then
 * freezes the draft with the application it became.
 */
@Injectable()
export class ApplicationDraftsService {
  constructor(
    private readonly db: DbContext,
    private readonly applications: ApplicationsService,
    @InjectPinoLogger(ApplicationDraftsService.name) private readonly logger: PinoLogger,
  ) {}

  private async applicantId(actor: Actor): Promise<string> {
    const a = await this.db.client.applicant.findUnique({
      where: { user_id: actor.accountId },
      select: { id: true },
    });
    if (!a) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_applicant_profile' } });
    }
    return a.id;
  }

  /** Declared gate inputs: never a recorded field, never a sensitive one. */
  private declared(input: unknown): Record<string, unknown> {
    const declared = sanitizeProfile(input ?? {}, 'declared');
    const refused = Object.keys(declared).filter(
      (k) => (RECORDED_FIELDS as readonly string[]).includes(k) || SENSITIVE_PROFILE_KEYS.has(k),
    );
    if (refused.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: refused.map((k) => ({
          field: `declared.${k}`,
          constraints: {
            recordedField: `${k} comes from your profile or is sensitive; it cannot be declared in a draft`,
          },
        })),
      });
    }
    return { ...declared };
  }

  private async checkVersion(id: string | undefined) {
    if (id === undefined) return;
    const v = await this.db.client.schemeVersion.findUnique({
      where: { id },
      select: { status: true },
    });
    // A scheme's own unpublished draft is as invisible here as on the public routes.
    if (!v || v.status === 'draft') {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'scheme_version_id' } });
    }
  }

  private data(dto: SaveApplicationDraftDto) {
    return {
      ...(dto.scheme_version_id !== undefined ? { scheme_version_id: dto.scheme_version_id } : {}),
      ...(dto.academic_year !== undefined ? { academic_year: dto.academic_year } : {}),
      ...(dto.institution_name !== undefined ? { institution_name: dto.institution_name } : {}),
      ...(dto.institution_code !== undefined ? { institution_code: dto.institution_code } : {}),
      ...(dto.course_name !== undefined ? { course_name: dto.course_name } : {}),
      ...(dto.course_year !== undefined ? { course_year: dto.course_year } : {}),
      ...(dto.is_hosteller !== undefined ? { is_hosteller: dto.is_hosteller } : {}),
      ...(dto.declared !== undefined
        ? { declared: this.declared(dto.declared) as Prisma.InputJsonObject }
        : {}),
    };
  }

  async create(actor: Actor, dto: SaveApplicationDraftDto) {
    const applicantId = await this.applicantId(actor);
    await this.checkVersion(dto.scheme_version_id);
    const open = await this.db.client.applicationDraft.count({
      where: { applicant_id: applicantId, status: 'DRAFT' },
    });
    if (open >= MAX_OPEN_DRAFTS) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'too_many_open_drafts', max: MAX_OPEN_DRAFTS },
      });
    }
    const d = await this.db.client.applicationDraft.create({
      data: { applicant_id: applicantId, ...this.data(dto) },
      select: DRAFT_SELECT,
    });
    this.logger.info({ draftId: d.id }, 'application draft saved');
    return d;
  }

  list() {
    return this.db.client.applicationDraft.findMany({
      select: DRAFT_SELECT,
      orderBy: { updated_at: 'desc' },
      take: 100,
    });
  }

  async get(id: string) {
    // Owner-only RLS: anyone else's draft, and a nonexistent one, are both 404.
    const d = await this.db.client.applicationDraft.findFirst({
      where: { id },
      select: DRAFT_SELECT,
    });
    if (!d) throw new AppError(ErrorCode.NOT_FOUND);
    return d;
  }

  private refuseSubmitted(d: { status: string; submitted_application_id: string | null }) {
    if (d.status !== 'DRAFT') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: {
          reason: 'draft_already_submitted',
          application_id: d.submitted_application_id,
        },
      });
    }
  }

  async update(id: string, dto: SaveApplicationDraftDto) {
    const d = await this.get(id);
    this.refuseSubmitted(d);
    await this.checkVersion(dto.scheme_version_id);
    const updated = await this.db.client.applicationDraft.update({
      where: { id: d.id },
      data: this.data(dto),
      select: DRAFT_SELECT,
    });
    this.logger.info({ draftId: d.id }, 'application draft updated');
    return updated;
  }

  /** The unchanged submit path, then the draft is frozen with the application it became. */
  async submit(actor: Actor, id: string) {
    const d = await this.get(id);
    this.refuseSubmitted(d);
    const missing = (['scheme_version_id', 'academic_year'] as const).filter((k) => d[k] === null);
    if (missing.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: missing.map((field) => ({
          field,
          constraints: { required: `${field} is needed before the draft can be submitted` },
        })),
      });
    }
    const dto: CreateApplicationDto = {
      scheme_version_id: d.scheme_version_id!,
      academic_year: d.academic_year!,
      ...(d.institution_name !== null ? { institution_name: d.institution_name } : {}),
      ...(d.institution_code !== null ? { institution_code: d.institution_code } : {}),
      ...(d.course_name !== null ? { course_name: d.course_name } : {}),
      ...(d.course_year !== null ? { course_year: d.course_year } : {}),
      ...(d.is_hosteller !== null ? { is_hosteller: d.is_hosteller } : {}),
      declared: d.declared as Record<string, unknown>,
    };
    const application = await this.applications.create(actor, dto);
    const now = new Date();
    await this.db.client.applicationDraft.update({
      where: { id: d.id },
      data: { status: 'SUBMITTED', submitted_application_id: application.id, submitted_at: now },
    });
    this.logger.info(
      { draftId: d.id, applicationId: application.id },
      'application draft submitted',
    );
    return { draft: await this.get(d.id), application };
  }
}
