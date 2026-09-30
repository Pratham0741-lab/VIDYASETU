-- Phase 14 loose ends, Part A follow-up: audit real changes to schemes only.
--
-- 20261001090000 put the audit trigger on schemes. The seed (run by the
-- db-migrate service before every api start) upserts each seeded scheme with
-- unchanged values, which only moves updated_at - and each start wrote five
-- audit rows that record nothing. The trigger is recreated with a WHEN
-- condition: an UPDATE is audited when any column other than updated_at
-- changes. INSERT and DELETE are audited as before. The audit function and
-- the chain design are unchanged.

DROP TRIGGER IF EXISTS "trigger_audit_schemes" ON "schemes";
CREATE TRIGGER "trigger_audit_schemes"
  AFTER INSERT OR DELETE ON "schemes"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_schemes_update"
  AFTER UPDATE ON "schemes"
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at'))
  EXECUTE FUNCTION process_audit_log_hash_chain();
