import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ApplicantsService } from '../applicants/applicants.service';
import { APPLICANT_GENDERS } from '../auth/dto';
import type { Actor } from '../auth/actor';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { requireReason } from '../common/reason';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { bytes } from '../documents/review-routing';
import { DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { decryptPII, encryptPII } from '../lib/crypto/pii';
import { privacyMessage } from './privacy-messages';

export const CORRECTABLE_FIELDS = ['first_name', 'last_name', 'dob', 'gender'] as const;
export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/** The value checks registration applies to the same fields. */
function checkValue(field: CorrectableField, value: string): string | null {
  const v = value.trim();
  if (field === 'first_name' || field === 'last_name') {
    return v.length >= 1 && v.length <= 100 ? null : 'must be 1-100 characters';
  }
  if (field === 'gender') {
    return (APPLICANT_GENDERS as readonly string[]).includes(v)
      ? null
      : `must be one of ${APPLICANT_GENDERS.join(', ')}`;
  }
  const d = new Date(`${v}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d < new Date()
    ? null
    : 'must be a past date, YYYY-MM-DD';
}

/**
 * Phase 17 (Part B): consent records and the applicant's DPDP requests -
 * access (a structured export of their own data), correction (a request an
 * in-jurisdiction officer decides; applied through the verified change path)
 * and erasure (recorded only). Every read and write runs in the caller's
 * actor transaction: row-level security scopes each table to the owner (and,
 * for correction requests, in-jurisdiction officers).
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DbContext,
    private readonly config: AppConfigService,
    private readonly applicants: ApplicantsService,
    private readonly events: DomainEvents,
    @InjectPinoLogger(PrivacyService.name) private readonly logger: PinoLogger,
  ) {}

  private async applicant(actor: Actor) {
    const a = await this.db.client.applicant.findFirst({
      where: { user_id: actor.accountId },
      select: {
        id: true,
        preferred_language: true,
        domicile_state: true,
        domicile_district: true,
      },
    });
    if (!a)
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_applicant_profile' } });
    return a;
  }

  // ---------------------------------------------------------------- consent
  /** The latest record per purpose; "current" = GIVEN for the current notice version. */
  private async latest(applicantId: string) {
    const rows = await this.db.client.consentRecord.findMany({
      where: { applicant_id: applicantId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    const byPurpose = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!byPurpose.has(r.purpose)) byPurpose.set(r.purpose, r);
    return { rows, byPurpose };
  }

  /** Purposes an application needs that have no current consent (for the submit gate). */
  async missingForSubmission(applicantId: string): Promise<string[]> {
    const { byPurpose } = await this.latest(applicantId);
    const version = this.config.consent.noticeVersion;
    return this.config.consent.required.filter((p) => {
      const r = byPurpose.get(p);
      return !r || r.status !== 'GIVEN' || r.notice_version !== version;
    });
  }

  async consents(actor: Actor) {
    const a = await this.applicant(actor);
    const { rows, byPurpose } = await this.latest(a.id);
    const version = this.config.consent.noticeVersion;
    const lang = a.preferred_language;
    return {
      notice_version: version,
      language: lang,
      purposes: this.config.consent.purposes.map((p) => {
        const r = byPurpose.get(p);
        return {
          purpose: p,
          required_for_applications: this.config.consent.required.includes(p),
          title_key: `consent.${p}.title`,
          text_key: `consent.${p}.text`,
          title: privacyMessage(`consent.${p}.title`, lang),
          text: privacyMessage(`consent.${p}.text`, lang),
          current: r ? r.status === 'GIVEN' && r.notice_version === version : false,
          status: r?.status ?? 'NOT_GIVEN',
          status_notice_version: r?.notice_version ?? null,
        };
      }),
      missing_for_applications: await this.missingForSubmission(a.id),
      history: rows.map((r) => ({
        purpose: r.purpose,
        status: r.status,
        notice_version: r.notice_version,
        language: r.language,
        method: r.method,
        at: r.created_at.toISOString(),
      })),
    };
  }

  async recordConsent(
    actor: Actor,
    input: {
      purpose: string;
      status: 'GIVEN' | 'WITHDRAWN';
      notice_version: string;
      language: string;
    },
  ) {
    const a = await this.applicant(actor);
    const bad = (field: string, message: string) =>
      new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field, constraints: { invalid: message } }],
      });
    if (!this.config.consent.purposes.includes(input.purpose)) {
      throw bad('purpose', `one of ${this.config.consent.purposes.join(', ')}`);
    }
    if (input.status === 'GIVEN' && input.notice_version !== this.config.consent.noticeVersion) {
      throw bad(
        'notice_version',
        `consent is given to the current notice (${this.config.consent.noticeVersion})`,
      );
    }
    if (!this.config.languages.supported.includes(input.language)) {
      throw bad('language', `one of ${this.config.languages.supported.join(', ')}`);
    }
    const r = await this.db.client.consentRecord.create({
      data: {
        applicant_id: a.id,
        purpose: input.purpose,
        notice_version: input.notice_version,
        language: input.language,
        status: input.status,
        method: 'ONLINE_FORM',
        recorded_by_account_id: actor.accountId,
      },
      select: { id: true },
    });
    this.logger.info(
      { consentRecordId: r.id, purpose: input.purpose, status: input.status },
      'consent recorded',
    );
    return this.consents(actor);
  }

  // ---------------------------------------------------------------- access
  /**
   * The applicant's own data. Identifiers stay masked (as on every other
   * screen); there is no unmasking route. Excluded - not the applicant's
   * data, or investigation data whose disclosure would defeat it: officers'
   * internal remarks on decisions, fraud flags and match hashes, committee
   * reasons (an objection's reason reaches its owner as the grievance note),
   * officer identities, raw OCR text, audit and denial logs, and anything
   * about other people.
   */
  async dataExport(actor: Actor) {
    const a = await this.applicant(actor);
    const client = this.db.client;
    const profile = await this.applicants.me(actor);
    const apps = await client.application.findMany({
      where: { applicant_id: a.id },
      orderBy: { created_at: 'asc' },
      take: 200,
      select: {
        id: true,
        application_no: true,
        academic_year: true,
        current_stage: true,
        status: true,
        submitted_at: true,
        institution_name: true,
        institution_code: true,
        course_name: true,
        course_year: true,
        is_hosteller: true,
        jurisdiction_state: true,
        jurisdiction_district: true,
        scheme: { select: { code: true, name: true } },
        scheme_version: { select: { version_no: true } },
      },
    });
    const ids = apps.map((x) => x.id);
    const [documents, items, deficiencies, entries, grievances, disbursements, orders, renewals] =
      await Promise.all([
        client.document.findMany({
          where: { application_id: { in: ids } },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            application_id: true,
            document_type: true,
            file_name: true,
            mime_type: true,
            file_size_bytes: true,
            source: true,
            intake_status: true,
            verification_status: true,
            created_at: true,
          },
        }),
        client.deficiencyItem.findMany({
          where: { application_id: { in: ids } },
          select: {
            id: true,
            application_id: true,
            document_slot: true,
            problem_code: true,
            fix_code: true,
            status: true,
            deadline_at: true,
            created_at: true,
          },
        }),
        client.deficiency.findMany({
          where: { application_id: { in: ids } },
          select: {
            id: true,
            application_id: true,
            code: true,
            title: true,
            description: true,
            status: true,
            student_response: true,
            created_at: true,
          },
        }),
        client.selectionListEntry.findMany({
          where: { application_id: { in: ids }, selection_list: { status: { not: 'DRAFT' } } },
          select: {
            application_id: true,
            computed_outcome: true,
            computed_rank: true,
            final_outcome: true,
            selection_list: { select: { scheme_code: true, academic_year: true, status: true } },
          },
        }),
        client.grievance.findMany({
          where: { raised_by_applicant_id: a.id },
          select: {
            id: true,
            application_id: true,
            subject_type: true,
            description: true,
            status: true,
            resolution_note: true,
            created_at: true,
            resolved_at: true,
          },
        }),
        client.disbursement.findMany({
          where: { application_id: { in: ids } },
          select: {
            id: true,
            application_id: true,
            installment_no: true,
            academic_year: true,
            amount: true,
            currency: true,
            status: true,
            scheduled_date: true,
            disbursed_at: true,
          },
        }),
        client.sanctionOrder.findMany({
          where: { application_id: { in: ids } },
          select: { id: true, application_id: true, generated_at: true },
        }),
        client.renewal.findMany({
          where: { parent_application_id: { in: ids } },
          select: {
            id: true,
            parent_application_id: true,
            academic_year: true,
            academic_year_number: true,
            verification_status: true,
            created_at: true,
          },
        }),
      ]);
    const notifications = await client.notification.findMany({
      where: { recipient_account_id: actor.accountId },
      orderBy: { created_at: 'asc' },
      take: 1000,
      select: {
        id: true,
        channel: true,
        locale: true,
        subject: true,
        body: true,
        status: true,
        created_at: true,
        read_at: true,
      },
    });
    const consents = await this.consents(actor);
    const corrections = await this.corrections(actor);
    const erasure = await client.erasureRequest.findMany({
      where: { applicant_id: a.id },
      select: { id: true, status: true, created_at: true },
    });
    const aadhaar = await client.aadhaarAuthentication.findMany({
      where: { applicant_id: a.id },
      orderBy: { created_at: 'asc' },
      select: { outcome: true, error_code: true, uid_last4: true, created_at: true },
    });
    this.logger.info({ applicantId: a.id, applications: apps.length }, 'data export');
    return {
      generated_at: new Date().toISOString(),
      format: 'vidyasetu-personal-data-export/v1',
      masking: privacyMessage('privacy.export.masked', a.preferred_language),
      excluded:
        "Officers' internal remarks on decisions, fraud flags and match hashes, committee reasons, officer identities, raw OCR text, the audit and denial logs, and anything about other people: not your data, or investigation records.",
      profile,
      applications: apps.map((x) => ({
        ...x,
        scheme_code: x.scheme.code,
        scheme_name: x.scheme.name,
        scheme_version_no: x.scheme_version.version_no,
        scheme: undefined,
        scheme_version: undefined,
        documents: documents
          .filter((d) => d.application_id === x.id)
          .map((d) => ({ ...d, link: `/api/v1/documents/${d.id}` })),
        deficiency_items: items.filter((i) => i.application_id === x.id),
        deficiencies: deficiencies.filter((i) => i.application_id === x.id),
        list_outcomes: entries.filter((e) => e.application_id === x.id),
        disbursements: disbursements.filter((d) => d.application_id === x.id),
        sanction_orders: orders
          .filter((o) => o.application_id === x.id)
          .map((o) => ({ ...o, link: `/api/v1/sanction-orders/${o.id}/pdf` })),
        renewals: renewals.filter((r) => r.parent_application_id === x.id),
      })),
      grievances,
      notifications,
      consents: { current: consents.purposes, history: consents.history },
      correction_requests: corrections.requests,
      erasure_requests: erasure,
      aadhaar_authentications: aadhaar.map((r) => ({
        outcome: r.outcome,
        error_code: r.error_code,
        aadhaar_masked: `XXXX XXXX ${r.uid_last4}`,
        at: r.created_at,
      })),
    };
  }

  // ---------------------------------------------------------------- correction
  async fileCorrection(
    actor: Actor,
    input: {
      field: CorrectableField;
      value: string;
      reason: string;
      supporting_document_id?: string;
    },
  ) {
    const a = await this.applicant(actor);
    const problem = checkValue(input.field, input.value);
    if (problem) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'value', constraints: { invalid: `${input.field} ${problem}` } }],
      });
    }
    const reason = requireReason(input.reason, 'reason');
    if (input.supporting_document_id) {
      const doc = await this.db.client.document.findFirst({
        where: { id: input.supporting_document_id, application: { applicant_id: a.id } },
        select: { id: true },
      });
      if (!doc)
        throw new AppError(ErrorCode.NOT_FOUND, { details: { field: 'supporting_document_id' } });
    }
    const r = await this.db.client.correctionRequest.create({
      data: {
        applicant_id: a.id,
        field: input.field,
        requested_value_encrypted: bytes(encryptPII(input.value.trim())),
        reason,
        supporting_document_id: input.supporting_document_id ?? null,
        jurisdiction_state: a.domicile_state,
        jurisdiction_district: a.domicile_district,
      },
      select: { id: true },
    });
    this.logger.info({ correctionRequestId: r.id, field: input.field }, 'correction requested');
    return (await this.corrections(actor)).requests.find((x) => x.id === r.id);
  }

  private async requestViews(where: { applicant_id?: string; status?: string }) {
    const rows = await this.db.client.correctionRequest.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: 200,
    });
    const decisions = await this.db.client.correctionDecision.findMany({
      where: { request_id: { in: rows.map((r) => r.id) } },
      select: { request_id: true, decision: true, reason: true, created_at: true },
    });
    return rows.map((r) => {
      const d = decisions.find((x) => x.request_id === r.id);
      return {
        id: r.id,
        applicant_id: r.applicant_id,
        field: r.field,
        requested_value: decryptPII(r.requested_value_encrypted),
        reason: r.reason,
        supporting_document_id: r.supporting_document_id,
        status: r.status,
        jurisdiction_state: r.jurisdiction_state,
        jurisdiction_district: r.jurisdiction_district,
        created_at: r.created_at.toISOString(),
        decision: d
          ? { decision: d.decision, reason: d.reason, at: d.created_at.toISOString() }
          : null,
      };
    });
  }

  async corrections(actor: Actor) {
    const a = await this.applicant(actor);
    return { requests: await this.requestViews({ applicant_id: a.id }) };
  }

  /** The in-jurisdiction officer queue (RLS scopes it). */
  async correctionQueue(status: string | undefined) {
    return { requests: await this.requestViews(status ? { status } : {}) };
  }

  async decideCorrection(
    actor: Actor,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reasonIn: unknown,
  ) {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    const reason = requireReason(reasonIn, 'reason');
    const r = await this.db.client.correctionRequest.findFirst({ where: { id } });
    if (!r) throw new AppError(ErrorCode.NOT_FOUND);
    if (r.status !== 'OPEN') {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'already_decided', status: r.status },
      });
    }
    await this.db.client.correctionDecision.create({
      data: { request_id: r.id, officer_id: actor.officerId, decision, reason },
      select: { id: true },
    });
    await this.db.client.correctionRequest.update({
      where: { id: r.id },
      data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' },
    });
    if (decision === 'APPROVE') {
      await this.applicants.applyVerifiedCorrection(
        r.applicant_id,
        r.field as CorrectableField,
        decryptPII(r.requested_value_encrypted),
        actor.accountId,
      );
    }
    this.events.record(DOMAIN_EVENTS.CORRECTION_DECIDED, {
      applicant_id: r.applicant_id,
      correction_request_id: r.id,
      field: r.field,
      decision,
      reason,
      occurred_at: new Date().toISOString(),
    });
    this.logger.info({ correctionRequestId: r.id, decision }, 'correction decided');
    return (await this.requestViews({})).find((x) => x.id === r.id);
  }

  // ---------------------------------------------------------------- erasure
  async requestErasure(actor: Actor) {
    const a = await this.applicant(actor);
    const r = await this.db.client.erasureRequest.create({
      data: { applicant_id: a.id },
      select: { id: true, status: true, created_at: true },
    });
    this.logger.info({ erasureRequestId: r.id }, 'erasure requested');
    return {
      ...r,
      message_key: 'privacy.erasure.recorded',
      message: privacyMessage('privacy.erasure.recorded', a.preferred_language),
      deleted: false,
    };
  }

  async erasureRequests(actor: Actor) {
    const a = await this.applicant(actor);
    return {
      requests: await this.db.client.erasureRequest.findMany({
        where: { applicant_id: a.id },
        select: { id: true, status: true, created_at: true },
      }),
    };
  }
}
