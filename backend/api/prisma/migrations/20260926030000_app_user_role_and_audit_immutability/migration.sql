-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926030000_app_user_role_and_audit_immutability
--
-- A. Dedicated non-superuser runtime role `app_user` for the api.
-- B. Trigger-level immutability for audit_logs, independent of privileges.
-- C. Audit hash-chain reads actor / IP from app.* settings instead of the
--    Supabase/PostgREST request.* settings nothing in this stack sets.
--
-- Runs as the migration-owner role (compose POSTGRES_USER), which owns every
-- table. app_user's password is deliberately NOT in this file: `prisma
-- migrate deploy` runs SQL verbatim, so the db-migrate runner sets it right
-- after this migration from POSTGRES_APP_PASSWORD
-- (api/scripts/set-app-user-password.ts), the same way minio-init applies
-- its service-account secret. Until then app_user has no password and
-- cannot log in.
-- ============================================================================


-- ============================================================================
-- PART A: app_user runtime role
-- ============================================================================

-- A1. Roles are cluster-wide: create once, then (re)assert the attributes so
-- a pre-existing app_user can never keep elevated rights.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN;
  END IF;
END;
$$;

ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- A2. Connect + schema usage. PostgreSQL 15+ does not grant CREATE on the
-- public schema to PUBLIC, so app_user cannot create or alter objects.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END;
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- A3. Data access: read/write on every application table ...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ... except audit_logs, which is read-only for app_user.
-- app_user does NOT need INSERT on audit_logs: every audit row is written by
-- process_audit_log_hash_chain(), a SECURITY DEFINER function owned by the
-- migration owner, so the INSERT runs with the owner's privileges.
REVOKE INSERT, TRUNCATE ON "audit_logs" FROM app_user;

-- Stated explicitly (also present, guarded, in migration 20260926020000).
-- Note: that earlier guarded REVOKE could never fire on a fresh database,
-- because it runs before this migration creates app_user; this is the
-- statement that actually takes effect.
REVOKE UPDATE, DELETE ON "audit_logs" FROM app_user;

-- Prisma's migration bookkeeping is not application data.
REVOKE ALL ON "_prisma_migrations" FROM app_user;

-- A4. Future tables/sequences created by the migration owner (the role
-- running this file) automatically get the same grants. Tables that must be
-- read-only for app_user (like audit_logs) still need an explicit REVOKE in
-- the migration that creates them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- A5. Row-Level Security: no change needed. The 7 policy-protected tables
-- (applications, documents, decision_records, deficiencies, scores,
-- selections, disbursements) have ENABLE ROW LEVEL SECURITY. ENABLE applies
-- policies to every role except the table owner and roles with BYPASSRLS;
-- app_user is neither, so ENABLE is sufficient. FORCE ROW LEVEL SECURITY
-- would only add the owner, and a superuser owner bypasses RLS regardless.
-- Consequence: with no app.actor_id set, app_user sees and can write zero
-- rows in those 7 tables (policies fail closed).


-- ============================================================================
-- PART B: audit_logs is append-only for EVERY role
-- ============================================================================
-- Independent of GRANT/REVOKE: fires for the owner and superusers too.
-- Limits (by PostgreSQL design, not fixable in SQL): a superuser can still
-- ALTER TABLE ... DISABLE TRIGGER or SET session_replication_role = replica.
-- The SHA-256 hash chain is what makes such tampering detectable.
-- Side effect: audit_logs.actor_id -> officers(id) is ON DELETE SET NULL /
-- ON UPDATE CASCADE; both would UPDATE audit rows, so deleting or re-keying
-- an officer who has audit history is now rejected (deactivate instead).
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not allowed (trigger %, enforced for every role including owner and superuser)',
    TG_OP, TG_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_audit_log_mutation ON "audit_logs";
CREATE TRIGGER trigger_prevent_audit_log_mutation
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_log_mutation();

-- TRUNCATE bypasses row-level triggers, so block it with a statement trigger.
DROP TRIGGER IF EXISTS trigger_prevent_audit_log_truncate ON "audit_logs";
CREATE TRIGGER trigger_prevent_audit_log_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_audit_log_mutation();


-- ============================================================================
-- PART C: audit hash chain reads actor / IP from app.* settings
-- ============================================================================
-- Identical to the 20260926020000 definition except the actor/IP block,
-- which now uses the same current_setting('app.*', true) + NULLIF pattern
-- as the RLS policies (a pooled connection reads '' after an earlier
-- SET LOCAL, and ''::uuid would raise).
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
    v_actor_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('app.actor_role', true), '');
  v_ip_address := NULLIF(current_setting('app.request_ip', true), '');

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
