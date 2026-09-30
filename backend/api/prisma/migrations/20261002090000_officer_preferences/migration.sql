-- Phase 16 C1 (M50): officers choose the language of their notices.
--
-- A separate one-row-per-officer table rather than a column on officers:
-- officers is not audited, and auditing it would copy every officer's name,
-- email and phone into audit_logs. This table holds only the officer id, the
-- language and who set it, so its audit rows carry no personal data.
--
-- Readable by every connection (the notification listener resolves
-- recipients with no actor, like officers); written only by the officer
-- themself or a SUPER_ADMIN (RLS). The api validates the language against
-- SUPPORTED_LANGUAGES; the CHECK bounds its shape.

CREATE TABLE "officer_preferences" (
  "officer_id" UUID NOT NULL,
  "preferred_language" TEXT NOT NULL,
  "updated_by_account_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "officer_preferences_pkey" PRIMARY KEY ("officer_id"),
  CONSTRAINT "officer_preferences_language_check" CHECK ("preferred_language" ~ '^[a-z]{2,3}$')
);
ALTER TABLE "officer_preferences" ADD CONSTRAINT "officer_preferences_officer_id_fkey"
  FOREIGN KEY ("officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "officer_preferences" ADD CONSTRAINT "officer_preferences_updated_by_account_id_fkey"
  FOREIGN KEY ("updated_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "officer_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "officer_preferences_read" ON "officer_preferences" FOR SELECT USING (TRUE);
CREATE POLICY "officer_preferences_insert" ON "officer_preferences" FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM "officers" o
             WHERE o.id = "officer_preferences".officer_id
               AND o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
    OR (NULLIF(current_setting('app.actor_role', true), '') = 'SUPER_ADMIN'
        AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL));
CREATE POLICY "officer_preferences_update" ON "officer_preferences" FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM "officers" o
             WHERE o.id = "officer_preferences".officer_id
               AND o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
    OR (NULLIF(current_setting('app.actor_role', true), '') = 'SUPER_ADMIN'
        AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL))
  WITH CHECK (
    EXISTS (SELECT 1 FROM "officers" o
             WHERE o.id = "officer_preferences".officer_id
               AND o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
    OR (NULLIF(current_setting('app.actor_role', true), '') = 'SUPER_ADMIN'
        AND NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL));

REVOKE ALL ON "officer_preferences" FROM PUBLIC;
REVOKE DELETE, TRUNCATE ON "officer_preferences" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "officer_preferences" TO app_user;

CREATE TRIGGER "trigger_audit_officer_preferences"
  AFTER INSERT OR UPDATE OR DELETE ON "officer_preferences"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach', 'application_draft', 'aadhaar_authentication',
  'renewal', 'officer_preference'));
