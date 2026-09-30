from pathlib import Path

p = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/src/documents/documents.service.ts')
s = p.read_text(encoding='utf8')


def rep(old, new):
    global s
    assert s.count(old) == 1, old[:80]
    s = s.replace(old, new)


# imports
rep("import { bytes, FieldReview, isSensitiveField, SENSITIVE_MARKER } from './review-routing';",
    """import {
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
import { canonicalTypeForSlot } from './document-types';
import { compareWithEligibility } from './eligibility-cross-check';""")

# select: provenance columns
rep("""  intake_status: true,
  verification_status: true,""", """  intake_status: true,
  source: true,
  digilocker_reference: true,
  issuer: true,
  issuer_document_date: true,
  issuer_verified_at: true,
  verification_status: true,""")

# constructor
rep("""    private readonly events: DomainEvents,
  ) {}""", """    private readonly events: DomainEvents,
    private readonly digilocker: DigiLockerAdapter,
    private readonly systemActor: SystemActor,
  ) {}""")

# shared pre-checks
rep("""  async upload(applicationId: string, input: UploadInput) {
    const app = await this.loadApplication(applicationId);
    if (isStage(app.current_stage) && VIDYASETU_WORKFLOW.states[app.current_stage].terminal) {""",
    """  /** Checks shared by every way of supplying a document for a checklist slot. */
  private async applicationForIntake(applicationId: string, slot: string) {
    const app = await this.loadApplication(applicationId);
    if (isStage(app.current_stage) && VIDYASETU_WORKFLOW.states[app.current_stage].terminal) {""")
rep("""    const checklist = this.checklistFor(app.scheme_version.config);
    if (!checklist.includes(input.slot)) {""", """    const checklist = this.checklistFor(app.scheme_version.config);
    if (!checklist.includes(slot)) {""")
rep("""        ],
      });
    }

    // 1. Store (synchronous).""", """        ],
      });
    }
    return app;
  }

  async upload(applicationId: string, input: UploadInput) {
    const app = await this.applicationForIntake(applicationId, input.slot);

    // 1. Store (synchronous).""")

# the DigiLocker method, before list()
rep("""  async list(applicationId: string) {""", r"""  /**
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
          next_step: 'check the reference in DigiLocker "Issued Documents", or upload a scanned copy',
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
    const stored = await this.storage.put(
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

  async list(applicationId: string) {""")

# view: provenance
rep("""    const state =
      row.intake_status === 'QUALITY_REJECTED'""", """    const fromDigiLocker = row.source === 'DIGILOCKER';
    const state =
      row.intake_status === 'QUALITY_REJECTED'""")
rep("""      uploaded_at: row.created_at.toISOString(),
      state,
      quality: {
        usable: row.quality_usable,
        issues: quality?.value?.issues ?? [],
        confidence: quality?.confidence ?? null,
      },""", """      uploaded_at: row.created_at.toISOString(),
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
          },""")

p.write_text(s, encoding='utf8', newline='\n')
print('edited', p)
