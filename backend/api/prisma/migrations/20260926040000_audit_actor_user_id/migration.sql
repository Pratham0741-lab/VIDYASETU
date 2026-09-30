-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926040000_audit_actor_user_id
--
-- Separates the two meanings that app.actor_id previously had:
--   * app.actor_id is the acting user's id (what the RLS policies compare
--     with officers.user_id / applicants.user_id).
--   * audit_logs.actor_id is an officers.id (FK to officers).
-- An applicant acting on their own application has no officers row, so
-- writing app.actor_id straight into the FK column failed. The raw user id
-- now goes to the new, FK-free actor_user_id column; actor_id is filled
-- only when that user id belongs to an officer.
-- ============================================================================

-- 1. Raw acting user id: always safe to store (no foreign key).
ALTER TABLE "audit_logs" ADD COLUMN "actor_user_id" UUID;

-- 2. Database-derived actor classification. app.actor_role is asserted by
-- the application and may be missing or wrong, so on its own it cannot tell
-- "applicant" apart from "officer whose officers row is missing". The trigger
-- sets actor_type from what the database actually finds:
--   OFFICER   - an officers row has user_id = actor_user_id (actor_id set)
--   APPLICANT - no officers row, but an applicants row has that user_id
--   UNKNOWN   - an actor was set but matches neither (an anomaly to investigate)
--   NULL      - no actor set (system / migration / seed writes)
ALTER TABLE "audit_logs" ADD COLUMN "actor_type" TEXT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_type_check"
  CHECK ("actor_type" IS NULL OR "actor_type" IN ('OFFICER', 'APPLICANT', 'UNKNOWN'));

COMMENT ON COLUMN "audit_logs"."actor_user_id" IS
  'Acting user id from app.actor_id, stored unconditionally (no FK).';
COMMENT ON COLUMN "audit_logs"."actor_type" IS
  'Set by process_audit_log_hash_chain() from officers/applicants lookups: OFFICER, APPLICANT, UNKNOWN, or NULL when no actor was set.';
COMMENT ON COLUMN "audit_logs"."actor_id" IS
  'officers.id of the actor when the acting user is an officer, else NULL. May be deprecated in a later phase once nothing depends on the officers foreign key; prefer actor_user_id.';

-- 3. Primary lookup path for "what did this user do".
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- 4. Hash-chain trigger: identical to the 20260926030000 definition except
-- for the actor block and the two new INSERT columns.
CREATE OR REPLACE FUNCTION process_audit_log_hash_chain()
RETURNS TRIGGER
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_prev_hash TEXT;
  v_record_hash TEXT;
  v_row_json TEXT;
  v_row_data JSONB;
  v_record_id UUID;
  v_action TEXT;
  v_actor_id UUID;
  v_actor_user_id UUID;
  v_actor_type TEXT;
  v_actor_role TEXT;
  v_ip_address TEXT;
BEGIN
  -- Advisory transaction lock prevents concurrent chain-forking
  PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));

  v_action := TG_OP;

  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_row_json := row_to_json(OLD)::text;
    v_row_data := row_to_json(OLD)::jsonb;
  ELSE
    v_record_id := NEW.id;
    v_row_json := row_to_json(NEW)::text;
    v_row_data := row_to_json(NEW)::jsonb;
  END IF;

  -- These stay NULL until the api sets app.actor_id / app.actor_role / app.request_ip per transaction, which will not happen until authentication exists (a later phase).
  BEGIN
    v_actor_user_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_user_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('app.actor_role', true), '');
  v_ip_address := NULLIF(current_setting('app.request_ip', true), '');

  -- Resolve the actor from database facts. Never raises: a non-officer
  -- actor simply leaves actor_id NULL. Runs as the function owner
  -- (SECURITY DEFINER), so the lookups are not filtered by RLS.
  IF v_actor_user_id IS NOT NULL THEN
    SELECT o.id INTO v_actor_id
    FROM "officers" o
    WHERE o.user_id = v_actor_user_id;

    IF v_actor_id IS NOT NULL THEN
      v_actor_type := 'OFFICER';
    ELSIF EXISTS (SELECT 1 FROM "applicants" a WHERE a.user_id = v_actor_user_id) THEN
      v_actor_type := 'APPLICANT';
    ELSE
      v_actor_type := 'UNKNOWN';
    END IF;
  END IF;

  -- Safely fetch latest hash in chain
  SELECT record_hash INTO v_prev_hash
  FROM "audit_logs"
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  -- Calculate SHA-256 hash chained to predecessor
  v_record_hash := encode(digest(COALESCE(v_prev_hash, '') || v_row_json, 'sha256'), 'hex');

  -- Insert immutably into audit_logs
  INSERT INTO "audit_logs" (
    id,
    table_name,
    record_id,
    action,
    actor_id,
    actor_user_id,
    actor_type,
    actor_role,
    ip_address,
    row_data,
    prev_hash,
    record_hash,
    created_at
  ) VALUES (
    gen_random_uuid(),
    TG_TABLE_NAME,
    v_record_id,
    v_action,
    v_actor_id,
    v_actor_user_id,
    v_actor_type,
    v_actor_role,
    v_ip_address,
    v_row_data,
    v_prev_hash,
    v_record_hash,
    CURRENT_TIMESTAMP
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;
