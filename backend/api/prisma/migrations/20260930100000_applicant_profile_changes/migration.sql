-- Phase 13D (Part C, KNOWN_LIMITATIONS M41): applicants edit their own
-- profile (phone, preferred_language) through PATCH /api/v1/applicants/me.
--
-- applicants carries plaintext names / contact details and has no audit
-- trigger; adding one would copy them into audit_logs. Instead every
-- profile change writes one applicant_profile_changes row - WHICH fields
-- changed, never their values - and that row is audited in the chain.
--   * RLS: the applicant who owns the profile only (officers: none; no
--     actor: none).
--   * app_user: SELECT, INSERT only (never updated or deleted).

CREATE TABLE "applicant_profile_changes" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "applicant_id"          UUID NOT NULL REFERENCES "applicants"("id") ON DELETE RESTRICT,
  "changed_fields"        TEXT[] NOT NULL,
  "changed_by_account_id" UUID NOT NULL,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "applicant_profile_changes_fields_check" CHECK (
    cardinality("changed_fields") >= 1
    AND "changed_fields" <@ ARRAY['phone', 'preferred_language']::text[])
);
CREATE INDEX "applicant_profile_changes_applicant_idx" ON "applicant_profile_changes" ("applicant_id", "created_at");

ALTER TABLE "applicant_profile_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_applicant_profile_changes_policy" ON "applicant_profile_changes"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "applicant_profile_changes".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "applicant_profile_changes".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));

REVOKE ALL ON "applicant_profile_changes" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "applicant_profile_changes" FROM app_user;
GRANT SELECT, INSERT ON "applicant_profile_changes" TO app_user;

CREATE TRIGGER "trigger_audit_applicant_profile_changes"
  AFTER INSERT OR UPDATE OR DELETE ON "applicant_profile_changes"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- test_fixtures may tag them.
ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change'));
