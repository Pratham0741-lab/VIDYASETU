-- ============================================================================
-- Phase 11: fraud & duplicate detection. DETECTION ONLY: nothing here
-- changes how applicants, applications or documents are created, and no
-- existing table, policy, trigger or function is modified.
--
--   pii_match_index - keyed-hash (HMAC-SHA256, FRAUD_MATCH_KEY) index of
--                     exact-match identifiers, so equal bank accounts /
--                     certificate numbers are found WITHOUT decrypting other
--                     applicants' rows. Never holds plaintext or ciphertext.
--   fraud_flags     - one row per finding per subject: type, severity,
--                     evidence (record ids only), reviewer disposition.
--   fraud_application_facts / fraud_document_facts - SYSTEM-only, read-only
--                     SECURITY DEFINER views across jurisdictions (RLS hides
--                     other jurisdictions' applications/documents from every
--                     role, SYSTEM included), returning ids and minimal facts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. pii_match_index
-- ---------------------------------------------------------------------------
CREATE TABLE "pii_match_index" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicant_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "document_id" UUID,
    "match_hmac" TEXT NOT NULL,
    "key_version" SMALLINT NOT NULL DEFAULT 1,
    "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pii_match_index_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pii_match_index_field_check"
      CHECK ("field" IN ('bank_account', 'caste_cert_number', 'certificate_number')),
    -- DECLARED: the applicant's own profile value. OCR / DIGILOCKER: read from a document.
    CONSTRAINT "pii_match_index_source_check" CHECK ("source" IN ('DECLARED', 'OCR', 'DIGILOCKER')),
    CONSTRAINT "pii_match_index_document_check" CHECK (("source" = 'DECLARED') = ("document_id" IS NULL)),
    CONSTRAINT "pii_match_index_hmac_check" CHECK ("match_hmac" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "pii_match_index" ADD CONSTRAINT "pii_match_index_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pii_match_index" ADD CONSTRAINT "pii_match_index_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pii_match_index_declared_key"
  ON "pii_match_index"("applicant_id", "field") WHERE "document_id" IS NULL;
CREATE UNIQUE INDEX "pii_match_index_document_key"
  ON "pii_match_index"("document_id", "field") WHERE "document_id" IS NOT NULL;
CREATE INDEX "pii_match_index_lookup_idx" ON "pii_match_index"("field", "match_hmac");

-- Detection-internal: only the SYSTEM actor (app.actor_role = SYSTEM, no
-- app.actor_id) may read or write it; officers and applicants see nothing.
REVOKE ALL ON "pii_match_index" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "pii_match_index" TO app_user;
ALTER TABLE "pii_match_index" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "system_only_pii_match_index_policy" ON "pii_match_index"
FOR ALL
USING (
  NULLIF(current_setting('app.actor_role', true), '') = 'SYSTEM'
  AND NULLIF(current_setting('app.actor_id', true), '') IS NULL
)
WITH CHECK (
  NULLIF(current_setting('app.actor_role', true), '') = 'SYSTEM'
  AND NULLIF(current_setting('app.actor_id', true), '') IS NULL
);

-- ---------------------------------------------------------------------------
-- 2. fraud_flags
-- ---------------------------------------------------------------------------
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flag_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "subject_type" TEXT NOT NULL,
    "application_id" UUID,
    "institution_code" TEXT,
    "related_application_ids" UUID[] NOT NULL DEFAULT '{}',
    "related_document_ids" UUID[] NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "detector" TEXT NOT NULL,
    "detector_version" INTEGER NOT NULL DEFAULT 1,
    "jurisdiction_state" TEXT,
    "jurisdiction_district" TEXT,
    "dedup_key" TEXT NOT NULL,
    "reviewed_by_officer_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fraud_flags_type_check" CHECK ("flag_type" IN (
      'SHARED_BANK_ACCOUNT', 'REPEATED_CERTIFICATE_NUMBER', 'DUPLICATE_FILE_HASH',
      'INSTITUTION_SURGE', 'FUZZY_IDENTITY_MATCH')),
    CONSTRAINT "fraud_flags_severity_check" CHECK ("severity" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "fraud_flags_status_check"
      CHECK ("status" IN ('OPEN', 'CONFIRMED', 'FALSE_POSITIVE', 'NEEDS_MORE_INFO')),
    CONSTRAINT "fraud_flags_subject_check" CHECK (
      ("subject_type" = 'APPLICATION' AND "application_id" IS NOT NULL)
      OR ("subject_type" = 'INSTITUTION' AND "application_id" IS NULL AND "institution_code" IS NOT NULL)),
    -- Fuzzy identity matching is uncalibrated (no labelled data): advisory only.
    CONSTRAINT "fraud_flags_fuzzy_advisory_check"
      CHECK ("flag_type" <> 'FUZZY_IDENTITY_MATCH' OR "severity" IN ('LOW', 'MEDIUM')),
    -- A disposition always names its reviewer.
    CONSTRAINT "fraud_flags_review_check" CHECK (
      ("status" = 'OPEN') = ("reviewed_by_officer_id" IS NULL AND "reviewed_at" IS NULL)),
    CONSTRAINT "fraud_flags_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1),
    CONSTRAINT "fraud_flags_evidence_check" CHECK (jsonb_typeof("evidence") = 'object')
);
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_reviewed_by_officer_id_fkey"
  FOREIGN KEY ("reviewed_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- One flag per finding, ever: re-running a detector never duplicates it, and a
-- FALSE_POSITIVE disposition is not re-opened by the same evidence.
CREATE UNIQUE INDEX "fraud_flags_dedup_key_key" ON "fraud_flags"("dedup_key");
CREATE INDEX "fraud_flags_application_idx" ON "fraud_flags"("application_id", "status");
CREATE INDEX "fraud_flags_institution_idx" ON "fraud_flags"("institution_code", "status");
CREATE INDEX "fraud_flags_jurisdiction_idx" ON "fraud_flags"("jurisdiction_state", "jurisdiction_district");

-- Privileges, stated explicitly: flags are created by detection (SYSTEM) and
-- dispositioned by officers, who may change only the review columns.
REVOKE ALL ON "fraud_flags" FROM app_user;
GRANT SELECT, INSERT ON "fraud_flags" TO app_user;
GRANT UPDATE ("status", "reviewed_by_officer_id", "reviewed_at", "review_notes", "updated_at")
  ON "fraud_flags" TO app_user;

-- RLS: the officer-jurisdiction predicate (national / state / state+district)
-- on the flag's own jurisdiction columns - the authorization_denials pattern;
-- plus the SYSTEM actor, which runs detection. Applicants see nothing.
ALTER TABLE "fraud_flags" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "officer_jurisdiction_fraud_flags_select_policy" ON "fraud_flags"
FOR SELECT
USING (
  (NULLIF(current_setting('app.actor_role', true), '') = 'SYSTEM'
   AND NULLIF(current_setting('app.actor_id', true), '') IS NULL)
  OR EXISTS (
    SELECT 1 FROM "officers" o
    WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND o.is_active = true
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND fraud_flags.jurisdiction_state = o.jurisdiction_state)
        OR (fraud_flags.jurisdiction_state = o.jurisdiction_state
            AND fraud_flags.jurisdiction_district = o.jurisdiction_district)
      )
  )
);
CREATE POLICY "system_fraud_flags_insert_policy" ON "fraud_flags"
FOR INSERT
WITH CHECK (
  NULLIF(current_setting('app.actor_role', true), '') = 'SYSTEM'
  AND NULLIF(current_setting('app.actor_id', true), '') IS NULL
);
CREATE POLICY "officer_jurisdiction_fraud_flags_update_policy" ON "fraud_flags"
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM "officers" o
    WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND o.is_active = true
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND fraud_flags.jurisdiction_state = o.jurisdiction_state)
        OR (fraud_flags.jurisdiction_state = o.jurisdiction_state
            AND fraud_flags.jurisdiction_district = o.jurisdiction_district)
      )
  )
);

-- Every flag and every disposition is audited by the existing trigger (unchanged).
CREATE TRIGGER trigger_audit_fraud_flags
AFTER INSERT OR UPDATE OR DELETE ON "fraud_flags"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- ---------------------------------------------------------------------------
-- 3. Cross-jurisdiction read access for detection (SYSTEM actor only).
--    Same guard as workflow_system_transition / document_system_flag_application.
--    Returns ids and minimal non-sensitive facts; never an encrypted column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fraud_application_facts(
  p_application_ids UUID[],
  p_applicant_ids UUID[],
  p_institution_code TEXT,
  p_disbursement_ids UUID[]
)
RETURNS TABLE (
  application_id UUID,
  application_no TEXT,
  applicant_id UUID,
  current_stage TEXT,
  jurisdiction_state TEXT,
  jurisdiction_district TEXT,
  institution_code TEXT,
  assigned_officer_id UUID,
  submitted_at TIMESTAMPTZ
)
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'fraud_application_facts may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  RETURN QUERY
    SELECT a.id, a.application_no, a.applicant_id, a.current_stage,
           a.jurisdiction_state, a.jurisdiction_district, a.institution_code,
           a.assigned_officer_id, COALESCE(a.submitted_at, a.created_at)
    FROM "applications" a
    WHERE (p_application_ids IS NOT NULL AND a.id = ANY (p_application_ids))
       OR (p_applicant_ids IS NOT NULL AND a.applicant_id = ANY (p_applicant_ids))
       OR (p_institution_code IS NOT NULL AND a.institution_code = p_institution_code)
       OR (p_disbursement_ids IS NOT NULL AND a.id IN (
             SELECT d.application_id FROM "disbursements" d WHERE d.id = ANY (p_disbursement_ids)));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fraud_document_facts(
  p_document_ids UUID[],
  p_application_id UUID,
  p_file_sha256 TEXT
)
RETURNS TABLE (
  document_id UUID,
  application_id UUID,
  applicant_id UUID,
  file_sha256 TEXT,
  source TEXT,
  created_at TIMESTAMPTZ
)
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'fraud_document_facts may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  RETURN QUERY
    SELECT d.id, d.application_id, a.applicant_id, d.file_sha256, d.source, d.created_at
    FROM "documents" d JOIN "applications" a ON a.id = d.application_id
    WHERE d.file_sha256 IS NOT NULL
      AND ((p_document_ids IS NOT NULL AND d.id = ANY (p_document_ids))
        OR (p_application_id IS NOT NULL AND d.application_id = p_application_id)
        OR (p_file_sha256 IS NOT NULL AND d.file_sha256 = p_file_sha256));
END;
$$ LANGUAGE plpgsql;

-- Platform history coverage for the institution-surge baseline.
CREATE OR REPLACE FUNCTION fraud_platform_first_submission()
RETURNS TIMESTAMPTZ
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'fraud_platform_first_submission may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  RETURN (SELECT min(COALESCE(a.submitted_at, a.created_at)) FROM "applications" a);
END;
$$ LANGUAGE plpgsql;

-- Backfill paging: every application id, in order (keyset pagination).
CREATE OR REPLACE FUNCTION fraud_application_ids_page(p_after UUID, p_limit INTEGER)
RETURNS TABLE (application_id UUID)
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'fraud_application_ids_page may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  RETURN QUERY
    SELECT a.id FROM "applications" a
    WHERE p_after IS NULL OR a.id > p_after
    ORDER BY a.id
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fraud_application_ids_page(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fraud_application_ids_page(UUID, INTEGER) TO app_user;
REVOKE ALL ON FUNCTION fraud_platform_first_submission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fraud_platform_first_submission() TO app_user;
REVOKE ALL ON FUNCTION fraud_application_facts(UUID[], UUID[], TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fraud_application_facts(UUID[], UUID[], TEXT, UUID[]) TO app_user;
REVOKE ALL ON FUNCTION fraud_document_facts(UUID[], UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fraud_document_facts(UUID[], UUID, TEXT) TO app_user;
