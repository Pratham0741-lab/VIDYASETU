-- ============================================================================
-- Phase 10: DigiLocker-verified documents.
--
-- A document is either UPLOADED (a file that went through Phase 7's quality
-- -> classify -> extract pipeline) or DIGILOCKER-verified (the issuer's own
-- record, fetched with the applicant's consent; no OCR). The distinction is
-- recorded on the row so any review screen can show it. Additive only: every
-- existing row is an UPLOAD; no existing column, constraint, RLS policy or
-- trigger changes (the documents audit trigger records the new columns).
--
-- For a DIGILOCKER document the file columns hold the issued document
-- DigiLocker returned (the issuer's XML), stored like any upload.
-- ============================================================================

ALTER TABLE "documents"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "digilocker_reference" TEXT,
  ADD COLUMN "issuer" TEXT,
  ADD COLUMN "issuer_document_date" DATE,
  ADD COLUMN "issuer_verified_at" TIMESTAMPTZ(6);

ALTER TABLE "documents" ADD CONSTRAINT "documents_source_check"
  CHECK ("source" IN ('UPLOAD', 'DIGILOCKER'));

-- DigiLocker provenance is all-or-nothing, and only on DigiLocker rows.
ALTER TABLE "documents" ADD CONSTRAINT "documents_digilocker_provenance_check"
  CHECK (
    ("source" = 'DIGILOCKER')
      = ("digilocker_reference" IS NOT NULL AND "issuer" IS NOT NULL AND "issuer_verified_at" IS NOT NULL)
  );

CREATE INDEX "documents_digilocker_reference_idx" ON "documents"("digilocker_reference");
