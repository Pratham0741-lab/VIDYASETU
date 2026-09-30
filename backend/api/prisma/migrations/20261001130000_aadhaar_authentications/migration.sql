-- Phase 14 loose ends Part E: Aadhaar authentication adapter (plan Phase 15).
--
-- The outcome of an applicant's Aadhaar authentication. The Aadhaar number
-- itself is NEVER stored: only its keyed hash (HMAC-SHA256 with the fraud
-- index key over the normalised number, field prefix "aadhaar") and its last
-- four digits (the UIDAI masked form). The CHECKs make a stored number
-- impossible: uid_hmac is 64 hex characters and uid_last4 exactly 4 digits.
-- Owner-only RLS (nobody else has a route); audited.

CREATE TABLE "aadhaar_authentications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "applicant_id" UUID NOT NULL,
  "outcome" TEXT NOT NULL,
  "error_code" TEXT,
  "uid_hmac" TEXT NOT NULL,
  "uid_last4" TEXT NOT NULL,
  "hmac_key_version" INTEGER NOT NULL,
  "adapter_mode" TEXT NOT NULL,
  "txn_id" TEXT NOT NULL,
  "consent_given_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aadhaar_authentications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aadhaar_authentications_outcome_check" CHECK (
    ("outcome" = 'AUTHENTICATED' AND "error_code" IS NULL)
    OR ("outcome" = 'NOT_AUTHENTICATED' AND "error_code" ~ '^[0-9A-Z-]{1,10}$')),
  CONSTRAINT "aadhaar_authentications_hmac_check" CHECK ("uid_hmac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "aadhaar_authentications_last4_check" CHECK ("uid_last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "aadhaar_authentications_mode_check" CHECK ("adapter_mode" IN ('mock', 'real'))
);
CREATE INDEX "aadhaar_authentications_applicant_idx"
  ON "aadhaar_authentications" ("applicant_id", "created_at" DESC);
CREATE INDEX "aadhaar_authentications_uid_hmac_idx" ON "aadhaar_authentications" ("uid_hmac");
ALTER TABLE "aadhaar_authentications" ADD CONSTRAINT "aadhaar_authentications_applicant_id_fkey"
  FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "aadhaar_authentications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_aadhaar_authentications_policy" ON "aadhaar_authentications"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "aadhaar_authentications".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "applicants" a
     WHERE a.id = "aadhaar_authentications".applicant_id
       AND a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid));

REVOKE ALL ON "aadhaar_authentications" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "aadhaar_authentications" FROM app_user;
GRANT SELECT, INSERT ON "aadhaar_authentications" TO app_user;

CREATE TRIGGER "trigger_audit_aadhaar_authentications"
  AFTER INSERT OR UPDATE OR DELETE ON "aadhaar_authentications"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach', 'application_draft', 'aadhaar_authentication',
  'renewal'));
