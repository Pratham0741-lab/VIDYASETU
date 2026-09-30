-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926010000_fixes_jsonschema_hashchain_refs
--
-- FIXES INCLUDED:
-- 1. pg_jsonschema preflight verification & graceful PL/pgSQL fallback validation
-- 2. Audit hash-chain race condition resolution via pg_advisory_xact_lock
-- 3. Actionable error messaging and setup instructions for app.pii_key
-- 4. Referential integrity trigger for scheme_code on selections & notice_templates
-- ============================================================================

-- ============================================================================
-- TASK 3: REQUIRED MANUAL SETUP FOR PII ENCRYPTION
-- ============================================================================
-- REQUIRED MANUAL STEP before first use of encrypt_pii/decrypt_pii:
-- ALTER DATABASE your_db_name SET app.pii_key = 'replace-with-a-strong-secret-from-a-vault';
--
-- For local psql / testing sessions:
-- SET app.pii_key = 'replace-with-a-strong-secret-from-a-vault';
--
-- For Supabase: run this via the SQL editor once, or set it via Supabase Vault
-- and reference it in the function:
-- ALTER DATABASE postgres SET app.pii_key = 'your-secure-encryption-key-phrase';
-- ============================================================================


-- ============================================================================
-- TASK 1: VERIFY AND CORRECT pg_jsonschema FUNCTION CALL & FALLBACK
-- ============================================================================

-- 1. Diagnostic preflight query to inspect available json-schema validation routines:
-- Run manually in psql/Supabase to verify installed signatures:
-- SELECT proname, pronargs FROM pg_proc WHERE proname ILIKE '%jsonschema%' OR proname ILIKE '%matches_schema%';

-- 2. Attempt to enable pg_jsonschema extension (may not be supported on all Supabase tiers)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_jsonschema;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Extension pg_jsonschema could not be installed or is restricted: %', SQLERRM;
END;
$$;

-- 3. Define the pure PL/pgSQL fallback validator function.
-- Marked IMMUTABLE so PostgreSQL permits its usage inside CHECK constraints.
CREATE OR REPLACE FUNCTION is_valid_scheme_config(c jsonb)
RETURNS boolean AS $$
BEGIN
  -- Root must be a non-null JSON object
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
    RETURN FALSE;
  END IF;

  -- Verify all 7 required top-level keys exist using the ? operator
  IF NOT (
    c ? 'income_limit_annual' AND
    c ? 'eligible_categories' AND
    c ? 'eligible_education_level' AND
    c ? 'benefit_structure' AND
    c ? 'duration' AND
    c ? 'required_documents' AND
    c ? 'fund_sharing_ratio'
  ) THEN
    RETURN FALSE;
  END IF;

  -- 1. income_limit_annual: must be a number or null
  IF jsonb_typeof(c->'income_limit_annual') NOT IN ('number', 'null') THEN
    RETURN FALSE;
  END IF;

  -- 2. eligible_categories: must be an array
  IF jsonb_typeof(c->'eligible_categories') <> 'array' THEN
    RETURN FALSE;
  END IF;

  -- 3. eligible_education_level: must be a string
  IF jsonb_typeof(c->'eligible_education_level') <> 'string' THEN
    RETURN FALSE;
  END IF;

  -- 4. benefit_structure: must be a nested object (permissive structure for scheme variations)
  IF jsonb_typeof(c->'benefit_structure') <> 'object' THEN
    RETURN FALSE;
  END IF;

  -- 5. duration: must be a string
  IF jsonb_typeof(c->'duration') <> 'string' THEN
    RETURN FALSE;
  END IF;

  -- 6. required_documents: must be an array
  IF jsonb_typeof(c->'required_documents') <> 'array' THEN
    RETURN FALSE;
  END IF;

  -- 7. fund_sharing_ratio: must be a string or null
  IF jsonb_typeof(c->'fund_sharing_ratio') NOT IN ('string', 'null') THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4. Intelligently apply the CHECK constraint based on available database capabilities
DO $$
DECLARE
  v_has_pg_jsonschema BOOLEAN := FALSE;
BEGIN
  -- Check if native json_matches_schema routine exists in pg_proc
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'json_matches_schema'
  ) INTO v_has_pg_jsonschema;

  -- Drop existing constraint to allow idempotent upgrade
  ALTER TABLE "scheme_versions" DROP CONSTRAINT IF EXISTS "check_scheme_versions_config_schema";

  IF v_has_pg_jsonschema THEN
    -- PATH A: Native pg_jsonschema available
    RAISE NOTICE '>>> Applying PATH A: Native pg_jsonschema json_matches_schema() constraint on scheme_versions.config.';
    ALTER TABLE "scheme_versions"
    ADD CONSTRAINT "check_scheme_versions_config_schema"
    CHECK (
      json_matches_schema(
        '{
          "type": "object",
          "required": [
            "income_limit_annual",
            "eligible_categories",
            "eligible_education_level",
            "benefit_structure",
            "duration",
            "required_documents",
            "fund_sharing_ratio"
          ],
          "properties": {
            "income_limit_annual": { "type": ["number", "null"] },
            "eligible_categories": { "type": "array" },
            "eligible_education_level": { "type": "string" },
            "benefit_structure": { "type": "object", "additionalProperties": true },
            "duration": { "type": "string" },
            "required_documents": { "type": "array" },
            "fund_sharing_ratio": { "type": ["string", "null"] }
          }
        }'::json,
        config::json
      )
    );
  ELSE
    -- PATH B: Extension unavailable; use PL/pgSQL validator fallback
    RAISE NOTICE '>>> Applying PATH B: Extension pg_jsonschema not found. Using is_valid_scheme_config(config) fallback constraint.';
    ALTER TABLE "scheme_versions"
    ADD CONSTRAINT "check_scheme_versions_config_schema"
    CHECK (is_valid_scheme_config(config));
  END IF;
END;
$$;


-- ============================================================================
-- TASK 2: FIX AUDIT HASH-CHAIN RACE CONDITION WITH ADVISORY LOCK
-- ============================================================================

CREATE OR REPLACE FUNCTION process_audit_log_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
  v_prev_hash TEXT;
  v_record_hash TEXT;
  v_row_json TEXT;
  v_row_data JSONB;
  v_record_id UUID;
  v_action TEXT;
  v_actor_id UUID;
  v_actor_role TEXT;
BEGIN
  -- CRITICAL RACE CONDITION FIX:
  -- Acquire an exclusive Postgres transaction-level advisory lock on the audit chain.
  -- This serializes all concurrent trigger executions across transactions, ensuring
  -- sequential read of v_prev_hash and eliminating chain-forking under high concurrency.
  -- The lock automatically releases when the encompassing transaction commits or rolls back.
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

  -- Extract Supabase authenticated user ID and role if present
  BEGIN
    v_actor_id := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  -- Safely fetch latest hash in chain (guaranteed race-free under the advisory lock)
  SELECT record_hash INTO v_prev_hash
  FROM "audit_logs"
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  -- Calculate SHA-256 hash chained to the predecessor
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
    NULL,
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rebind triggers idempotently across all auditable tables
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


-- ============================================================================
-- TASK 3: ACTIONABLE ERROR MESSAGING FOR PII FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION encrypt_pii(raw_text TEXT)
RETURNS BYTEA AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF raw_text IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PII encryption failed: "app.pii_key" is not configured. Required manual setup step: Run "ALTER DATABASE <dbname> SET app.pii_key = ''<strong-secret>'';" (or SET app.pii_key = ''...''; for session) and reconnect.';
  END IF;

  RETURN pgp_sym_encrypt(raw_text, v_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrypt_pii(encrypted_data BYTEA)
RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF encrypted_data IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.pii_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'PII decryption failed: "app.pii_key" is not configured. Required manual setup step: Run "ALTER DATABASE <dbname> SET app.pii_key = ''<strong-secret>'';" (or SET app.pii_key = ''...''; for session) and reconnect.';
  END IF;

  RETURN pgp_sym_decrypt(encrypted_data, v_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- TASK 4: REFERENTIAL INTEGRITY FOR scheme_code STRING FIELDS
-- ============================================================================

-- Ensure schemes.code has a unique index for lookup integrity
CREATE UNIQUE INDEX IF NOT EXISTS "schemes_code_key" ON "schemes"("code");

-- Trigger function enforcing referential integrity back to schemes.code
CREATE OR REPLACE FUNCTION validate_scheme_code_reference()
RETURNS TRIGGER AS $$
BEGIN
  -- notice_templates.scheme_code is nullable for generic templates; selections.scheme_code is required
  IF NEW.scheme_code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "schemes" WHERE "code" = NEW.scheme_code) THEN
      RAISE EXCEPTION 'Referential integrity violation: scheme_code "%" does not exist in schemes.code (Target Table: %, Record ID: %)',
        NEW.scheme_code, TG_TABLE_NAME, NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to selections table
DROP TRIGGER IF EXISTS trigger_validate_scheme_code_selections ON "selections";
CREATE TRIGGER trigger_validate_scheme_code_selections
BEFORE INSERT OR UPDATE ON "selections"
FOR EACH ROW
EXECUTE FUNCTION validate_scheme_code_reference();

-- Attach trigger to notice_templates table
DROP TRIGGER IF EXISTS trigger_validate_scheme_code_notice_templates ON "notice_templates";
CREATE TRIGGER trigger_validate_scheme_code_notice_templates
BEFORE INSERT OR UPDATE ON "notice_templates"
FOR EACH ROW
EXECUTE FUNCTION validate_scheme_code_reference();
