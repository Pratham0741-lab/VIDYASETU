-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926020000_config_predicate_format_and_hardening
--
-- REVISION OVERVIEW:
-- 1. TASK 1: Upgrade scheme_versions.config validation to predicate/rules format
-- 2. TASK 2: scheme_versions immutability trigger for referenced versions
-- 3. TASK 3: Audit log security hardening (REVOKE, IP tracking, expanded triggers)
-- 4. TASK 4: Deprecation notice for DB-side pgcrypto functions (moved to Node AES-GCM)
-- 5. TASK 6: Enforce SET search_path = public, pg_temp on all SECURITY DEFINER functions
-- ============================================================================


-- ============================================================================
-- TASK 1: UPDATE SCHEME_VERSIONS.CONFIG VALIDATION TO PREDICATE/RULES SHAPE
-- ============================================================================
-- Canonical source: schemas/scheme-config.schema.json
-- Validates:
--   - "rules": array of rule objects (id, type, expr, params, doc_refs, message_key)
--   - "benefits": array of entitlement objects
--   - "required_documents": array of document type strings
--   - "fund_sharing_ratio": string or null

-- 1. Updated PL/pgSQL fallback validator function
CREATE OR REPLACE FUNCTION is_valid_scheme_config(c jsonb)
RETURNS boolean
SET search_path = public, pg_temp
IMMUTABLE
AS $$
DECLARE
  v_rule jsonb;
BEGIN
  -- Root must be a non-null JSON object
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
    RETURN FALSE;
  END IF;

  -- 1. Verify required top-level keys exist
  IF NOT (
    c ? 'rules' AND
    c ? 'benefits' AND
    c ? 'required_documents' AND
    c ? 'fund_sharing_ratio'
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Verify top-level data types
  IF jsonb_typeof(c->'rules') <> 'array' THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(c->'benefits') <> 'array' THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(c->'required_documents') <> 'array' THEN
    RETURN FALSE;
  END IF;

  IF jsonb_typeof(c->'fund_sharing_ratio') NOT IN ('string', 'null') THEN
    RETURN FALSE;
  END IF;

  -- 3. Validate each rule in rules array
  FOR v_rule IN SELECT * FROM jsonb_array_elements(c->'rules')
  LOOP
    IF jsonb_typeof(v_rule) <> 'object' THEN
      RETURN FALSE;
    END IF;

    -- Each rule requires: id, type, expr, params, doc_refs, message_key
    IF NOT (
      v_rule ? 'id' AND
      v_rule ? 'type' AND
      v_rule ? 'expr' AND
      v_rule ? 'params' AND
      v_rule ? 'doc_refs' AND
      v_rule ? 'message_key'
    ) THEN
      RETURN FALSE;
    END IF;

    -- Rule field constraints
    IF jsonb_typeof(v_rule->'id') <> 'string' OR length(v_rule->>'id') = 0 THEN
      RETURN FALSE;
    END IF;

    IF jsonb_typeof(v_rule->'type') <> 'string' THEN
      RETURN FALSE;
    END IF;

    -- expr must be a non-empty string
    IF jsonb_typeof(v_rule->'expr') <> 'string' OR length(trim(v_rule->>'expr')) = 0 THEN
      RETURN FALSE;
    END IF;

    -- params must be an object
    IF jsonb_typeof(v_rule->'params') <> 'object' THEN
      RETURN FALSE;
    END IF;

    -- doc_refs must be an array
    IF jsonb_typeof(v_rule->'doc_refs') <> 'array' THEN
      RETURN FALSE;
    END IF;

    -- message_key must be a non-empty string
    IF jsonb_typeof(v_rule->'message_key') <> 'string' OR length(v_rule->>'message_key') = 0 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 2. Apply updated CHECK constraint idempotently based on pg_jsonschema availability
DO $$
DECLARE
  v_has_pg_jsonschema BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'json_matches_schema'
  ) INTO v_has_pg_jsonschema;

  -- Drop previous version of constraint
  ALTER TABLE "scheme_versions" DROP CONSTRAINT IF EXISTS "check_scheme_versions_config_schema";

  IF v_has_pg_jsonschema THEN
    RAISE NOTICE '>>> Applying PATH A: Native pg_jsonschema predicate format validation on scheme_versions.config.';
    ALTER TABLE "scheme_versions"
    ADD CONSTRAINT "check_scheme_versions_config_schema"
    CHECK (
      json_matches_schema(
        '{
          "type": "object",
          "required": [
            "rules",
            "benefits",
            "required_documents",
            "fund_sharing_ratio"
          ],
          "properties": {
            "rules": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "id",
                  "type",
                  "expr",
                  "params",
                  "doc_refs",
                  "message_key"
                ],
                "properties": {
                  "id": { "type": "string", "minLength": 1 },
                  "type": { "type": "string" },
                  "expr": { "type": "string", "minLength": 1 },
                  "params": { "type": "object" },
                  "doc_refs": { "type": "array" },
                  "message_key": { "type": "string", "minLength": 1 }
                }
              }
            },
            "benefits": {
              "type": "array"
            },
            "required_documents": {
              "type": "array"
            },
            "fund_sharing_ratio": {
              "type": ["string", "null"]
            }
          }
        }'::json,
        config::json
      )
    );
  ELSE
    RAISE NOTICE '>>> Applying PATH B: Extension pg_jsonschema not found. Using is_valid_scheme_config(config) predicate fallback constraint.';
    ALTER TABLE "scheme_versions"
    ADD CONSTRAINT "check_scheme_versions_config_schema"
    CHECK (is_valid_scheme_config(config));
  END IF;
END;
$$;


-- ============================================================================
-- TASK 2: SCHEME_VERSIONS IMMUTABILITY TRIGGER FOR REFERENCED VERSIONS
-- ============================================================================
-- Prevents updating scheme_versions.config once referenced by at least 1 application.
-- Allows updates to unreferenced/draft versions.

CREATE OR REPLACE FUNCTION prevent_locked_scheme_version_update()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app_count INT;
BEGIN
  -- Only enforce lock when the config JSON payload is being altered
  IF NEW.config IS DISTINCT FROM OLD.config THEN
    SELECT COUNT(*) INTO v_app_count
    FROM "applications"
    WHERE "scheme_version_id" = OLD.id;

    IF v_app_count > 0 THEN
      RAISE EXCEPTION 'Cannot update scheme_versions.config: version % is already referenced by % application(s). Immutability is enforced once live applications exist.',
        OLD.id, v_app_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_locked_scheme_version_update ON "scheme_versions";
CREATE TRIGGER trigger_prevent_locked_scheme_version_update
BEFORE UPDATE ON "scheme_versions"
FOR EACH ROW
EXECUTE FUNCTION prevent_locked_scheme_version_update();


-- ============================================================================
-- TASK 3: AUDIT LOG HARDENING (PERMISSIONS, IP TRACKING, EXPANDED TRIGGERS)
-- ============================================================================

-- 1. Revoke UPDATE and DELETE permissions on audit_logs from PUBLIC and application roles
REVOKE UPDATE, DELETE ON "audit_logs" FROM PUBLIC;

DO $$
BEGIN
  -- Revoke from application connection role placeholder
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM app_user;
  END IF;
  -- Revoke from Supabase client roles
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE UPDATE, DELETE ON "audit_logs" FROM anon;
  END IF;
END;
$$;

-- 2. Updated audit hash-chain function with IP tracking and search_path hardening
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

  -- Extract Supabase authenticated user ID and role
  BEGIN
    v_actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  -- Extract caller IP address from PostgREST headers if present
  BEGIN
    v_ip_address := NULLIF(current_setting('request.header.x-forwarded-for', true), '');
    IF v_ip_address IS NULL THEN
      v_ip_address := NULLIF((current_setting('request.headers', true)::jsonb)->>'x-forwarded-for', '');
    END IF;
    IF v_ip_address IS NULL THEN
      v_ip_address := NULLIF((current_setting('request.headers', true)::jsonb)->>'x-real-ip', '');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_ip_address := NULL;
  END;

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

-- 3. Expand audit trigger coverage to all 10 critical lifecycle tables
-- Existing 4 tables (rebound to updated function):
DROP TRIGGER IF EXISTS trigger_audit_applications ON "applications";
CREATE TRIGGER trigger_audit_applications
AFTER INSERT OR UPDATE OR DELETE ON "applications"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_documents ON "documents";
CREATE TRIGGER trigger_audit_documents
AFTER INSERT OR UPDATE OR DELETE ON "documents"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_decision_records ON "decision_records";
CREATE TRIGGER trigger_audit_decision_records
AFTER INSERT OR UPDATE OR DELETE ON "decision_records"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_disbursements ON "disbursements";
CREATE TRIGGER trigger_audit_disbursements
AFTER INSERT OR UPDATE OR DELETE ON "disbursements"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- Additional 6 tables per Task 3:
DROP TRIGGER IF EXISTS trigger_audit_selections ON "selections";
CREATE TRIGGER trigger_audit_selections
AFTER INSERT OR UPDATE OR DELETE ON "selections"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_scheme_versions ON "scheme_versions";
CREATE TRIGGER trigger_audit_scheme_versions
AFTER INSERT OR UPDATE OR DELETE ON "scheme_versions"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_workflow_transitions ON "workflow_transitions";
CREATE TRIGGER trigger_audit_workflow_transitions
AFTER INSERT OR UPDATE OR DELETE ON "workflow_transitions"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_deficiencies ON "deficiencies";
CREATE TRIGGER trigger_audit_deficiencies
AFTER INSERT OR UPDATE OR DELETE ON "deficiencies"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_renewals ON "renewals";
CREATE TRIGGER trigger_audit_renewals
AFTER INSERT OR UPDATE OR DELETE ON "renewals"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_scores ON "scores";
CREATE TRIGGER trigger_audit_scores
AFTER INSERT OR UPDATE OR DELETE ON "scores"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();


-- ============================================================================
-- TASK 4 & TASK 6: DEPRECATION NOTICE & SEARCH_PATH HARDENING FOR DB PII FUNCTIONS
-- ============================================================================
-- NOTICE: DB-side pgcrypto functions encrypt_pii and decrypt_pii are DEPRECATED.
-- New applications should use application-layer AES-256-GCM encryption implemented
-- in lib/crypto/pii.ts and the Prisma Client Extension in lib/crypto/pii-extension.ts.
--
-- These functions are preserved solely for backward compatibility with legacy scripts.
-- search_path is explicitly set to 'public, pg_temp' for security hardening.

CREATE OR REPLACE FUNCTION encrypt_pii(raw_text TEXT)
RETURNS BYTEA
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_key TEXT;
BEGIN
  -- DEPRECATION WARNING: Use application-layer AES-256-GCM in lib/crypto/pii.ts
  IF raw_text IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PII encryption failed: "app.pii_key" is not configured. Note: encrypt_pii() is DEPRECATED; use application-layer encryption in lib/crypto/pii.ts.';
  END IF;

  RETURN pgp_sym_encrypt(raw_text, v_key);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrypt_pii(encrypted_data BYTEA)
RETURNS TEXT
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_key TEXT;
BEGIN
  -- DEPRECATION WARNING: Use application-layer AES-256-GCM in lib/crypto/pii.ts
  IF encrypted_data IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PII decryption failed: "app.pii_key" is not configured. Note: decrypt_pii() is DEPRECATED; use application-layer encryption in lib/crypto/pii.ts.';
  END IF;

  RETURN pgp_sym_decrypt(encrypted_data, v_key);
END;
$$ LANGUAGE plpgsql;
