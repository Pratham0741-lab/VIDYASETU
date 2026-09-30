-- Phase 13B (D1, KNOWN_LIMITATIONS M31): the authorization-denials chain,
-- made verifiable the same way as audit_logs (Phase 13A).
--
-- The denials chain (migration 20260928010000) chose its predecessor as "the
-- row with the latest (occurred_at, id)" - occurred_at is the transaction
-- start, id is random - the ordering that forked audit_logs 177 times (no
-- denial fork yet: denials are rare), and hashed jsonb::text (Postgres
-- formatting). From here on (hash_version 2):
--   * gap-free seq and the single predecessor come from the row-locked
--     authorization_denial_chain_head (its own head: never contends with
--     audit_chain_head);
--   * record_hash = sha256(hash_input), hash_input = audit_canonical_json of
--     the whole row (api/src/audit/canonical.ts is the rule definition),
--     stored verbatim.
-- The existing denial rows stay untouched as legacy (seq NULL); a CHECKPOINT
-- row appended to the AUDIT chain (kind DENIALS_LEGACY_CHECKPOINT) anchors
-- their count, time range and digest - not a fake denial row, which the
-- table's own checks and the listing API would treat as real.
-- record_authorization_denial keeps its signature, grants, actor block and
-- jurisdiction resolution unchanged; only the chaining changes.

ALTER TABLE "authorization_denials"
  ADD COLUMN "seq" BIGINT,
  ADD COLUMN "hash_version" SMALLINT,
  ADD COLUMN "hash_input" TEXT;
ALTER TABLE "authorization_denials"
  ADD CONSTRAINT "authorization_denials_hash_version_check" CHECK (
    (hash_version IS NULL AND seq IS NULL AND hash_input IS NULL)
    OR (hash_version = 2 AND seq IS NOT NULL AND seq >= 1 AND hash_input IS NOT NULL)
  );
CREATE UNIQUE INDEX "authorization_denials_seq_key" ON "authorization_denials" ("seq");

CREATE TABLE "authorization_denial_chain_head" (
  "id" BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("id"),
  "last_seq" BIGINT NOT NULL,
  "last_hash" TEXT,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
REVOKE ALL ON "authorization_denial_chain_head" FROM PUBLIC;
REVOKE ALL ON "authorization_denial_chain_head" FROM app_user;
GRANT SELECT ON "authorization_denial_chain_head" TO app_user;
INSERT INTO "authorization_denial_chain_head" ("id", "last_seq", "last_hash") VALUES (TRUE, 0, NULL);

CREATE OR REPLACE FUNCTION record_authorization_denial(
  p_action_attempted TEXT,
  p_subject_type TEXT,
  p_subject_id TEXT,
  p_denial_reason TEXT,
  p_details JSONB,
  p_request_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row "authorization_denials"%ROWTYPE;
  v_actor_id UUID;
  v_actor_user_id UUID;
  v_actor_type TEXT;
  v_actor_role TEXT;
  v_ip_address TEXT;
  v_subject_uuid UUID;
  v_state TEXT;
  v_district TEXT;
  v_found BOOLEAN := false;
  v_last_seq BIGINT;
BEGIN
  -- Serialise on this chain's own head (held until the transaction ends).
  SELECT last_seq, last_hash INTO v_last_seq, v_row.prev_hash
    FROM "authorization_denial_chain_head" WHERE id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorization_denial_chain_head is missing: the denials chain cannot be extended';
  END IF;

  -- ---- actor block: verbatim from process_audit_log_hash_chain() ----------
  BEGIN
    v_actor_user_id := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor_user_id := NULL;
  END;

  v_actor_role := NULLIF(current_setting('app.actor_role', true), '');
  v_ip_address := NULLIF(current_setting('app.request_ip', true), '');

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
  -- ---- end verbatim actor block -------------------------------------------

  -- Jurisdiction from the subject's owning application (unchanged).
  IF p_subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_subject_uuid := p_subject_id::uuid;
    CASE p_subject_type
      WHEN 'application' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "applications" a WHERE a.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'selection' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "selections" s JOIN "applications" a ON a.id = s.application_id WHERE s.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'document' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "documents" d JOIN "applications" a ON a.id = d.application_id WHERE d.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'grievance' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "grievances" g JOIN "applications" a ON a.id = g.application_id WHERE g.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'disbursement' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "disbursements" x JOIN "applications" a ON a.id = x.application_id WHERE x.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'sanction_order' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "sanction_orders" x JOIN "applications" a ON a.id = x.application_id WHERE x.id = v_subject_uuid;
        v_found := FOUND;
      WHEN 'renewal' THEN
        SELECT a.jurisdiction_state, a.jurisdiction_district INTO v_state, v_district
        FROM "renewals" r JOIN "applications" a ON a.id = r.parent_application_id WHERE r.id = v_subject_uuid;
        v_found := FOUND;
      ELSE
        v_found := false;
    END CASE;
  END IF;

  IF v_found THEN
    v_row.jurisdiction_source := 'SUBJECT';
  ELSIF v_actor_id IS NOT NULL THEN
    SELECT o.jurisdiction_state, o.jurisdiction_district INTO v_state, v_district
    FROM "officers" o WHERE o.id = v_actor_id;
    v_row.jurisdiction_source := 'ACTOR';
  END IF;

  v_row.id := gen_random_uuid();
  v_row.occurred_at := CURRENT_TIMESTAMP;
  v_row.actor_user_id := v_actor_user_id;
  v_row.actor_id := v_actor_id;
  v_row.actor_type := v_actor_type;
  v_row.actor_role := v_actor_role;
  v_row.action_attempted := p_action_attempted;
  v_row.subject_type := p_subject_type;
  v_row.subject_id := p_subject_id;
  v_row.denial_reason := p_denial_reason;
  v_row.details := COALESCE(p_details, '{}'::jsonb);
  v_row.jurisdiction_state := v_state;
  v_row.jurisdiction_district := v_district;
  v_row.ip_address := v_ip_address;
  v_row.request_id := NULLIF(p_request_id, '');

  -- Chaining (Phase 13B): seq and predecessor from the locked head.
  v_row.seq := v_last_seq + 1;
  v_row.hash_version := 2;
  v_row.hash_input := audit_canonical_json(jsonb_build_object(
    'action_attempted', v_row.action_attempted,
    'actor_id', v_row.actor_id,
    'actor_role', v_row.actor_role,
    'actor_type', v_row.actor_type,
    'actor_user_id', v_row.actor_user_id,
    'denial_reason', v_row.denial_reason,
    'details', v_row.details,
    'hash_version', 2,
    'id', v_row.id,
    'ip_address', v_row.ip_address,
    'jurisdiction_district', v_row.jurisdiction_district,
    'jurisdiction_source', v_row.jurisdiction_source,
    'jurisdiction_state', v_row.jurisdiction_state,
    'occurred_at_us', (extract(epoch FROM v_row.occurred_at) * 1000000)::bigint,
    'prev_hash', v_row.prev_hash,
    'request_id', v_row.request_id,
    'seq', v_row.seq,
    'subject_id', v_row.subject_id,
    'subject_type', v_row.subject_type
  ));
  v_row.record_hash := encode(digest(v_row.hash_input, 'sha256'), 'hex');

  INSERT INTO "authorization_denials" SELECT (v_row).*;
  UPDATE "authorization_denial_chain_head"
     SET last_seq = v_row.seq, last_hash = v_row.record_hash, updated_at = clock_timestamp()
   WHERE id;
  RETURN v_row.id;
END;
$$;
REVOKE ALL ON FUNCTION record_authorization_denial(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_authorization_denial(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO app_user;

-- Epoch boundary: anchor the legacy denial rows in the audit chain.
DO $$
DECLARE
  v_count BIGINT;
  v_first BIGINT;
  v_last BIGINT;
  v_digest TEXT;
BEGIN
  SELECT count(*),
         min((extract(epoch FROM occurred_at) * 1000000)::bigint),
         max((extract(epoch FROM occurred_at) * 1000000)::bigint),
         encode(digest(coalesce(string_agg(audit_canonical_json(jsonb_build_object(
           'action_attempted', action_attempted, 'actor_id', actor_id, 'actor_role', actor_role,
           'actor_type', actor_type, 'actor_user_id', actor_user_id, 'denial_reason', denial_reason,
           'details', details, 'id', id, 'ip_address', ip_address,
           'jurisdiction_district', jurisdiction_district, 'jurisdiction_source', jurisdiction_source,
           'jurisdiction_state', jurisdiction_state,
           'occurred_at_us', (extract(epoch FROM occurred_at) * 1000000)::bigint,
           'prev_hash', prev_hash, 'record_hash', record_hash, 'request_id', request_id,
           'subject_id', subject_id, 'subject_type', subject_type)),
           E'\n' ORDER BY occurred_at, id), ''), 'sha256'), 'hex')
    INTO v_count, v_first, v_last, v_digest
    FROM "authorization_denials" WHERE seq IS NULL;

  PERFORM audit_chain_append(
    'authorization_denials', gen_random_uuid(), 'CHECKPOINT',
    jsonb_build_object(
      'kind', 'DENIALS_LEGACY_CHECKPOINT',
      'legacy_rows', v_count,
      'legacy_first_occurred_at_us', v_first,
      'legacy_last_occurred_at_us', v_last,
      'legacy_digest', v_digest,
      'legacy_digest_rule', 'sha256 of the newline-joined canonical JSON of every legacy denial row (all columns; occurred_at as integer microseconds), ordered by (occurred_at, id)',
      'reason', 'Denial rows before this checkpoint were chained by (occurred_at, id) over jsonb text; they are preserved unchanged and anchored here.',
      'migration', '20260928100000_denials_chain_v2'),
    NULL, NULL, NULL, 'SYSTEM', NULL);
END;
$$;
