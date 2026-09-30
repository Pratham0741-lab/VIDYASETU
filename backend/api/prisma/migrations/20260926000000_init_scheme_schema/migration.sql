-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926000000_init_scheme_schema
-- PostgreSQL + Prisma + Supabase Complete Schema & Extensions
-- ============================================================================

-- ============================================================================
-- EXTENSION REQUIREMENT 1: Required Extensions
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pg_jsonschema is optional (Supabase ships it; stock PostgreSQL does not).
-- Same guard as migration 20260926010000: try it, log a NOTICE if unavailable.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_jsonschema;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Extension pg_jsonschema could not be installed or is restricted: %', SQLERRM;
END;
$$;

-- ============================================================================
-- BASE PRISMA DATA CONTRACT: 17 Core Tables
-- ============================================================================

-- CreateTable: roles
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: officers
CREATE TABLE "officers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role_id" UUID NOT NULL,
    "jurisdiction_state" TEXT,
    "jurisdiction_district" TEXT,
    "institution_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "officers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: applicants
CREATE TABLE "applicants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "dob" DATE,
    "category" TEXT NOT NULL,
    "pvtg_group" TEXT,
    "is_disabled" BOOLEAN NOT NULL DEFAULT false,
    "disability_type" TEXT,
    "disability_percentage" DOUBLE PRECISION,
    "domicile_state" TEXT NOT NULL,
    "domicile_district" TEXT,
    "caste_cert_number" BYTEA NOT NULL,
    "income" BYTEA NOT NULL,
    "bank_account" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable: schemes
CREATE TABLE "schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "portal_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: scheme_versions
CREATE TABLE "scheme_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheme_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "config" JSONB NOT NULL,
    "source_document" TEXT,
    "source_url" TEXT,
    "extraction_confidence" TEXT,
    "extraction_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheme_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: applications
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_no" TEXT NOT NULL,
    "applicant_id" UUID NOT NULL,
    "scheme_id" UUID NOT NULL,
    "scheme_version_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "current_stage" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jurisdiction_state" TEXT NOT NULL,
    "jurisdiction_district" TEXT,
    "institution_name" TEXT,
    "institution_code" TEXT,
    "course_name" TEXT,
    "course_year" INTEGER,
    "is_hosteller" BOOLEAN NOT NULL DEFAULT false,
    "assigned_officer_id" UUID,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable: documents
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'PENDING',
    "verified_by_officer_id" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: document_extractions
CREATE TABLE "document_extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "extracted_data" JSONB NOT NULL,
    "confidence_score" DOUBLE PRECISION,
    "extraction_engine" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: decision_records
CREATE TABLE "decision_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "officer_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "remarks" TEXT,
    "reasons" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable: deficiencies
CREATE TABLE "deficiencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "officer_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(6),
    "student_response" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "deficiencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable: workflow_transitions
CREATE TABLE "workflow_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "from_stage" TEXT NOT NULL,
    "to_stage" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "trigger_action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: scores
CREATE TABLE "scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "officer_id" UUID,
    "score_type" TEXT NOT NULL,
    "score_value" DOUBLE PRECISION NOT NULL,
    "normalized_score" DOUBLE PRECISION,
    "weightage" DOUBLE PRECISION,
    "breakdown" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable: selections
CREATE TABLE "selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "scheme_code" TEXT NOT NULL,
    "academic_year" TEXT NOT NULL,
    "merit_rank" INTEGER,
    "selection_category" TEXT NOT NULL,
    "selection_status" TEXT NOT NULL DEFAULT 'PROVISIONAL',
    "allotted_slot" INTEGER,
    "notified_in_merit_list" TEXT,
    "selection_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: disbursements
CREATE TABLE "disbursements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "financial_year" TEXT NOT NULL,
    "component_type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "beneficiary_type" TEXT NOT NULL,
    "payment_mode" TEXT NOT NULL DEFAULT 'PFMS_DBT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transaction_reference" TEXT,
    "utr_number" TEXT,
    "disbursed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable: renewals
CREATE TABLE "renewals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_application_id" UUID NOT NULL,
    "academic_year" TEXT NOT NULL,
    "academic_year_number" INTEGER NOT NULL,
    "passed_previous_year" BOOLEAN NOT NULL,
    "percentage_obtained" DOUBLE PRECISION,
    "marksheet_path" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable: notice_templates
CREATE TABLE "notice_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheme_code" TEXT,
    "channel" TEXT NOT NULL,
    "subject_template" TEXT,
    "body_template" TEXT NOT NULL,
    "variables" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: audit_logs
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "table_name" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "ip_address" TEXT,
    "row_data" JSONB NOT NULL,
    "prev_hash" TEXT,
    "record_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- BASE UNIQUE CONSTRAINTS & INDEXES
-- ============================================================================

CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");
CREATE UNIQUE INDEX "officers_user_id_key" ON "officers"("user_id");
CREATE UNIQUE INDEX "officers_email_key" ON "officers"("email");
CREATE INDEX "officers_jurisdiction_state_jurisdiction_district_idx" ON "officers"("jurisdiction_state", "jurisdiction_district");

CREATE UNIQUE INDEX "applicants_user_id_key" ON "applicants"("user_id");
CREATE INDEX "applicants_category_domicile_state_idx" ON "applicants"("category", "domicile_state");

CREATE UNIQUE INDEX "schemes_code_key" ON "schemes"("code");

CREATE INDEX "scheme_versions_scheme_id_status_idx" ON "scheme_versions"("scheme_id", "status");
CREATE UNIQUE INDEX "scheme_versions_scheme_id_version_no_key" ON "scheme_versions"("scheme_id", "version_no");

CREATE UNIQUE INDEX "applications_application_no_key" ON "applications"("application_no");
CREATE INDEX "documents_application_id_document_type_idx" ON "documents"("application_id", "document_type");
CREATE INDEX "document_extractions_document_id_idx" ON "document_extractions"("document_id");
CREATE INDEX "decision_records_application_id_stage_idx" ON "decision_records"("application_id", "stage");
CREATE INDEX "deficiencies_application_id_status_idx" ON "deficiencies"("application_id", "status");
CREATE INDEX "workflow_transitions_application_id_created_at_idx" ON "workflow_transitions"("application_id", "created_at");
CREATE INDEX "scores_application_id_score_type_idx" ON "scores"("application_id", "score_type");
CREATE INDEX "selections_scheme_code_academic_year_selection_status_idx" ON "selections"("scheme_code", "academic_year", "selection_status");
CREATE INDEX "disbursements_application_id_status_idx" ON "disbursements"("application_id", "status");
CREATE INDEX "disbursements_financial_year_status_idx" ON "disbursements"("financial_year", "status");
CREATE INDEX "renewals_parent_application_id_idx" ON "renewals"("parent_application_id");
CREATE UNIQUE INDEX "notice_templates_code_key" ON "notice_templates"("code");
CREATE INDEX "audit_logs_table_name_record_id_idx" ON "audit_logs"("table_name", "record_id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- ============================================================================
-- BASE FOREIGN KEYS
-- ============================================================================

ALTER TABLE "officers" ADD CONSTRAINT "officers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheme_versions" ADD CONSTRAINT "scheme_versions_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_scheme_version_id_fkey" FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_assigned_officer_id_fkey" FOREIGN KEY ("assigned_officer_id") REFERENCES "officers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_records" ADD CONSTRAINT "decision_records_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deficiencies" ADD CONSTRAINT "deficiencies_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deficiencies" ADD CONSTRAINT "deficiencies_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scores" ADD CONSTRAINT "scores_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scores" ADD CONSTRAINT "scores_officer_id_fkey" FOREIGN KEY ("officer_id") REFERENCES "officers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "selections" ADD CONSTRAINT "selections_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_parent_application_id_fkey" FOREIGN KEY ("parent_application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "officers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- EXTENSION REQUIREMENT 2: JSON Schema CHECK Constraint on scheme_versions.config
-- ============================================================================
-- Enforces mandatory presence of outer keys: income_limit_annual, eligible_categories,
-- eligible_education_level, benefit_structure, duration, required_documents, fund_sharing_ratio
-- while allowing scheme-specific benefit_structure flexibility.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'json_matches_schema') THEN
    ALTER TABLE "scheme_versions"
    ADD CONSTRAINT "check_scheme_versions_config_schema"
    CHECK (
      json_matches_schema(
        '{
          "type": "object",
          "required": [
            "income_limit_annual",
            "eligible_categories",
            "eligible_education_level",
            "benefit_structure",
            "duration",
            "required_documents",
            "fund_sharing_ratio"
          ],
          "properties": {
            "income_limit_annual": {
              "type": ["number", "null"]
            },
            "eligible_categories": {
              "type": "array"
            },
            "eligible_education_level": {
              "type": "string"
            },
            "benefit_structure": {
              "type": "object",
              "additionalProperties": true
            },
            "duration": {
              "type": "string"
            },
            "required_documents": {
              "type": "array"
            },
            "fund_sharing_ratio": {
              "type": ["string", "null"]
            }
          }
        }'::json,
        config::json
      )
    );
  ELSE
    -- Migration 20260926010000 installs the is_valid_scheme_config() fallback.
    RAISE NOTICE 'pg_jsonschema not available: skipping json_matches_schema() CHECK on scheme_versions.config (fallback constraint is added by migration 20260926010000).';
  END IF;
END;
$$;

-- ============================================================================
-- EXTENSION REQUIREMENT 3: Freeze scheme_version_id on applications
-- ============================================================================
-- Raises an exception if NEW.scheme_version_id is modified after creation.
CREATE OR REPLACE FUNCTION prevent_scheme_version_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scheme_version_id IS DISTINCT FROM OLD.scheme_version_id THEN
    RAISE EXCEPTION 'scheme_version_id on applications is immutable once set and cannot be updated (Application ID: %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_scheme_version_change ON "applications";
CREATE TRIGGER trigger_prevent_scheme_version_change
BEFORE UPDATE ON "applications"
FOR EACH ROW
EXECUTE FUNCTION prevent_scheme_version_change();

-- ============================================================================
-- EXTENSION REQUIREMENT 4: PII Encryption & Decryption Functions
-- ============================================================================
-- Symmetric encryption using pgp_sym_encrypt/decrypt reading key from app.pii_key setting.
CREATE OR REPLACE FUNCTION encrypt_pii(raw_text TEXT)
RETURNS BYTEA AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF raw_text IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Database setting "app.pii_key" is not configured. Set with: SET app.pii_key = ''your-secret'';';
  END IF;

  RETURN pgp_sym_encrypt(raw_text, v_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrypt_pii(encrypted_data BYTEA)
RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF encrypted_data IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Database setting "app.pii_key" is not configured. Set with: SET app.pii_key = ''your-secret'';';
  END IF;

  RETURN pgp_sym_decrypt(encrypted_data, v_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- EXTENSION REQUIREMENT 5: Audit Log SHA-256 Hash Chain Trigger
-- ============================================================================
-- Maintains cryptographic audit hash chain across critical lifecycle tables:
-- applications, documents, decision_records, disbursements.
-- Formula: record_hash = digest(COALESCE(prev_hash,'') || row_to_json(NEW/OLD)::text, 'sha256')
CREATE OR REPLACE FUNCTION process_audit_log_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_hash TEXT;
  v_record_hash TEXT;
  v_row_json TEXT;
  v_row_data JSONB;
  v_record_id UUID;
  v_action TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
BEGIN
  v_action := TG_OP;

  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_row_json := row_to_json(OLD)::text;
    v_row_data := row_to_json(OLD)::jsonb;
  ELSE
    v_record_id := NEW.id;
    v_row_json := row_to_json(NEW)::text;
    v_row_data := row_to_json(NEW)::jsonb;
  END IF;

  -- Extract Supabase authenticated user ID and role if present
  BEGIN
    v_actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  -- Get latest record_hash in chain
  SELECT record_hash INTO v_prev_hash
  FROM "audit_logs"
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  -- Calculate SHA-256 hash chain
  v_record_hash := encode(digest(COALESCE(v_prev_hash, '') || v_row_json, 'sha256'), 'hex');

  -- Insert immutably into audit_logs
  INSERT INTO "audit_logs" (
    id,
    table_name,
    record_id,
    action,
    actor_id,
    actor_role,
    ip_address,
    row_data,
    prev_hash,
    record_hash,
    created_at
  ) VALUES (
    gen_random_uuid(),
    TG_TABLE_NAME,
    v_record_id,
    v_action,
    v_actor_id,
    v_actor_role,
    NULL,
    v_row_data,
    v_prev_hash,
    v_record_hash,
    CURRENT_TIMESTAMP
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_audit_applications ON "applications";
CREATE TRIGGER trigger_audit_applications
AFTER INSERT OR UPDATE OR DELETE ON "applications"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_documents ON "documents";
CREATE TRIGGER trigger_audit_documents
AFTER INSERT OR UPDATE OR DELETE ON "documents"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_decision_records ON "decision_records";
CREATE TRIGGER trigger_audit_decision_records
AFTER INSERT OR UPDATE OR DELETE ON "decision_records"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_disbursements ON "disbursements";
CREATE TRIGGER trigger_audit_disbursements
AFTER INSERT OR UPDATE OR DELETE ON "disbursements"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- ============================================================================
-- EXTENSION REQUIREMENT 6: Row Level Security (RLS) Policies
-- ============================================================================
-- Actor identity: the NestJS api sets the caller's user id per transaction with
--   SET LOCAL app.actor_id = '<uuid>';   (or set_config('app.actor_id', '<uuid>', true))
-- and every policy reads it via current_setting('app.actor_id', true).
-- NULLIF(..., '') is required: on a pooled connection, a custom setting that was
-- SET LOCAL in an earlier transaction reads back as '' (not NULL) afterwards,
-- and ''::uuid would raise an error instead of matching no rows.
-- The value is compared with officers.user_id / applicants.user_id.
-- Enable RLS on applications and all associated child tables
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deficiencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "disbursements" ENABLE ROW LEVEL SECURITY;

-- 1. Applications Policy: restrict to matching officer jurisdiction via app.actor_id or student owner
DROP POLICY IF EXISTS "officer_jurisdiction_applications_policy" ON "applications";
CREATE POLICY "officer_jurisdiction_applications_policy" ON "applications"
FOR ALL
USING (
  -- Officer jurisdiction check
  EXISTS (
    SELECT 1 FROM "officers" o
    WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND o.is_active = true
      AND (
        -- Central / Ministry Officer: null state implies national access
        o.jurisdiction_state IS NULL
        OR (
          -- State Nodal Officer: matching state and unrestricted district
          o.jurisdiction_district IS NULL
          AND applications.jurisdiction_state = o.jurisdiction_state
        )
        OR (
          -- District Nodal Officer: both state and district match
          applications.jurisdiction_state = o.jurisdiction_state
          AND applications.jurisdiction_district = o.jurisdiction_district
        )
        -- Assigned Officer direct match
        OR applications.assigned_officer_id = o.id
      )
  )
  -- Or applicant viewing their own application
  OR EXISTS (
    SELECT 1 FROM "applicants" a
    WHERE a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND applications.applicant_id = a.id
  )
);

-- 2. Documents Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_documents_policy" ON "documents";
CREATE POLICY "officer_jurisdiction_documents_policy" ON "documents"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = documents.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = documents.application_id AND app.applicant_id = a.id
  )
);

-- 3. Decision Records Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_decision_records_policy" ON "decision_records";
CREATE POLICY "officer_jurisdiction_decision_records_policy" ON "decision_records"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = decision_records.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = decision_records.application_id AND app.applicant_id = a.id
  )
);

-- 4. Deficiencies Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_deficiencies_policy" ON "deficiencies";
CREATE POLICY "officer_jurisdiction_deficiencies_policy" ON "deficiencies"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = deficiencies.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = deficiencies.application_id AND app.applicant_id = a.id
  )
);

-- 5. Scores Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_scores_policy" ON "scores";
CREATE POLICY "officer_jurisdiction_scores_policy" ON "scores"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = scores.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = scores.application_id AND app.applicant_id = a.id
  )
);

-- 6. Selections Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_selections_policy" ON "selections";
CREATE POLICY "officer_jurisdiction_selections_policy" ON "selections"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = selections.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = selections.application_id AND app.applicant_id = a.id
  )
);

-- 7. Disbursements Policy: cascade jurisdiction via applications join
DROP POLICY IF EXISTS "officer_jurisdiction_disbursements_policy" ON "disbursements";
CREATE POLICY "officer_jurisdiction_disbursements_policy" ON "disbursements"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = disbursements.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = disbursements.application_id AND app.applicant_id = a.id
  )
);

-- ============================================================================
-- EXTENSION REQUIREMENT 7: Composite Indexes from Task 1
-- ============================================================================
CREATE INDEX IF NOT EXISTS "applications_jurisdiction_state_jurisdiction_district_statu_idx"
ON "applications"("jurisdiction_state", "jurisdiction_district", "status");

CREATE INDEX IF NOT EXISTS "applications_assigned_officer_id_status_submitted_at_idx"
ON "applications"("assigned_officer_id", "status", "submitted_at");
