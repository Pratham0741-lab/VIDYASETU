-- Phase 17 Part E: who viewed or downloaded which document, when, through
-- which route. No personal data: ids, the route pattern, the actor's account
-- and role, the application's jurisdiction (for scoping who may read it).
--
-- Logged (one row per successful response, in the request's own actor
-- transaction - if the row cannot be written the view fails):
--   LIST      GET /applications/:id/documents           (application_id)
--   VIEW      GET /documents/:id                        (document_id)
--   CROP      GET /applications/:id/deficiencies/items/:itemId/crop
--   VIEW      GET /sanction-orders/:id                  (sanction order)
--   DOWNLOAD  GET /sanction-orders/:id/pdf
-- A refused access is an authorization denial (authorization_denials),
-- recorded by the exception filter: 403 as before, and - for these routes
-- only - a 404 as DOCUMENT_NOT_ACCESSIBLE (the caller still just sees 404).
--
-- Insert-only for app_user; the row must name the actor itself (RLS WITH
-- CHECK). Read: officers under the jurisdiction rule on the row's own
-- columns (as authorization_denials), the applicant never. Audited (the
-- audit chain makes it tamper-evident). Deliberately WITHOUT the M32 AUDITOR
-- trigger: an AUDITOR's view, should one ever be allowed, must be logged.

CREATE TABLE "document_access_log" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accessed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_account_id" UUID NOT NULL,
  "actor_role" TEXT NOT NULL,
  "access_kind" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "document_id" UUID,
  "route" TEXT NOT NULL,
  "request_id" TEXT,
  "jurisdiction_state" TEXT,
  "jurisdiction_district" TEXT,
  CONSTRAINT "document_access_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_access_log_kind_check" CHECK ("access_kind" IN ('LIST', 'VIEW', 'CROP', 'DOWNLOAD')),
  CONSTRAINT "document_access_log_resource_check" CHECK ("resource_type" IN (
    'application_documents', 'document', 'deficiency_item_crop', 'sanction_order', 'sanction_order_pdf')),
  CONSTRAINT "document_access_log_route_check" CHECK ("route" ~ '^(GET|POST) /api/v1/[A-Za-z0-9/:_-]+$')
);
CREATE INDEX "document_access_log_document_idx" ON "document_access_log" ("document_id", "accessed_at" DESC);
CREATE INDEX "document_access_log_application_idx" ON "document_access_log" ("application_id", "accessed_at" DESC);
CREATE INDEX "document_access_log_actor_idx" ON "document_access_log" ("actor_account_id", "accessed_at" DESC);
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_actor_account_id_fkey"
  FOREIGN KEY ("actor_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_access_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "self_document_access_log_insert" ON "document_access_log" FOR INSERT
  WITH CHECK ("actor_account_id" = NULLIF(current_setting('app.actor_id', true), '')::uuid
              AND "actor_role" = NULLIF(current_setting('app.actor_role', true), ''));

CREATE POLICY "officer_jurisdiction_document_access_log_read" ON "document_access_log" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "officers" o
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "document_access_log".jurisdiction_state = o.jurisdiction_state)
            OR ("document_access_log".jurisdiction_state = o.jurisdiction_state
                AND "document_access_log".jurisdiction_district = o.jurisdiction_district))));

REVOKE ALL ON "document_access_log" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "document_access_log" FROM app_user;
GRANT SELECT, INSERT ON "document_access_log" TO app_user;

CREATE TRIGGER "trigger_audit_document_access_log" AFTER INSERT OR UPDATE OR DELETE ON "document_access_log"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- Retention fixtures (Part C) are notifications and refresh tokens: taggable too.
ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach', 'application_draft', 'aadhaar_authentication',
  'renewal', 'officer_preference', 'consent_record', 'correction_request', 'correction_decision',
  'erasure_request', 'document_access', 'retention_run', 'notification', 'refresh_token'));
