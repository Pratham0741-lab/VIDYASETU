-- Phase 14 (loose ends) Part A: scheme authoring through the API (plan Phase 4).
--
-- Until now schemes and versions came from the seed only. The api now
-- creates schemes and DRAFT versions, edits drafts, publishes and retires.
--
-- 1. scheme_versions.status gains 'draft' and a CHECK (the column was free
--    text; every existing row is 'active' or 'archived').
-- 2. A published version is immutable: once a version has left 'draft' its
--    config, scheme and number never change, it never returns to 'draft' and
--    it is never deleted. The Phase 1 trigger (prevent_locked_scheme_version_update)
--    locks config only once an application references the version, and
--    counts applications under the caller's row-level security; this trigger
--    is status-based and needs no count. Both stay. Lifecycle columns
--    (status active <-> archived, effective_to) remain writable: that is how
--    a version is retired or superseded (as the seed already does).
-- 3. schemes gets the audit trigger scheme_versions already has.
--
-- Additive: one CHECK, one new function and two new triggers. No existing
-- migration, function or trigger is changed.

ALTER TABLE "scheme_versions"
  ADD CONSTRAINT "scheme_versions_status_check" CHECK ("status" IN ('draft', 'active', 'archived'));

CREATE OR REPLACE FUNCTION scheme_version_publication_lock()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'SCHEME_VERSION_PUBLISHED: version % (v%) is published and cannot be deleted', OLD.id, OLD.version_no
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.config IS DISTINCT FROM OLD.config
       OR NEW.scheme_id IS DISTINCT FROM OLD.scheme_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.status = 'draft' THEN
      RAISE EXCEPTION 'SCHEME_VERSION_PUBLISHED: version % (v%) is published; its config, scheme and number cannot change and it cannot return to draft. Author a new version instead.', OLD.id, OLD.version_no
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trigger_scheme_version_publication_lock"
  BEFORE UPDATE OR DELETE ON "scheme_versions"
  FOR EACH ROW EXECUTE FUNCTION scheme_version_publication_lock();

CREATE TRIGGER "trigger_audit_schemes"
  AFTER INSERT OR UPDATE OR DELETE ON "schemes"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
