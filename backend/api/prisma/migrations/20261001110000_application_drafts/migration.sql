-- Phase 14 loose ends Part C: application drafts (plan Phase 6).
--
-- There was no draft state: POST /applications created the application in
-- SUBMITTED and ran the eligibility gate in the same request. A draft is a
-- separate, applicant-private row - not an application - so no officer
-- queue, analytics funnel, fraud detector or selection run (all of which
-- read applications) can see it. Submitting a draft calls the unchanged
-- submit path; the draft then records the application it became and is
-- frozen.
--
-- Stored: the same non-sensitive fields an application carries plus the
-- self-declared gate inputs. The api refuses recorded fields and every
-- field of the Phase 3 sensitive list in `declared`, so nothing here needs
-- encryption (income, caste certificate and bank account stay on the
-- applicant row, encrypted).

CREATE TABLE "application_drafts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "applicant_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "scheme_version_id" UUID,
  "academic_year" TEXT,
  "institution_name" TEXT,
  "institution_code" TEXT,
  "course_name" TEXT,
  "course_year" INTEGER,
  "is_hosteller" BOOLEAN,
  "declared" JSONB NOT NULL DEFAULT '{}',
  "submitted_application_id" UUID,
  "submitted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_drafts_status_check" CHECK ("status" IN ('DRAFT', 'SUBMITTED')),
  CONSTRAINT "application_drafts_submitted_check" CHECK (
    ("status" = 'DRAFT' AND "submitted_application_id" IS NULL AND "submitted_at" IS NULL)
    OR ("status" = 'SUBMITTED' AND "submitted_application_id" IS NOT NULL AND "submitted_at" IS NOT NULL)),
  CONSTRAINT "application_drafts_declared_object_check" CHECK (jsonb_typeof("declared") = 'object'),
  CONSTRAINT "application_drafts_academic_year_check" CHECK ("academic_year" IS NULL OR "academic_year" ~ '^\d{4}-\d{2}$')
);
CREATE INDEX "application_drafts_applicant_idx" ON "application_drafts" ("applicant_id", "updated_at" DESC);
CREATE UNIQUE INDEX "application_drafts_submitted_application_key"
  ON "application_drafts" ("submitted_application_id") WHERE "submitted_application_id" IS NOT NULL;
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_scheme_version_id_fkey"
  FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_drafts" ADD CONSTRAINT "application_drafts_submitted_application_id_fkey"
  FOREIGN KEY ("submitted_application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Owner only: no officer, committee or auditor policy exists, so they see nothing.
ALTER TABLE "application_drafts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_application_drafts_policy" ON "application_drafts"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "application_drafts".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "application_drafts".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));

REVOKE ALL ON "application_drafts" FROM PUBLIC;
REVOKE DELETE, TRUNCATE ON "application_drafts" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "application_drafts" TO app_user;

-- A submitted draft is frozen.
CREATE OR REPLACE FUNCTION application_draft_submitted_frozen()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'SUBMITTED' THEN
    RAISE EXCEPTION 'DRAFT_SUBMITTED: application draft % was submitted and cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "trigger_application_draft_submitted_frozen"
  BEFORE UPDATE ON "application_drafts"
  FOR EACH ROW EXECUTE FUNCTION application_draft_submitted_frozen();

CREATE TRIGGER "trigger_audit_application_drafts"
  AFTER INSERT OR UPDATE OR DELETE ON "application_drafts"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach', 'application_draft'));
