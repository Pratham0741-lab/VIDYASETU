import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError } from '../common/errors/app-error';
import { AppConfigService } from '../config/app-config.service';
import { DbContext } from '../database/db-context';
import { ApplicationRef, DOMAIN_EVENTS } from '../events/domain-events';
import { DomainEvents } from '../events/domain-events.service';
import { encryptPII } from '../lib/crypto/pii';
import { bytes } from './review-routing';
import { MlClientService } from '../ml-client/ml-client.service';
import { deriveFormSchema } from '../schemes/form-schema';
import { StorageService } from '../storage/storage.service';
import {
  consistencyStatus,
  routeByConfidence,
  splitSensitive,
  thresholdFor,
} from './review-routing';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { canonicalTypeForSlot, slotForClassified } from './document-types';
import { compareWithEligibility, EligibilityMismatch } from './eligibility-cross-check';

/** Everything the worker needs; it runs as SYSTEM and cannot read RLS-protected rows. */
export interface PipelineJob {
  documentId: string;
  applicationId: string;
  applicantId: string;
  /** Carried for domain events: the worker cannot read the application row. */
  applicationNo: string;
  jurisdictionState: string;
  jurisdictionDistrict: string | null;
  /** Stage at upload time, for routing officer notifications. */
  currentStage: string;
  schemeVersionId: string;
  slot: string;
  bucket: string;
  storageKey: string;
  requestId: string;
}

function jobApplicationRef(job: PipelineJob): ApplicationRef {
  return {
    application_id: job.applicationId,
    application_no: job.applicationNo,
    applicant_id: job.applicantId,
    jurisdiction_state: job.jurisdictionState,
    jurisdiction_district: job.jurisdictionDistrict,
  };
}

/**
 * The background half of the upload pipeline. Reads use db.client, which
 * outside any request is the actorless base client: fine for the
 * unprotected tables read here (document_extractions, workflow_transitions,
 * rule_evaluations, applicants, scheme_versions); RLS-protected rows are
 * never read. ML calls happen outside any
 * transaction; each write happens in a short SYSTEM transaction
 * (SystemTransactionRunner). It never changes an application's stage: its
 * only write to applications is document_system_flag_application(), which
 * can raise needs_eligibility_review and record the consistency flag.
 */
@Injectable()
export class DocumentPipelineProcessor {
  constructor(
    private readonly db: DbContext,
    private readonly storage: StorageService,
    private readonly ml: MlClientService,
    private readonly system: SystemTransactionRunner,
    private readonly config: AppConfigService,
    private readonly events: DomainEvents,
    @InjectPinoLogger(DocumentPipelineProcessor.name) private readonly logger: PinoLogger,
  ) {}

  async process(job: PipelineJob, run: { attempt: number; finalAttempt: boolean }): Promise<void> {
    const done = await this.db.client.documentExtraction.findFirst({
      where: { document_id: job.documentId, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { id: true },
    });
    if (!done) {
      const completed = await this.classifyAndExtract(job, run.finalAttempt);
      if (!completed) return;
    }
    await this.maybeCheckConsistency(job);
  }

  /** Returns false when the run was recorded as FAILED. */
  private async classifyAndExtract(job: PipelineJob, finalAttempt: boolean): Promise<boolean> {
    const expectedType = canonicalTypeForSlot(job.slot);
    let classification: Awaited<ReturnType<MlClientService['classifyDocument']>>;
    let extraction: Awaited<ReturnType<MlClientService['extractFields']>>;
    let movedTo: string | null = null;
    try {
      const image = await this.storage.get(job.bucket, job.storageKey);
      classification = await this.ml.classifyDocument(image);
      // Uploaded to the wrong row (content confidently another type that has
      // its own row): read it as what it is; the checklist shows it there.
      movedTo = slotForClassified(
        job.slot,
        { type: classification.value, confidence: classification.confidence },
        await this.checklistOf(job.schemeVersionId),
      );
      extraction = await this.ml.extractFields(
        image,
        movedTo ? canonicalTypeForSlot(movedTo) : expectedType,
      );
    } catch (err) {
      if (!finalAttempt) throw err;
      const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
      await this.system.run(job.requestId, () =>
        this.db.client.documentExtraction.create({
          data: {
            document_id: job.documentId,
            application_id: job.applicationId,
            document_slot: job.slot,
            status: 'FAILED',
            error_code: code,
            extracted_data: {},
            extraction_engine: this.ml.engineLabel,
          },
        }),
      );
      this.logger.error({ err, documentId: job.documentId }, 'document pipeline gave up');
      return false;
    }

    const threshold = thresholdFor(this.config.documents.reviewThresholds, movedTo ?? job.slot);
    const routing = routeByConfidence(
      extraction.confidence,
      threshold,
      { type: classification.value, confidence: classification.confidence },
      movedTo ? canonicalTypeForSlot(movedTo) : expectedType,
    );
    const { stored, sensitive } = splitSensitive(extraction.value);
    const mismatches = await this.compareWithEligibility(
      job,
      extraction.value,
      extraction.confidence,
    );

    const extractionId = await this.system.run(job.requestId, async () => {
      const client = this.db.client;
      const row = await client.documentExtraction.create({
        data: {
          document_id: job.documentId,
          application_id: job.applicationId,
          document_slot: job.slot,
          status: 'COMPLETED',
          classification_type: classification.value,
          classification_confidence: classification.confidence,
          classification_alternatives: classification.alternatives,
          classification_matches_slot:
            expectedType !== null && classification.value === expectedType,
          extracted_data: stored as Prisma.InputJsonObject,
          field_confidence: extraction.confidence,
          field_review: routing.field_review,
          review_status: routing.review_status,
          review_threshold: threshold,
          sensitive_values:
            Object.keys(sensitive).length > 0 ? bytes(encryptPII(JSON.stringify(sensitive))) : null,
          raw_text_encrypted: bytes(encryptPII(extraction.raw_text)),
          eligibility_mismatches: mismatches.length > 0 ? mismatches : Prisma.DbNull,
          confidence_score: routing.lowest_confidence,
          extraction_engine: this.ml.engineLabel,
          is_verified: routing.review_status === 'AUTO_ACCEPTED',
          // Phase 13D: where each field was read (ml service only; mock: none).
          field_boxes: extraction.boxes
            ? (extraction.boxes as unknown as Prisma.InputJsonObject)
            : Prisma.DbNull,
        },
        select: { id: true },
      });
      if (mismatches.length > 0) {
        // Phase 4's flag, raised through the SYSTEM-only function; never a stage change.
        await client.$queryRaw`SELECT document_system_flag_application(
          ${job.applicationId}::uuid, true, ${null}::text, ${null}::jsonb, ${null}::timestamptz) AS updated`;
      }
      return row.id;
    });

    // The SYSTEM transaction has committed: emit (no request buffer here).
    const occurred_at = new Date().toISOString();
    if (routing.review_status === 'NEEDS_REVIEW') {
      this.events.record(DOMAIN_EVENTS.DOCUMENT_NEEDS_REVIEW, {
        ...jobApplicationRef(job),
        current_stage: job.currentStage,
        document_id: job.documentId,
        extraction_id: extractionId,
        document_slot: job.slot,
        fields_needing_review: Object.keys(routing.field_review).filter(
          (k) => routing.field_review[k] === 'NEEDS_REVIEW',
        ),
        reasons: routing.reasons,
        ml_engine: this.ml.engineLabel,
        occurred_at,
      });
    }
    if (mismatches.length > 0) {
      this.events.record(DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH, {
        ...jobApplicationRef(job),
        current_stage: job.currentStage,
        document_id: job.documentId,
        extraction_id: extractionId,
        fields: mismatches,
        occurred_at,
      });
    }
    return true;
  }

  /** The application's checklist (Phase 3's derivation) from its scheme version. */
  private async checklistOf(schemeVersionId: string): Promise<string[]> {
    const version = await this.db.client.schemeVersion.findUnique({
      where: { id: schemeVersionId },
      select: { config: true },
    });
    return version ? deriveFormSchema(version.config).documents.checklist : [];
  }

  /** Phase 7's eligibility cross-check (moved unchanged to eligibility-cross-check.ts). */
  private compareWithEligibility(
    job: PipelineJob,
    extracted: Readonly<Record<string, unknown>>,
    confidence: Readonly<Record<string, number>>,
  ): Promise<EligibilityMismatch[]> {
    return compareWithEligibility(
      this.db.client,
      { applicationId: job.applicationId, applicantId: job.applicantId },
      extracted,
      confidence,
      this.config.documents.valueTolerance,
    );
  }

  /**
   * Once every checklist slot (Phase 3's derivation) has a completed
   * extraction, ask for cross-document consistency and record the flag.
   * Only non-sensitive extracted values are sent.
   */
  private async maybeCheckConsistency(job: PipelineJob): Promise<void> {
    const version = await this.db.client.schemeVersion.findUnique({
      where: { id: job.schemeVersionId },
      select: { config: true },
    });
    if (!version) return;
    const checklist = deriveFormSchema(version.config).documents.checklist;
    const rows = await this.db.client.documentExtraction.findMany({
      where: { application_id: job.applicationId, status: 'COMPLETED' },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      select: { document_slot: true, extracted_data: true },
    });
    const latest = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      if (!latest.has(r.document_slot)) {
        latest.set(r.document_slot, r.extracted_data as Record<string, unknown>);
      }
    }
    if (!checklist.every((slot) => latest.has(slot))) return;

    const inputs = checklist.map((slot) => {
      const plain = Object.fromEntries(
        Object.entries(latest.get(slot)!).filter(
          ([, v]) => !(typeof v === 'object' && v !== null && 'redacted' in v),
        ),
      );
      return { document_slot: slot, ...plain };
    });
    const result = await this.ml.checkConsistency(inputs);
    const status = consistencyStatus(
      result.value,
      result.confidence,
      this.config.documents.consistencyMinConfidence,
    );
    const details = {
      checks: result.value,
      confidence: result.confidence,
      documents_compared: inputs.length,
      engine: this.ml.engineLabel,
      min_confidence: this.config.documents.consistencyMinConfidence,
    };
    await this.system.run(
      job.requestId,
      () =>
        this.db.client.$queryRaw`SELECT document_system_flag_application(
        ${job.applicationId}::uuid, false, ${status}::text, ${JSON.stringify(details)}::jsonb, ${new Date()}::timestamptz) AS updated`,
    );
    this.logger.info({ applicationId: job.applicationId, status }, 'document consistency recorded');
    this.events.record(DOMAIN_EVENTS.DOCUMENT_CONSISTENCY_EVALUATED, {
      ...jobApplicationRef(job),
      current_stage: job.currentStage,
      status,
      checks: result.value,
      confidence: result.confidence,
      documents_compared: inputs.length,
      ml_engine: this.ml.engineLabel,
      occurred_at: new Date().toISOString(),
    });
  }
}
