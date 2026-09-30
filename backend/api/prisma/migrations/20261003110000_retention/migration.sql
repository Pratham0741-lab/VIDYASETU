-- Phase 17 Part C: data retention.
--
-- Three data classes, each with its own retention period (config; 0 = never
-- purged), and nothing else:
--   notifications       delivered or failed (never PENDING) and older than
--                        the period - the stored copy of a notice, sensitive
--                        parameters already redacted. Not audited.
--   refresh_tokens      expired or revoked longer ago than the period. Not
--                        audited (hashes only).
--   application_drafts  abandoned drafts (status DRAFT) not touched for the
--                        period. Audited: each deleted draft gets a DELETE
--                        row in audit_logs, which keeps the draft's content -
--                        the audit log is append-only and never pruned.
-- Kept whatever their age: anything whose application has an open grievance
-- (OPEN / IN_PROGRESS) or an open deficiency (OPEN / RESUBMITTED / OVERDUE,
-- old or itemised). A draft has no application; a notification may.
-- Never touched, by construction (retention_apply() names only the three
-- tables above): audit_logs, authorization_denials, decision records, final
-- selection lists, sanction orders, disbursements, applicants, documents,
-- pii_match_index.
--
-- retention_apply() is the only writer: SECURITY DEFINER, callable only as the
-- SYSTEM actor (app.actor_role = SYSTEM, no actor id), like
-- sla_record_breaches(). A dry run counts and deletes nothing. Every run -
-- dry or real - inserts one retention_runs row: cutoffs and counts only,
-- never a row id or a value. retention_runs is insert-only and audited.

CREATE TABLE "retention_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trigger" TEXT NOT NULL,
  -- NULL: the scheduled job; else the SUPER_ADMIN account that ran it by hand.
  "triggered_by_account_id" UUID,
  "dry_run" BOOLEAN NOT NULL,
  "run_at" TIMESTAMPTZ(6) NOT NULL,
  -- {class: {days, cutoff}}; a class with days = 0 is not purged.
  "policy" JSONB NOT NULL,
  -- {class: {eligible, protected, deleted}} - counts only.
  "counts" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "retention_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_runs_trigger_check" CHECK ("trigger" IN ('SCHEDULE', 'MANUAL')),
  CONSTRAINT "retention_runs_dry_run_deleted_check" CHECK (
    NOT "dry_run" OR (
      coalesce(("counts"->'notifications'->>'deleted')::int, 0) = 0
      AND coalesce(("counts"->'refresh_tokens'->>'deleted')::int, 0) = 0
      AND coalesce(("counts"->'application_drafts'->>'deleted')::int, 0) = 0))
);
CREATE INDEX "retention_runs_run_at_idx" ON "retention_runs" ("run_at" DESC);
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_triggered_by_account_id_fkey"
  FOREIGN KEY ("triggered_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Counts only: readable by the application; written only by retention_apply().
GRANT SELECT ON "retention_runs" TO app_user;

CREATE TRIGGER "trigger_audit_retention_runs"
  AFTER INSERT OR UPDATE OR DELETE ON "retention_runs"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- M32 (20261003100000): the AUDITOR may not write here either.
CREATE TRIGGER trigger_refuse_auditor_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
  ON "retention_runs" FOR EACH STATEMENT EXECUTE FUNCTION refuse_auditor_writes();

CREATE OR REPLACE FUNCTION retention_apply(
  p_now TIMESTAMPTZ,
  p_dry_run BOOLEAN,
  p_notifications_days INT,
  p_refresh_tokens_days INT,
  p_drafts_days INT,
  p_trigger TEXT,
  p_triggered_by UUID
)
RETURNS TABLE (run_id UUID, policy JSONB, counts JSONB)
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  v_n_cut TIMESTAMPTZ := CASE WHEN p_notifications_days > 0 THEN p_now - make_interval(days => p_notifications_days) END;
  v_t_cut TIMESTAMPTZ := CASE WHEN p_refresh_tokens_days > 0 THEN p_now - make_interval(days => p_refresh_tokens_days) END;
  v_d_cut TIMESTAMPTZ := CASE WHEN p_drafts_days > 0 THEN p_now - make_interval(days => p_drafts_days) END;
  n_elig INT := 0; n_prot INT := 0; n_del INT := 0;
  t_elig INT := 0; t_del INT := 0;
  d_elig INT := 0; d_del INT := 0;
  v_policy JSONB;
  v_counts JSONB;
  v_id UUID;
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'retention_apply may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  IF p_trigger NOT IN ('SCHEDULE', 'MANUAL') THEN
    RAISE EXCEPTION 'retention_apply: trigger must be SCHEDULE or MANUAL';
  END IF;

  -- notifications -----------------------------------------------------------
  IF v_n_cut IS NOT NULL THEN
    CREATE TEMP TABLE _ret_n ON COMMIT DROP AS
      SELECT n.id,
             (n.application_id IS NOT NULL AND (
                EXISTS (SELECT 1 FROM grievances g WHERE g.application_id = n.application_id
                         AND g.status IN ('OPEN', 'IN_PROGRESS'))
                OR EXISTS (SELECT 1 FROM deficiencies d WHERE d.application_id = n.application_id
                         AND d.status IN ('OPEN', 'RESUBMITTED', 'OVERDUE'))
                OR EXISTS (SELECT 1 FROM deficiency_items di WHERE di.application_id = n.application_id
                         AND di.status IN ('OPEN', 'RESUBMITTED', 'OVERDUE')))) AS protected
        FROM notifications n
       WHERE n.created_at < v_n_cut AND n.status IN ('SENT', 'FAILED');
    SELECT count(*) FILTER (WHERE NOT protected), count(*) FILTER (WHERE protected)
      INTO n_elig, n_prot FROM _ret_n;
    IF NOT p_dry_run THEN
      DELETE FROM notifications WHERE id IN (SELECT id FROM _ret_n WHERE NOT protected);
      GET DIAGNOSTICS n_del = ROW_COUNT;
    END IF;
  END IF;

  -- refresh_tokens ----------------------------------------------------------
  IF v_t_cut IS NOT NULL THEN
    SELECT count(*) INTO t_elig FROM refresh_tokens
     WHERE expires_at < v_t_cut OR revoked_at < v_t_cut;
    IF NOT p_dry_run THEN
      DELETE FROM refresh_tokens WHERE expires_at < v_t_cut OR revoked_at < v_t_cut;
      GET DIAGNOSTICS t_del = ROW_COUNT;
    END IF;
  END IF;

  -- application_drafts (abandoned only; a draft has no application) --------
  IF v_d_cut IS NOT NULL THEN
    SELECT count(*) INTO d_elig FROM application_drafts
     WHERE status = 'DRAFT' AND updated_at < v_d_cut;
    IF NOT p_dry_run THEN
      DELETE FROM application_drafts WHERE status = 'DRAFT' AND updated_at < v_d_cut;
      GET DIAGNOSTICS d_del = ROW_COUNT;
    END IF;
  END IF;

  v_policy := jsonb_build_object(
    'notifications', jsonb_build_object('days', p_notifications_days, 'cutoff', v_n_cut),
    'refresh_tokens', jsonb_build_object('days', p_refresh_tokens_days, 'cutoff', v_t_cut),
    'application_drafts', jsonb_build_object('days', p_drafts_days, 'cutoff', v_d_cut));
  v_counts := jsonb_build_object(
    'notifications', jsonb_build_object('eligible', n_elig, 'protected', n_prot, 'deleted', n_del),
    'refresh_tokens', jsonb_build_object('eligible', t_elig, 'protected', 0, 'deleted', t_del),
    'application_drafts', jsonb_build_object('eligible', d_elig, 'protected', 0, 'deleted', d_del));

  INSERT INTO retention_runs ("trigger", triggered_by_account_id, dry_run, run_at, policy, counts)
  VALUES (p_trigger, p_triggered_by, p_dry_run, p_now, v_policy, v_counts)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_policy, v_counts;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION retention_apply(TIMESTAMPTZ, BOOLEAN, INT, INT, INT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_apply(TIMESTAMPTZ, BOOLEAN, INT, INT, INT, TEXT, UUID) TO app_user;
