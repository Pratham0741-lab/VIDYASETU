-- Phase 17.2: database support for the read routes the two portals need.
-- Additive: one CHECK widened (a new allowed value), one view, one function.
-- No existing table, policy, trigger or function changes.

-- ------------------------------------------------------------------ Part A
-- GET /documents/:id/file logs its views as resource_type 'document_file'
-- (the document's stored bytes, as distinct from its metadata view).
ALTER TABLE "document_access_log" DROP CONSTRAINT "document_access_log_resource_check";
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_resource_check" CHECK ("resource_type" IN (
  'application_documents', 'document', 'deficiency_item_crop', 'sanction_order', 'sanction_order_pdf',
  'document_file'));

-- ------------------------------------------------------------------ Part B
-- An application's stage history for GET /applications/:id/history.
-- workflow_transitions has no row-level security (KNOWN_LIMITATIONS M64)
-- and its metadata / triggered_by name the acting officer. This view
-- exposes only the four public facts and joins applications with
-- security_invoker, so the caller's row-level security on applications
-- decides which histories exist at all: an owner sees their own, an officer
-- those in jurisdiction, no actor nothing.
CREATE VIEW "application_history"
  WITH (security_invoker = true, security_barrier = true) AS
  SELECT t.id,
         t.application_id,
         t.from_stage,
         t.to_stage,
         t.trigger_action,
         t.created_at AS at
    FROM workflow_transitions t
    JOIN applications a ON a.id = t.application_id;

REVOKE ALL ON "application_history" FROM PUBLIC;
GRANT SELECT ON "application_history" TO app_user;

-- ------------------------------------------------------------------ Part E
-- GET /auth/me shows an officer their own name and institution code.
-- officers has no row-level security (M64); this function returns only the
-- row of the officer the transaction's actor is, and nothing without one.
CREATE OR REPLACE FUNCTION current_officer_profile()
RETURNS TABLE (name TEXT, institution_code TEXT)
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
  SELECT o.name, o.institution_code
    FROM officers o
   WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
     AND o.is_active = true;
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION current_officer_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_officer_profile() TO app_user;
