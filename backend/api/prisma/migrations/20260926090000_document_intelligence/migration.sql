-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926090000_document_intelligence
--
-- Phase 7 (document intelligence). No existing migration, RLS policy or audit
-- function is changed.
--
-- 1. documents: upload facts written in the applicant's own request (RLS and
--    audit already apply): content hash and the synchronous quality check.
--    The upload timestamp is the existing created_at.
-- 2. document_extractions: one row per completed (or failed) processing run,
--    written by the background worker as the SYSTEM actor. Classification,
--    PER-FIELD confidence and review status, the officer confirmation, and
--    the application_id / document_slot the worker needs (it runs as SYSTEM,
--    so it cannot read the RLS-protected documents / applications rows).
--    Sensitive extracted values (the Phase 3 sensitive-field list) are never
--    stored as text: extracted_data holds a redaction marker and the value is
--    in sensitive_values, AES-256-GCM encrypted with the existing PII key, as
--    is the raw OCR text. The table gains the existing audit trigger so SYSTEM
--    writes and officer confirmations are audited (it had none: Phase 3
--    classed it as raw data, which it no longer is once officers act on it).
-- 3. applications: the document-consistency flag officers query. It never
--    changes current_stage; only Phase 4's officer endpoints do that.
-- 4. document_system_flag_application(): the worker's only write to
--    applications (RLS admits no actorless UPDATE), limited to raising
--    needs_eligibility_review and recording the consistency flag.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "document_extractions") THEN
    RAISE EXCEPTION 'document_extractions is not empty: backfill application_id / document_slot / status by hand first';
  END IF;
END $$;

-- 1. documents.
ALTER TABLE "documents"
  ADD COLUMN "file_sha256" TEXT,
  ADD COLUMN "quality_usable" BOOLEAN,
  ADD COLUMN "quality_result" JSONB,
  ADD COLUMN "intake_status" TEXT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_intake_status_check"
  CHECK ("intake_status" IS NULL OR "intake_status" IN ('QUALITY_REJECTED', 'QUEUED'));
CREATE INDEX "documents_file_sha256_idx" ON "documents"("file_sha256");

-- 2. document_extractions.
ALTER TABLE "document_extractions"
  ADD COLUMN "application_id" UUID NOT NULL,
  ADD COLUMN "document_slot" TEXT NOT NULL,
  ADD COLUMN "status" TEXT NOT NULL,
  ADD COLUMN "error_code" TEXT,
  ADD COLUMN "classification_type" TEXT,
  ADD COLUMN "classification_confidence" DOUBLE PRECISION,
  ADD COLUMN "classification_alternatives" JSONB,
  ADD COLUMN "classification_matches_slot" BOOLEAN,
  ADD COLUMN "field_confidence" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "field_review" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "review_status" TEXT,
  ADD COLUMN "review_threshold" DOUBLE PRECISION,
  ADD COLUMN "sensitive_values" BYTEA,
  ADD COLUMN "raw_text_encrypted" BYTEA,
  ADD COLUMN "eligibility_mismatches" JSONB,
  ADD COLUMN "corrected_fields" JSONB,
  ADD COLUMN "confirmed_by_officer_id" UUID,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6);

ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_status_check"
  CHECK ("status" IN ('COMPLETED', 'FAILED'));
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_review_status_check"
  CHECK ("review_status" IS NULL OR "review_status" IN ('AUTO_ACCEPTED', 'NEEDS_REVIEW', 'OFFICER_CONFIRMED'));
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_confirmation_check"
  CHECK (("review_status" = 'OFFICER_CONFIRMED') = ("confirmed_by_officer_id" IS NOT NULL AND "confirmed_at" IS NOT NULL));

ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_confirmed_by_officer_id_fkey"
  FOREIGN KEY ("confirmed_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "document_extractions_application_id_document_slot_idx"
  ON "document_extractions"("application_id", "document_slot");
CREATE INDEX "document_extractions_review_status_idx" ON "document_extractions"("review_status");

DROP TRIGGER IF EXISTS trigger_audit_document_extractions ON "document_extractions";
CREATE TRIGGER trigger_audit_document_extractions
AFTER INSERT OR UPDATE OR DELETE ON "document_extractions"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- 3. applications: document-consistency flag.
ALTER TABLE "applications"
  ADD COLUMN "document_consistency_status" TEXT,
  ADD COLUMN "document_consistency_details" JSONB,
  ADD COLUMN "document_consistency_checked_at" TIMESTAMPTZ(6);
ALTER TABLE "applications" ADD CONSTRAINT "applications_document_consistency_status_check"
  CHECK ("document_consistency_status" IS NULL
         OR "document_consistency_status" IN ('CONSISTENT', 'INCONSISTENT', 'UNCERTAIN'));
CREATE INDEX "applications_document_consistency_status_idx"
  ON "applications"("document_consistency_status");

-- 4. The worker's flag write. Same guard as workflow_system_transition
-- (SYSTEM actor only), narrower effect: it can only RAISE
-- needs_eligibility_review (never clear it - clearing is an officer's
-- confirmed review, Phase 4) and record the consistency result. It never
-- touches current_stage, status or any stage/SLA column.
CREATE OR REPLACE FUNCTION document_system_flag_application(
  p_application_id UUID,
  p_raise_eligibility_review BOOLEAN,
  p_consistency_status TEXT,
  p_consistency_details JSONB,
  p_checked_at TIMESTAMPTZ
)
RETURNS INTEGER
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'document_system_flag_application may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;

  UPDATE "applications"
     SET "needs_eligibility_review" = "needs_eligibility_review" OR COALESCE(p_raise_eligibility_review, false),
         "document_consistency_status" = COALESCE(p_consistency_status, "document_consistency_status"),
         "document_consistency_details" = CASE WHEN p_consistency_status IS NULL
                                               THEN "document_consistency_details" ELSE p_consistency_details END,
         "document_consistency_checked_at" = CASE WHEN p_consistency_status IS NULL
                                                  THEN "document_consistency_checked_at" ELSE p_checked_at END,
         "updated_at" = CURRENT_TIMESTAMP
   WHERE "id" = p_application_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION document_system_flag_application(UUID, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_system_flag_application(UUID, BOOLEAN, TEXT, JSONB, TIMESTAMPTZ) TO app_user;
