import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { EDITABLE_PROFILE_FIELDS, UpdateProfileDto } from './applicants.dto';

const PROFILE_SELECT = {
  id: true,
  email: true,
  first_name: true,
  last_name: true,
  phone: true,
  gender: true,
  dob: true,
  category: true,
  pvtg_group: true,
  is_disabled: true,
  disability_type: true,
  disability_percentage: true,
  domicile_state: true,
  domicile_district: true,
  caste_cert_number: true,
  income: true,
  bank_account: true,
  preferred_language: true,
  updated_at: true,
} as const;

/** "****1234": identifiers are shown to their owner masked (last 4 characters). */
function mask(v: unknown): string | null {
  const s = typeof v === 'string' ? v : '';
  return s ? `****${s.slice(-4)}` : null;
}

/** The supported-language refusal, shared with registration. */
export function unsupportedLanguage(supported: readonly string[]): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, {
    details: [
      { field: 'preferred_language', constraints: { supported: `one of ${supported.join(', ')}` } },
    ],
  });
}

/**
 * Phase 13D: the applicant's own profile. Every query is scoped to the
 * caller's account (applicants has no row-level security: the notification
 * and document workers read it without an actor), so an applicant can only
 * ever reach their own row. Sensitive fields are decrypted by the PII
 * extension and returned only here - identifiers masked - and never logged.
 * A change records WHICH fields changed (applicant_profile_changes, audited),
 * never their values.
 */
@Injectable()
export class ApplicantsService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    @InjectPinoLogger(ApplicantsService.name) private readonly logger: PinoLogger,
  ) {}

  private async own(actor: Actor) {
    const a = await this.db.client.applicant.findFirst({
      where: { user_id: actor.accountId },
      select: PROFILE_SELECT,
    });
    if (!a) throw new AppError(ErrorCode.NOT_FOUND);
    return a;
  }

  private view(a: Awaited<ReturnType<ApplicantsService['own']>>) {
    const income = a.income as unknown;
    return {
      applicant_id: a.id,
      email: a.email,
      first_name: a.first_name,
      last_name: a.last_name,
      phone: a.phone,
      gender: a.gender,
      dob: a.dob,
      category: a.category,
      pvtg_group: a.pvtg_group,
      is_disabled: a.is_disabled,
      disability_type: a.disability_type,
      disability_percentage: a.disability_percentage,
      domicile_state: a.domicile_state,
      domicile_district: a.domicile_district,
      annual_income: typeof income === 'string' ? income : null,
      caste_cert_number_masked: mask(a.caste_cert_number),
      bank_account_masked: mask(a.bank_account),
      preferred_language: a.preferred_language,
      supported_languages: this.config.languages.supported,
      editable_fields: EDITABLE_PROFILE_FIELDS,
      updated_at: a.updated_at,
    };
  }

  async me(actor: Actor) {
    return this.view(await this.own(actor));
  }

  async update(actor: Actor, dto: UpdateProfileDto) {
    const a = await this.own(actor);
    if (
      dto.preferred_language !== undefined &&
      !this.config.languages.supported.includes(dto.preferred_language)
    ) {
      throw unsupportedLanguage(this.config.languages.supported);
    }
    const data: { phone?: string; preferred_language?: string } = {};
    if (dto.phone !== undefined && dto.phone !== a.phone) data.phone = dto.phone;
    if (dto.preferred_language !== undefined && dto.preferred_language !== a.preferred_language) {
      data.preferred_language = dto.preferred_language;
    }
    const changed = Object.keys(data);
    if (changed.length === 0) return { ...this.view(a), changed_fields: [] };

    await this.db.client.applicant.update({ where: { id: a.id }, data, select: { id: true } });
    await this.db.client.applicantProfileChange.create({
      data: { applicant_id: a.id, changed_fields: changed, changed_by_account_id: actor.accountId },
      select: { id: true },
    });
    // Field names only.
    this.logger.info({ applicantId: a.id, changedFields: changed }, 'applicant profile updated');
    return { ...this.view(await this.own(actor)), changed_fields: changed };
  }

  /**
   * Phase 17 (B4): the verified path an approved correction request takes -
   * the same change log as the applicant's own edits (applicant_profile_changes,
   * field names only, audited), written by the deciding officer's transaction
   * (applicants RLS: an officer whose jurisdiction covers the applicant).
   */
  async applyVerifiedCorrection(
    applicantId: string,
    field: 'first_name' | 'last_name' | 'dob' | 'gender',
    value: string,
    officerAccountId: string,
  ) {
    const data = field === 'dob' ? { dob: new Date(`${value}T00:00:00.000Z`) } : { [field]: value };
    const r = await this.db.client.applicant.updateMany({ where: { id: applicantId }, data });
    if (r.count !== 1) throw new AppError(ErrorCode.NOT_FOUND);
    await this.db.client.applicantProfileChange.create({
      data: {
        applicant_id: applicantId,
        changed_fields: [field],
        changed_by_account_id: officerAccountId,
      },
      select: { id: true },
    });
    this.logger.info({ applicantId, changedFields: [field] }, 'applicant profile corrected');
  }
}
