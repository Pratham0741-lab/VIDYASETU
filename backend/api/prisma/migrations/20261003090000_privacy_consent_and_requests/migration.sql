-- Phase 17 Part B: consent records and DPDP requests (access is a read-only
-- endpoint; correction and erasure are recorded here).
--
-- Every row is keyed to the applicant and holds no personal data in clear,
-- so the audit rows the chain trigger writes carry none either:
--   consent_records       purpose, notice version, language, status, method;
--   correction_requests   the field NAME, the requested value ENCRYPTED by the
--                         api (AES-256-GCM, the PII key, as applicants'
--                         sensitive columns), the reason and status;
--   correction_decisions  insert-only, reason >= 10 trimmed characters (CHECK);
--   erasure_requests      recorded only - nothing is erased in Phase 17.
-- consent_records, correction_decisions and erasure_requests are insert-only
-- (no UPDATE / DELETE grant). Row-level security: the owning applicant; for
-- correction requests and decisions also the officers whose jurisdiction
-- covers the applicant's domicile (the applications rule).

-- ------------------------------------------------------------------ consent
CREATE TABLE "consent_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "applicant_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "notice_version" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "recorded_by_account_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consent_records_purpose_check" CHECK ("purpose" ~ '^[a-z][a-z_]{2,40}$'),
  CONSTRAINT "consent_records_version_check" CHECK ("notice_version" ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT "consent_records_language_check" CHECK ("language" ~ '^[a-z]{2,3}$'),
  CONSTRAINT "consent_records_status_check" CHECK ("status" IN ('GIVEN', 'WITHDRAWN')),
  CONSTRAINT "consent_records_method_check" CHECK ("method" IN ('ONLINE_FORM'))
);
CREATE INDEX "consent_records_applicant_idx" ON "consent_records" ("applicant_id", "purpose", "created_at" DESC);
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_fkey"
  FOREIGN KEY ("recorded_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ corrections
CREATE TABLE "correction_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "applicant_id" UUID NOT NULL,
  "field" TEXT NOT NULL,
  "requested_value_encrypted" BYTEA NOT NULL,
  "reason" TEXT NOT NULL,
  "supporting_document_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "jurisdiction_state" TEXT NOT NULL,
  "jurisdiction_district" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_requests_field_check" CHECK ("field" IN ('first_name', 'last_name', 'dob', 'gender')),
  CONSTRAINT "correction_requests_status_check" CHECK ("status" IN ('OPEN', 'APPROVED', 'REJECTED')),
  CONSTRAINT "correction_requests_reason_check" CHECK (length(btrim("reason")) >= 10)
);
CREATE INDEX "correction_requests_queue_idx" ON "correction_requests" ("status", "jurisdiction_state", "jurisdiction_district", "created_at");
CREATE INDEX "correction_requests_applicant_idx" ON "correction_requests" ("applicant_id", "created_at" DESC);
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_document_fkey"
  FOREIGN KEY ("supporting_document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A request is decided once: OPEN -> APPROVED | REJECTED, nothing else changes.
CREATE OR REPLACE FUNCTION correction_request_transition_guard()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'OPEN' OR NEW.status = 'OPEN'
     OR NEW.applicant_id IS DISTINCT FROM OLD.applicant_id
     OR NEW.field IS DISTINCT FROM OLD.field
     OR NEW.requested_value_encrypted IS DISTINCT FROM OLD.requested_value_encrypted
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.supporting_document_id IS DISTINCT FROM OLD.supporting_document_id THEN
    RAISE EXCEPTION 'CORRECTION_REQUEST_DECIDED: a correction request changes only once, from OPEN to its decision'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "trigger_correction_request_transition_guard"
  BEFORE UPDATE ON "correction_requests"
  FOR EACH ROW EXECUTE FUNCTION correction_request_transition_guard();

CREATE TABLE "correction_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "officer_id" UUID NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "correction_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "correction_decisions_decision_check" CHECK ("decision" IN ('APPROVE', 'REJECT')),
  CONSTRAINT "correction_decisions_reason_check" CHECK (length(btrim("reason")) >= 10)
);
CREATE UNIQUE INDEX "correction_decisions_one_per_request_key" ON "correction_decisions" ("request_id");
ALTER TABLE "correction_decisions" ADD CONSTRAINT "correction_decisions_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "correction_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_decisions" ADD CONSTRAINT "correction_decisions_officer_id_fkey"
  FOREIGN KEY ("officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ erasure
CREATE TABLE "erasure_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "applicant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "erasure_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "erasure_requests_status_check" CHECK ("status" IN ('RECORDED'))
);
CREATE INDEX "erasure_requests_applicant_idx" ON "erasure_requests" ("applicant_id", "created_at" DESC);
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------------------ RLS
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "erasure_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "correction_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "correction_decisions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_consent_records_policy" ON "consent_records" FOR ALL
  USING (EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "consent_records".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "consent_records".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));
CREATE POLICY "owner_erasure_requests_policy" ON "erasure_requests" FOR ALL
  USING (EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "erasure_requests".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "erasure_requests".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));

-- The applicant reads and files (OPEN only); officers read and decide.
CREATE POLICY "owner_correction_requests_read" ON "correction_requests" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "correction_requests".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));
CREATE POLICY "owner_correction_requests_file" ON "correction_requests" FOR INSERT
  WITH CHECK ("status" = 'OPEN' AND EXISTS (SELECT 1 FROM "applicants" a WHERE a.id = "correction_requests".applicant_id
                 AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));
CREATE POLICY "officer_correction_requests_read" ON "correction_requests" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "officers" o
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "correction_requests".jurisdiction_state = o.jurisdiction_state)
            OR ("correction_requests".jurisdiction_state = o.jurisdiction_state
                AND "correction_requests".jurisdiction_district = o.jurisdiction_district))));
CREATE POLICY "officer_correction_requests_decide" ON "correction_requests" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "officers" o
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "correction_requests".jurisdiction_state = o.jurisdiction_state)
            OR ("correction_requests".jurisdiction_state = o.jurisdiction_state
                AND "correction_requests".jurisdiction_district = o.jurisdiction_district))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "officers" o
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "correction_requests".jurisdiction_state = o.jurisdiction_state)
            OR ("correction_requests".jurisdiction_state = o.jurisdiction_state
                AND "correction_requests".jurisdiction_district = o.jurisdiction_district))));
CREATE POLICY "scoped_correction_decisions_policy" ON "correction_decisions" FOR ALL
  USING (EXISTS (SELECT 1 FROM "correction_requests" r WHERE r.id = "correction_decisions".request_id))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "correction_requests" r
      JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
     WHERE r.id = "correction_decisions".request_id AND o.id = "correction_decisions".officer_id));

-- ------------------------------------------------------------------ grants, audit
REVOKE ALL ON "consent_records", "erasure_requests", "correction_requests", "correction_decisions" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "consent_records", "erasure_requests", "correction_decisions" FROM app_user;
REVOKE DELETE, TRUNCATE ON "correction_requests" FROM app_user;
GRANT SELECT, INSERT ON "consent_records", "erasure_requests", "correction_decisions" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "correction_requests" TO app_user;

CREATE TRIGGER "trigger_audit_consent_records" AFTER INSERT OR UPDATE OR DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_erasure_requests" AFTER INSERT OR UPDATE OR DELETE ON "erasure_requests"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_correction_requests" AFTER INSERT OR UPDATE OR DELETE ON "correction_requests"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_correction_decisions" AFTER INSERT OR UPDATE OR DELETE ON "correction_decisions"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach', 'application_draft', 'aadhaar_authentication',
  'renewal', 'officer_preference', 'consent_record', 'correction_request', 'correction_decision',
  'erasure_request', 'document_access', 'retention_run'));
