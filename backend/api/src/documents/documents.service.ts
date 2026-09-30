import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../auth/actor';
import { RequestContext } from '../common/context/request-context';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { applicationRef, DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { decryptPII, encryptPII } from '../lib/crypto/pii';
import { MlClientService } from '../ml-client/ml-client.service';
import { deriveFormSchema } from '../schemes/form-schema';
import { StorageService } from '../storage/storage.service';
import { VIDYASETU_WORKFLOW, isStage } from '../workflow/vidyasetu-workflow';
import { DocumentPipelineQueue } from './document-pipeline.queue';
import {
  bytes,
  FieldReview,
  isSensitiveField,
  routeByConfidence,
  SENSITIVE_MARKER,
  splitSensitive,
  thresholdFor,
} from './review-routing';
import { DigiLockerAdapter } from '../integrations/digilocker/digilocker.adapter';
import { SystemActor } from '../workflow/system-actor';
import { DeficienciesService } from '../deficiencies/deficiencies.service';
import { canonicalTypeForSlot, isOptionalSlot } from './document-types';
import { officerAccepted, readiness, SlotResult, slotResult } from './document-readiness';
import { compareWithEligibility } from './eligibility-cross-check';
import { WorkflowService } from '../workflow/workflow.service';
import type { Readable } from 'node:stream';
import { portalMessage } from '../common/i18n/portal-messages';

const MOCK_NOTICE =
  'ML_MODE=mock: quality, classification, extraction and consistency results are documented mock fixtures, not real image analysis.';

/** Phase 17.2: the stored types GET /documents/:id/file serves (anything else: 415). */
export const SERVABLE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const DOCUMENT_SELECT = {
  id: true,
  application_id: true,
  document_type: true,
  file_name: true,
  mime_type: true,
  file_size_bytes: true,
  file_sha256: true,
  quality_usable: true,
  quality_result: true,
  intake_status: true,
  source: true,
  digilocker_reference: true,
  issuer: true,
  issuer_document_date: true,
  issuer_verified_at: true,
  verification_status: true,
  verified_by_officer_id: true,
  verified_at: true,
  created_at: true,
  extractions: {
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: 1,
    select: {
      id: true,
      status: true,
      error_code: true,
      classification_type: true,
      classification_confidence: true,
      classification_alternatives: true,
      classification_matches_slot: true,
      extracted_data: true,
      field_confidence: true,
      field_review: true,
      review_status: true,
      review_threshold: true,
      sensitive_values: true,
      eligibility_mismatches: true,
      corrected_fields: true,
      confirmed_by_officer_id: true,
      confirmed_at: true,
      extraction_engine: true,
      created_at: true,
    },
  },
} satisfies Prisma.DocumentSelect;

type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

export interface UploadInput {
  slot: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  return base.replace(/[^\w.\- ]/g, '_').slice(0, 200) || 'upload';
}

/**
 * Document upload, listing and officer confirmation. Every query goes
 * through DbContext (the Phase 2 actor transaction): jurisdiction scope and
 * RLS decide visibility (404 otherwise), and every write is audited with the
 * caller's identity.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbContext,
    private readonly storage: StorageService,
    private readonly ml: MlClientService,
    private readonly queue: DocumentPipelineQueue,
    private readonly config: AppConfigService,
    private readonly events: DomainEvents,
    private readonly digilocker: DigiLockerAdapter,
    private readonly systemActor: SystemActor,
    private readonly deficiencies: DeficienciesService,
    private readonly workflow: WorkflowService,
  ) {}

  private get mockMode(): boolean {
    return this.config.ml.mode === 'mock';
  }

  private async loadApplication(applicationId: string) {
    const app = await this.db.client.application.findFirst({
      where: { id: applicationId },
      select: {
        id: true,
        application_no: true,
        applicant_id: true,
        jurisdiction_state: true,
        jurisdiction_district: true,
        scheme_version_id: true,
        current_stage: true,
        needs_eligibility_review: true,
        document_consistency_status: true,
        document_consistency_details: true,
        document_consistency_checked_at: true,
        scheme_version: { select: { config: true } },
      },
    });
    if (!app) throw new AppError(ErrorCode.NOT_FOUND);
    return app;
  }

  /** Phase 3's derivation, reused as-is: the application's document slots. */
  private checklistFor(config: Prisma.JsonValue): string[] {
    return deriveFormSchema(config).documents.checklist;
  }

  /** Checks shared by every way of supplying a document for a checklist slot. */
  private async applicationForIntake(applicationId: string, slot: string) {
    const app = await this.loadApplication(applicationId);
    if (isStage(app.current_stage) && VIDYASETU_WORKFLOW.states[app.current_stage].terminal) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: { reason: 'application_closed', current_stage: app.current_stage },
      });
    }
    const checklist = this.checklistFor(app.scheme_version.config);
    if (!checklist.includes(slot)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'document_type',
            constraints: {
              requiredDocument: 'must be one of the scheme version’s required documents',
            },
          },
        ],
      });
    }
    // Phase 13C: while DEFECTIVE with open items, only the named documents.
    await this.deficiencies.assertUploadAllowed(app.id, app.current_stage, slot);
    return app;
  }

  async upload(applicationId: string, input: UploadInput) {
    const app = await this.applicationForIntake(applicationId, input.slot);

    // 1. Store (synchronous).
    const key = `applications/${app.id}/${randomUUID()}`;
    const stored = await this.storage.put(
      this.storage.documentsBucket,
      key,
      input.buffer,
      input.contentType,
    );

    // 2. Quality (synchronous).
    const quality = await this.ml.checkQuality(input.buffer);
    const usable = quality.value.usable;
    const document = await this.db.client.document.create({
      data: {
        application_id: app.id,
        document_type: input.slot,
        file_name: sanitizeFileName(input.fileName),
        file_path: key,
        file_size_bytes: stored.size,
        mime_type: stored.contentType,
        file_sha256: stored.sha256,
        quality_usable: usable,
        quality_result: { ...quality, engine: this.ml.engineLabel } as Prisma.InputJsonObject,
        intake_status: usable ? 'QUEUED' : 'QUALITY_REJECTED',
      },
      select: { id: true, created_at: true },
    });
    await this.deficiencies.markResubmitted(app.id, input.slot, document.id);

    const common = {
      document_id: document.id,
      document_type: input.slot,
      file_sha256: stored.sha256,
      uploaded_at: document.created_at.toISOString(),
      ml_mode: this.config.ml.mode,
      ...(this.mockMode ? { mock_notice: MOCK_NOTICE } : {}),
    };
    if (!usable) {
      // "Retake this": no classification, no extraction row. The event is
      // emitted after this request's transaction commits (DomainEvents).
      this.events.record(DOMAIN_EVENTS.DOCUMENT_QUALITY_REJECTED, {
        ...applicationRef(app),
        document_id: document.id,
        document_type: input.slot,
        issues: quality.value.issues,
        ml_engine: this.ml.engineLabel,
        occurred_at: document.created_at.toISOString(),
      });
      return {
        status: 'QUALITY_REJECTED' as const,
        ...common,
        quality: { usable: false, issues: quality.value.issues, confidence: quality.confidence },
      };
    }

    // 3. Queue classify -> extract -> (maybe) consistency.
    await this.queue.enqueue({
      documentId: document.id,
      applicationId: app.id,
      applicantId: app.applicant_id,
      applicationNo: app.application_no,
      jurisdictionState: app.jurisdiction_state,
      jurisdictionDistrict: app.jurisdiction_district,
      currentStage: app.current_stage,
      schemeVersionId: app.scheme_version_id,
      slot: input.slot,
      bucket: this.storage.documentsBucket,
      storageKey: key,
      requestId: RequestContext.requestId() ?? randomUUID(),
    });
    return {
      status: 'PROCESSING' as const,
      ...common,
      quality: { usable: true, issues: [], confidence: quality.confidence },
      poll: `/api/v1/documents/${document.id}`,
    };
  }

  /**
   * Phase 10: the applicant supplies a DigiLocker reference instead of a
   * file. The issuer's record replaces Phase 7's quality -> classify ->
   * extract pipeline (no ml call); everything downstream of extraction is
   * reused unchanged: the review routing, the sensitive-value storage, the
   * eligibility cross-check and - through an ordinary pipeline job, which
   * skips extraction for a document that already has one - the consistency
   * check. A failed verification is an actionable error, never a silent
   * fallback to "upload a file".
   */
  async uploadFromDigiLocker(applicationId: string, slot: string, reference: string) {
    const app = await this.applicationForIntake(applicationId, slot);
    const expectedType = canonicalTypeForSlot(slot);
    if (expectedType === null) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'digilocker_reference',
            constraints: {
              digilockerSlot:
                'this checklist item is not an issued document DigiLocker can verify; upload a scanned copy',
            },
          },
        ],
      });
    }

    const verification = await this.digilocker.verifyDocument(reference);
    if (verification.status === 'NOT_FOUND') {
      throw new AppError(ErrorCode.DIGILOCKER_DOCUMENT_NOT_FOUND, {
        details: {
          digilocker_reference: reference,
          next_step:
            'check the reference in DigiLocker "Issued Documents", or upload a scanned copy',
        },
      });
    }
    if (verification.status === 'CONSENT_NOT_GRANTED') {
      throw new AppError(ErrorCode.DIGILOCKER_CONSENT_REQUIRED, {
        details: {
          digilocker_reference: reference,
          issuer: verification.issuer,
          next_step: 'grant VIDYASETU access to this document in DigiLocker, then retry',
        },
      });
    }
    const doc = verification.document;
    if (doc.document_type !== expectedType) {
      throw new AppError(ErrorCode.DIGILOCKER_DOCUMENT_TYPE_MISMATCH, {
        details: {
          digilocker_reference: reference,
          expected_document_type: expectedType,
          digilocker_document_type: doc.document_type,
        },
      });
    }

    // The issued document itself is kept like any upload.
    const key = `applications/${app.id}/${randomUUID()}`;
    const stored = await this.storage.putIssued(
      this.storage.documentsBucket,
      key,
      doc.file.content,
      doc.file.mime_type,
    );
    const document = await this.db.client.document.create({
      data: {
        application_id: app.id,
        document_type: slot,
        file_name: sanitizeFileName(doc.file.name),
        file_path: key,
        file_size_bytes: stored.size,
        mime_type: stored.contentType,
        file_sha256: stored.sha256,
        source: 'DIGILOCKER',
        digilocker_reference: doc.reference,
        issuer: doc.issuer,
        issuer_document_date: new Date(`${doc.issued_at}T00:00:00.000Z`),
        issuer_verified_at: new Date(doc.verified_at),
      },
      select: { id: true, created_at: true },
    });
    await this.deficiencies.markResubmitted(app.id, slot, document.id);

    // Issuer data is exact: confidence 1.0 per field and for the type, then
    // Phase 7's own routing and storage rules.
    const confidence = Object.fromEntries(Object.keys(doc.data).map((k) => [k, 1]));
    const threshold = thresholdFor(this.config.documents.reviewThresholds, slot);
    const routing = routeByConfidence(
      confidence,
      threshold,
      { type: doc.document_type, confidence: 1 },
      expectedType,
    );
    const { stored: storedData, sensitive } = splitSensitive(doc.data);
    const mismatches = await compareWithEligibility(
      this.db.client,
      { applicationId: app.id, applicantId: app.applicant_id },
      doc.data,
      confidence,
      this.config.documents.valueTolerance,
    );

    // Written as the SYSTEM actor, like every pipeline extraction (same
    // transaction; Phase 4's SystemActor switch).
    const extractionId = await this.systemActor.run(async () => {
      const row = await this.db.client.documentExtraction.create({
        data: {
          document_id: document.id,
          application_id: app.id,
          document_slot: slot,
          status: 'COMPLETED',
          classification_type: doc.document_type,
          classification_confidence: 1,
          classification_alternatives: [],
          classification_matches_slot: true,
          extracted_data: storedData as Prisma.InputJsonObject,
          field_confidence: confidence,
          field_review: routing.field_review,
          review_status: routing.review_status,
          review_threshold: threshold,
          sensitive_values:
            Object.keys(sensitive).length > 0 ? bytes(encryptPII(JSON.stringify(sensitive))) : null,
          raw_text_encrypted: bytes(encryptPII(doc.file.content.toString('utf8'))),
          eligibility_mismatches: mismatches.length > 0 ? mismatches : Prisma.DbNull,
          confidence_score: routing.lowest_confidence,
          extraction_engine: 'DIGILOCKER',
          is_verified: routing.review_status === 'AUTO_ACCEPTED',
        },
        select: { id: true },
      });
      if (mismatches.length > 0) {
        await this.db.client.$queryRaw`SELECT document_system_flag_application(
          ${app.id}::uuid, true, ${null}::text, ${null}::jsonb, ${null}::timestamptz) AS updated`;
      }
      return row.id;
    });
    if (mismatches.length > 0) {
      this.events.record(DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH, {
        ...applicationRef(app),
        current_stage: app.current_stage,
        document_id: document.id,
        extraction_id: extractionId,
        fields: mismatches,
        occurred_at: document.created_at.toISOString(),
      });
    }

    // Consistency: an ordinary pipeline job. The (unchanged) processor finds
    // this document's COMPLETED extraction, skips classify / extract - no ml
    // call - and runs only its consistency step.
    await this.queue.enqueue({
      documentId: document.id,
      applicationId: app.id,
      applicantId: app.applicant_id,
      applicationNo: app.application_no,
      jurisdictionState: app.jurisdiction_state,
      jurisdictionDistrict: app.jurisdiction_district,
      currentStage: app.current_stage,
      schemeVersionId: app.scheme_version_id,
      slot,
      bucket: this.storage.documentsBucket,
      storageKey: key,
      requestId: RequestContext.requestId() ?? randomUUID(),
    });

    return {
      status: 'DIGILOCKER_VERIFIED' as const,
      document_id: document.id,
      document_type: slot,
      source: 'DIGILOCKER' as const,
      digilocker: {
        reference: doc.reference,
        issuer: doc.issuer,
        document_type: doc.document_type,
        issued_on: doc.issued_at,
        verified_at: doc.verified_at,
      },
      digilocker_mode: (await this.digilocker.checkAvailability()).mode,
      file_sha256: stored.sha256,
      uploaded_at: document.created_at.toISOString(),
      review_status: routing.review_status,
      fields: Object.keys(doc.data).sort(),
      eligibility_mismatches: mismatches.map((m) => m.field),
      poll: `/api/v1/documents/${document.id}`,
    };
  }

  /** Every document of the application, each slot's latest one with its result, and readiness. */
  private async documentState(app: Awaited<ReturnType<DocumentsService['loadApplication']>>) {
    const checklist = this.checklistFor(app.scheme_version.config);
    const rows = await this.db.client.document.findMany({
      where: { application_id: app.id },
      select: DOCUMENT_SELECT,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    const views = rows.map((r) => this.view(r));
    const accepted = officerAccepted(app.current_stage);
    const results: Record<string, SlotResult> = {};
    const processedAt: Record<string, string | null> = {};
    const slots = checklist.map((slot) => {
      const ofSlot = views.filter((v) => v.document_type === slot);
      const latest = ofSlot.at(-1);
      results[slot] = slotResult(slot, latest ?? null, accepted);
      // As the pipeline's consistency step counts it: the slot's latest completed extraction.
      const done = ofSlot.filter((v) => v.extraction?.status === 'COMPLETED');
      processedAt[slot] = done.at(-1)?.extraction?.processed_at ?? null;
      return {
        slot,
        optional: isOptionalSlot(slot),
        document_id: latest?.document_id ?? null,
        state: latest?.state ?? 'MISSING',
        outcome: results[slot].outcome,
        reasons: results[slot].reasons,
      };
    });
    const ready = readiness(
      checklist,
      results,
      processedAt,
      { status: app.document_consistency_status, checked_at: app.document_consistency_checked_at },
      new Date(),
    );
    return { checklist, views, slots, readiness: ready };
  }

  async list(applicationId: string) {
    const app = await this.loadApplication(applicationId);
    const { checklist, views, slots, readiness: ready } = await this.documentState(app);
    return {
      application_id: app.id,
      current_stage: app.current_stage,
      ml_mode: this.config.ml.mode,
      ...(this.mockMode ? { mock_notice: MOCK_NOTICE } : {}),
      flags: {
        needs_eligibility_review: app.needs_eligibility_review,
        document_consistency_status: app.document_consistency_status,
        document_consistency_details: app.document_consistency_details,
        document_consistency_checked_at: app.document_consistency_checked_at,
      },
      checklist,
      slots,
      readiness: ready,
      documents: views,
    };
  }

  /**
   * The applicant's "documents are in" step, called by the portal after each
   * scan settles; idempotent. An application submitted to await its
   * documents (SUBMITTED) moves on once nothing is left to upload or scan:
   * the workflow's own automatic eligibility gate runs, as the applicant,
   * exactly as on a normal submission. All documents verified: the gate's
   * usual route (INO_VERIFIED, the institute queue). Any document needing
   * attention: the gate's manual-review route (INO_VERIFIED with
   * needs_eligibility_review) - an officer checks it before it can go on.
   * The gate's evaluation did not exist when the documents were scanned, so
   * the eligibility cross-check the pipeline skipped is run here, after it.
   * Any other stage: nothing to do (the stage and readiness are returned).
   */
  async complete(applicationId: string) {
    const app = await this.loadApplication(applicationId);
    const state = await this.documentState(app);
    if (app.current_stage !== 'SUBMITTED' || !state.readiness.ready) {
      return {
        application_id: app.id,
        advanced: false,
        current_stage: app.current_stage,
        readiness: state.readiness,
        eligibility_gate: null,
      };
    }

    // The declared answers the applicant submitted: kept on the frozen draft (owner-only).
    const draft = await this.db.client.applicationDraft.findFirst({
      where: { submitted_application_id: app.id },
      select: { declared: true },
    });
    const review = [...state.readiness.attention_slots];
    if (!state.readiness.verified && review.length === 0) review.push('document_consistency');
    const gate = await this.workflow.runAutomatic(app.id, draft?.declared ?? {}, review);
    if (gate && gate.routed_to !== 'DEFECTIVE') {
      await this.crossCheckAfterGate(app, gate.routed_to, state.views);
    }

    const after = await this.loadApplication(app.id);
    return {
      application_id: app.id,
      advanced: gate !== null,
      current_stage: after.current_stage,
      needs_eligibility_review: after.needs_eligibility_review,
      readiness: (await this.documentState(after)).readiness,
      eligibility_gate: gate,
    };
  }

  /**
   * Phase 7's eligibility cross-check (compareWithEligibility, unchanged) for
   * each slot's latest completed extraction, against the evaluation the gate
   * has just recorded; written as the pipeline would (SYSTEM actor).
   */
  private async crossCheckAfterGate(
    app: Awaited<ReturnType<DocumentsService['loadApplication']>>,
    stage: string,
    views: ReturnType<DocumentsService['view']>[],
  ) {
    const latest = new Map<string, ReturnType<DocumentsService['view']>>();
    for (const v of views) if (v.extraction?.status === 'COMPLETED') latest.set(v.document_type, v);
    for (const v of latest.values()) {
      const ext = v.extraction;
      const extracted = Object.fromEntries(ext.fields.map((f) => [f.name, f.value]));
      const confidence = Object.fromEntries(ext.fields.map((f) => [f.name, f.confidence ?? 0]));
      const mismatches = await compareWithEligibility(
        this.db.client,
        { applicationId: app.id, applicantId: app.applicant_id },
        extracted,
        confidence,
        this.config.documents.valueTolerance,
      );
      if (mismatches.length === 0) continue;
      await this.systemActor.run(async () => {
        // Raw SQL: the Prisma jurisdiction extension would scope this update by the
        // requesting applicant, whose applications RLS hides from the SYSTEM actor.
        await this.db.client.$executeRaw`UPDATE "document_extractions"
          SET "eligibility_mismatches" = ${JSON.stringify(mismatches)}::jsonb
          WHERE "id" = ${ext.id}::uuid`;
        await this.db.client.$queryRaw`SELECT document_system_flag_application(
          ${app.id}::uuid, true, ${null}::text, ${null}::jsonb, ${null}::timestamptz) AS updated`;
      });
      this.events.record(DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH, {
        ...applicationRef(app),
        current_stage: stage,
        document_id: v.document_id,
        extraction_id: ext.id,
        fields: mismatches,
        occurred_at: new Date().toISOString(),
      });
    }
  }

  async get(documentId: string) {
    const row = await this.db.client.document.findFirst({
      where: { id: documentId },
      select: DOCUMENT_SELECT,
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      ml_mode: this.config.ml.mode,
      ...(this.mockMode ? { mock_notice: MOCK_NOTICE } : {}),
      ...this.view(row),
    };
  }

  /**
   * Phase 17.2: the stored file of a document, as a stream. Visibility is the
   * same as get(): the lookup runs in the caller's actor transaction, so RLS on
   * documents decides (owner, officers in jurisdiction); anything else is 404.
   * Only image types a browser renders safely and PDF are served; any other
   * stored type is refused with 415 (details.message_key for the portal).
   */
  async file(documentId: string): Promise<{ stream: Readable; mime_type: string; id: string }> {
    const row = await this.db.client.document.findFirst({
      where: { id: documentId },
      select: { id: true, mime_type: true, file_path: true },
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    // A DigiLocker-verified document has no stored file: nothing to serve.
    if (!row.file_path || !row.mime_type) {
      throw new AppError(ErrorCode.NOT_FOUND, { details: { reason: 'no_stored_file' } });
    }
    if (!SERVABLE_MIME_TYPES.has(row.mime_type)) {
      throw new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, {
        message: portalMessage('document.file.unsupported_type', 'en'),
        details: {
          reason: 'document_type_not_served',
          message_key: 'document.file.unsupported_type',
          allowed: [...SERVABLE_MIME_TYPES],
        },
      });
    }
    const stream = await this.storage.getStream(this.storage.documentsBucket, row.file_path);
    return { stream, mime_type: row.mime_type, id: row.id };
  }

  /**
   * An officer confirms a NEEDS_REVIEW extraction, optionally correcting
   * field values. Audited (document_extractions and documents triggers) with
   * the officer's identity from the actor transaction.
   */
  async confirm(
    actor: Actor,
    documentId: string,
    corrections: Record<string, string | number | boolean>,
    remarks: string | undefined,
  ) {
    if (!actor.officerId) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: 'no_officer_profile' } });
    }
    const client = this.db.client;
    const row = await client.document.findFirst({
      where: { id: documentId },
      select: DOCUMENT_SELECT,
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const ext = row.extractions[0];
    if (!ext || ext.status !== 'COMPLETED' || ext.review_status !== 'NEEDS_REVIEW') {
      throw new AppError(ErrorCode.CONFLICT, {
        message: 'Only a completed extraction that needs review can be confirmed.',
        details: { reason: 'not_awaiting_review', review_status: ext?.review_status ?? null },
      });
    }

    const stored = { ...(ext.extracted_data as Record<string, unknown>) };
    const unknown = Object.keys(corrections).filter(
      (k) => !Object.prototype.hasOwnProperty.call(stored, k),
    );
    if (unknown.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: unknown.map((k) => ({
          field: `corrections.${k}`,
          constraints: { knownField: 'not a field of this extraction' },
        })),
      });
    }

    const sensitive = ext.sensitive_values
      ? (JSON.parse(decryptPII(ext.sensitive_values)) as Record<string, unknown>)
      : {};
    for (const [k, v] of Object.entries(corrections)) {
      if (isSensitiveField(k)) {
        sensitive[k] = v;
        stored[k] = SENSITIVE_MARKER;
      } else {
        stored[k] = v;
      }
    }
    const review = { ...(ext.field_review as Record<string, FieldReview>) };
    for (const k of Object.keys(review)) {
      if (review[k] === 'NEEDS_REVIEW' || k in corrections) review[k] = 'OFFICER_CONFIRMED';
    }
    const now = new Date();

    await client.documentExtraction.update({
      where: { id: ext.id },
      data: {
        extracted_data: stored as Prisma.InputJsonObject,
        sensitive_values:
          Object.keys(sensitive).length > 0 ? bytes(encryptPII(JSON.stringify(sensitive))) : null,
        field_review: review,
        review_status: 'OFFICER_CONFIRMED',
        corrected_fields: Object.keys(corrections).sort(),
        // Phase 13B: the officer's reason (required when a value is corrected).
        confirmation_reason: remarks ?? null,
        confirmed_by_officer_id: actor.officerId,
        confirmed_at: now,
        is_verified: true,
      },
    });
    await client.document.update({
      where: { id: row.id },
      data: {
        verification_status: 'VERIFIED',
        verified_by_officer_id: actor.officerId,
        verified_at: now,
      },
    });
    return { ...(await this.get(documentId)), remarks: remarks ?? null };
  }

  private view(row: DocumentRow) {
    const ext = row.extractions[0] ?? null;
    const fromDigiLocker = row.source === 'DIGILOCKER';
    const state =
      row.intake_status === 'QUALITY_REJECTED'
        ? 'QUALITY_REJECTED'
        : !ext
          ? 'PROCESSING'
          : ext.status === 'FAILED'
            ? 'FAILED'
            : (ext.review_status ?? 'COMPLETED');
    const quality = row.quality_result as {
      value?: { issues?: string[] };
      confidence?: number;
    } | null;

    let fields: Array<{
      name: string;
      value: unknown;
      confidence: number | null;
      review: FieldReview | null;
      sensitive: boolean;
      corrected: boolean;
    }> = [];
    if (ext && ext.status === 'COMPLETED') {
      // Live response only: sensitive values are decrypted for this
      // authorised caller; at rest they stay encrypted (never as text).
      const sensitive = ext.sensitive_values
        ? (JSON.parse(decryptPII(ext.sensitive_values)) as Record<string, unknown>)
        : {};
      const data = ext.extracted_data as Record<string, unknown>;
      const conf = ext.field_confidence as Record<string, number>;
      const review = ext.field_review as Record<string, FieldReview>;
      const corrected = new Set((ext.corrected_fields as string[] | null) ?? []);
      fields = Object.keys(data)
        .sort()
        .map((name) => ({
          name,
          value: isSensitiveField(name) ? (sensitive[name] ?? null) : data[name],
          confidence: conf[name] ?? null,
          review: review[name] ?? null,
          sensitive: isSensitiveField(name),
          corrected: corrected.has(name),
        }));
    }

    return {
      document_id: row.id,
      application_id: row.application_id,
      document_type: row.document_type,
      file_name: row.file_name,
      mime_type: row.mime_type,
      file_size_bytes: row.file_size_bytes,
      file_sha256: row.file_sha256,
      uploaded_at: row.created_at.toISOString(),
      state,
      // UPLOAD: a file read by the OCR pipeline. DIGILOCKER: the issuer's own
      // record (no OCR, no quality check) - a review screen must tell these apart.
      source: row.source,
      digilocker: fromDigiLocker
        ? {
            reference: row.digilocker_reference,
            issuer: row.issuer,
            issued_on: row.issuer_document_date?.toISOString().slice(0, 10) ?? null,
            verified_at: row.issuer_verified_at?.toISOString() ?? null,
          }
        : null,
      quality: fromDigiLocker
        ? null
        : {
            usable: row.quality_usable,
            issues: quality?.value?.issues ?? [],
            confidence: quality?.confidence ?? null,
          },
      verification_status: row.verification_status,
      extraction: ext && {
        id: ext.id,
        status: ext.status,
        error_code: ext.error_code,
        engine: ext.extraction_engine,
        classification: {
          type: ext.classification_type,
          confidence: ext.classification_confidence,
          alternatives: ext.classification_alternatives,
          matches_slot: ext.classification_matches_slot,
        },
        review_status: ext.review_status,
        review_threshold: ext.review_threshold,
        fields,
        eligibility_mismatches: ext.eligibility_mismatches,
        confirmed_by_officer_id: ext.confirmed_by_officer_id,
        confirmed_at: ext.confirmed_at?.toISOString() ?? null,
        processed_at: ext.created_at.toISOString(),
      },
    };
  }
}
