-- Phase 13A (Part B): a verifiable audit chain.
--
-- Two defects of the Phase 1 chain (docs/KNOWN_LIMITATIONS.md H7):
--   1. record_hash = sha256(prev_hash || row_to_json(NEW)::text), but the row
--      is stored as jsonb (keys reordered, whitespace and number formats
--      changed): no stored row can be recomputed (0 of 857).
--   2. the predecessor was "the row with the latest (created_at, id)", with
--      created_at = transaction start and id random: 177 forks.
--
-- From this migration on (hash_version 2):
--   * one linear chain: a gap-free seq assigned under a row lock on the
--     single-row audit_chain_head, which also holds the predecessor hash;
--     every audited write serialises on it until commit (as the advisory
--     lock did before);
--   * record_hash = sha256(hash_input), where hash_input is the canonical JSON
--     (audit_canonical_json) of the whole envelope - every column, the
--     predecessor hash and seq - and is stored, so any verifier can recompute
--     it without Postgres. api/src/audit/canonical.ts is the authoritative
--     definition of the canonical form; the verifier checks this function's
--     output against it on every row.
--
-- The 857 existing rows are LEGACY (seq NULL): never rewritten, not
-- recomputable. A CHECKPOINT row (seq 1) anchors their count, time range
-- and a digest of their canonical form.
--
-- Additive: new columns (nullable), a new table, new functions; the audit
-- trigger function keeps its name (every table's trigger still calls it) and
-- what it records. The UPDATE / DELETE / TRUNCATE guards are unchanged.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_logs"
  ADD COLUMN "seq" BIGINT,
  ADD COLUMN "hash_version" SMALLINT,
  ADD COLUMN "hash_input" TEXT;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_hash_version_check" CHECK (
    (hash_version IS NULL AND seq IS NULL AND hash_input IS NULL)
    OR (hash_version = 2 AND seq IS NOT NULL AND seq >= 1 AND hash_input IS NOT NULL)
  );
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs" ("seq");

-- ---------------------------------------------------------------------------
-- 2. Chain head: the single serialisation point and the tail anchor.
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_chain_head" (
  "id" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("id"),
  "last_seq" BIGINT NOT NULL,
  "last_hash" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
REVOKE ALL ON "audit_chain_head" FROM PUBLIC;
REVOKE ALL ON "audit_chain_head" FROM app_user;
-- The verifier (api, as app_user) compares the chain end with the head.
GRANT SELECT ON "audit_chain_head" TO app_user;
INSERT INTO "audit_chain_head" ("id", "last_seq", "last_hash") VALUES (TRUE, 0, NULL);

-- ---------------------------------------------------------------------------
-- 3. Canonical JSON (mirror of api/src/audit/canonical.ts)
--   strings : "..." ; \ and " escaped; U+0001-U+001F as \u00xx; all else literal
--   numbers : plain decimal, no exponent, no trailing fractional zeros
--   objects : keys sorted by code point (COLLATE "C" = UTF-8 byte order), no whitespace
--   arrays  : in order; true / false / null literal
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_canonical_string(s TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  r TEXT := replace(replace(s, '\', '\\'), '"', '\"');
  n INTEGER;
BEGIN
  IF r ~ '[\x01-\x1f]' THEN
    FOR n IN 1..31 LOOP
      r := replace(r, chr(n), '\u' || lpad(to_hex(n), 4, '0'));
    END LOOP;
  END IF;
  RETURN '"' || r || '"';
END;
$$;

CREATE OR REPLACE FUNCTION audit_canonical_number(x NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  t TEXT := x::text; -- numeric output never uses an exponent
BEGIN
  IF position('.' IN t) > 0 THEN
    t := rtrim(rtrim(t, '0'), '.');
  END IF;
  IF t = '-0' THEN
    t := '0';
  END IF;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION audit_canonical_json(j JSONB)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  r TEXT;
BEGIN
  IF j IS NULL THEN
    RETURN 'null';
  END IF;
  CASE jsonb_typeof(j)
    WHEN 'object' THEN
      SELECT '{' || coalesce(string_agg(audit_canonical_string(e.k) || ':' || audit_canonical_json(e.v),
                                        ',' ORDER BY e.k COLLATE "C"), '') || '}'
        INTO r FROM jsonb_each(j) AS e(k, v);
      RETURN r;
    WHEN 'array' THEN
      SELECT '[' || coalesce(string_agg(audit_canonical_json(a.v), ',' ORDER BY a.o), '') || ']'
        INTO r FROM jsonb_array_elements(j) WITH ORDINALITY AS a(v, o);
      RETURN r;
    WHEN 'string' THEN
      RETURN audit_canonical_string(j #>> '{}');
    WHEN 'number' THEN
      RETURN audit_canonical_number((j #>> '{}')::numeric);
    WHEN 'boolean' THEN
      RETURN j::text;
    ELSE
      RETURN 'null';
  END CASE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The single writer of chain rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_chain_append(
  p_table_name TEXT,
  p_record_id UUID,
  p_action TEXT,
  p_row_data JSONB,
  p_actor_id UUID,
  p_actor_user_id UUID,
  p_actor_type TEXT,
  p_actor_role TEXT,
  p_ip_address TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID := gen_random_uuid();
  v_created_at TIMESTAMPTZ := CURRENT_TIMESTAMP;
  v_last_seq BIGINT;
  v_prev_hash TEXT;
  v_seq BIGINT;
  v_input TEXT;
  v_hash TEXT;
BEGIN
  -- Serialise: the head row stays locked until this transaction ends, so
  -- the next writer sees this row as its predecessor. A REPEATABLE READ /
  -- SERIALIZABLE writer that raced gets a serialization error, never a fork.
  SELECT last_seq, last_hash INTO v_last_seq, v_prev_hash
    FROM "audit_chain_head" WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_chain_head is missing: the audit chain cannot be extended';
  END IF;
  v_seq := v_last_seq + 1;

  v_input := audit_canonical_json(jsonb_build_object(
    'action', p_action,
    'actor_id', p_actor_id,
    'actor_role', p_actor_role,
    'actor_type', p_actor_type,
    'actor_user_id', p_actor_user_id,
    'created_at_us', (extract(epoch FROM v_created_at) * 1000000)::bigint,
    'hash_version', 2,
    'id', v_id,
    'ip_address', p_ip_address,
    'prev_hash', v_prev_hash,
    'record_id', p_record_id,
    'row_data', p_row_data,
    'seq', v_seq,
    'table_name', p_table_name
  ));
  v_hash := encode(digest(v_input, 'sha256'), 'hex');

  INSERT INTO "audit_logs" (
    id, table_name, record_id, action, actor_id, actor_user_id, actor_type,
    actor_role, ip_address, row_data, prev_hash, record_hash, created_at,
    seq, hash_version, hash_input
  ) VALUES (
    v_id, p_table_name, p_record_id, p_action, p_actor_id, p_actor_user_id, p_actor_type,
    p_actor_role, p_ip_address, p_row_data, v_prev_hash, v_hash, v_created_at,
    v_seq, 2, v_input
  );

  UPDATE "audit_chain_head" SET last_seq = v_seq, last_hash = v_hash, updated_at = clock_timestamp()
   WHERE id;
END;
$$;
REVOKE ALL ON FUNCTION audit_chain_append(TEXT, UUID, TEXT, JSONB, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. The audit trigger (same name, same attachments, same recorded facts):
--    resolves the actor exactly as before, then appends through the writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_audit_log_hash_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_data JSONB;
  v_record_id UUID;
  v_actor_id UUID;
  v_actor_user_id UUID;
  v_actor_type TEXT;
  v_actor_role TEXT;
  v_ip_address TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_row_data := row_to_json(OLD)::jsonb;
  ELSE
    v_record_id := NEW.id;
    v_row_data := row_to_json(NEW)::jsonb;
  END IF;

  BEGIN
    v_actor_user_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_user_id := NULL;
  END;
  v_actor_role := NULLIF(current_setting('app.actor_role', true), '');
  v_ip_address := NULLIF(current_setting('app.request_ip', true), '');

  -- Resolve the actor from database facts (as the owner: not filtered by RLS).
  IF v_actor_user_id IS NOT NULL THEN
    SELECT o.id INTO v_actor_id FROM "officers" o WHERE o.user_id = v_actor_user_id;
    IF v_actor_id IS NOT NULL THEN
      v_actor_type := 'OFFICER';
    ELSIF EXISTS (SELECT 1 FROM "applicants" a WHERE a.user_id = v_actor_user_id) THEN
      v_actor_type := 'APPLICANT';
    ELSE
      v_actor_type := 'UNKNOWN';
    END IF;
  END IF;

  PERFORM audit_chain_append(TG_TABLE_NAME, v_record_id, TG_OP, v_row_data,
                             v_actor_id, v_actor_user_id, v_actor_type, v_actor_role, v_ip_address);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Epoch boundary: anchor the legacy rows, start the verifiable chain.
--    Legacy digest = sha256 of the newline-joined canonical JSON of every
--    legacy row (all columns, created_at as integer microseconds), ordered by
--    (created_at, id).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count BIGINT;
  v_first BIGINT;
  v_last BIGINT;
  v_digest TEXT;
BEGIN
  SELECT count(*),
         min((extract(epoch FROM created_at) * 1000000)::bigint),
         max((extract(epoch FROM created_at) * 1000000)::bigint),
         encode(digest(coalesce(string_agg(audit_canonical_json(jsonb_build_object(
           'action', action, 'actor_id', actor_id, 'actor_role', actor_role,
           'actor_type', actor_type, 'actor_user_id', actor_user_id,
           'created_at_us', (extract(epoch FROM created_at) * 1000000)::bigint,
           'id', id, 'ip_address', ip_address, 'prev_hash', prev_hash,
           'record_hash', record_hash, 'record_id', record_id,
           'row_data', row_data, 'table_name', table_name)),
           E'\n' ORDER BY created_at, id), ''), 'sha256'), 'hex')
    INTO v_count, v_first, v_last, v_digest
    FROM "audit_logs" WHERE seq IS NULL;

  PERFORM audit_chain_append(
    'audit_logs', gen_random_uuid(), 'CHECKPOINT',
    jsonb_build_object(
      'kind', 'LEGACY_CHECKPOINT',
      'legacy_rows', v_count,
      'legacy_first_created_at_us', v_first,
      'legacy_last_created_at_us', v_last,
      'legacy_digest', v_digest,
      'legacy_digest_rule', 'sha256 of the newline-joined canonical JSON of every legacy row (all columns; created_at as integer microseconds), ordered by (created_at, id)',
      'reason', 'Rows before this checkpoint were hashed over row_to_json text that is not stored and cannot be recomputed; they are preserved unchanged and anchored here.',
      'migration', '20260928080000_audit_chain_v2'),
    NULL, NULL, NULL, 'SYSTEM', NULL);
END;
$$;
