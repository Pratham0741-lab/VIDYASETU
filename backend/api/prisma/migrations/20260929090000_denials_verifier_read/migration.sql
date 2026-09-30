-- Phase 13C (Part A, KNOWN_LIMITATIONS M36): the audit verifier reads the
-- whole authorization-denials chain whatever the caller's jurisdiction.
--
-- authorization_denials is under jurisdiction RLS, so GET /api/v1/audit/verify
-- run by a state-scoped AUDITOR saw only that state's denials and reported a
-- false failure. This function is the verifier's only read path to the
-- denial rows from the api:
--   * SECURITY DEFINER (owner rights: RLS does not filter it), read-only
--     (STABLE; SELECT only);
--   * refuses unless the transaction's actor is an active AUDITOR or
--     SUPER_ADMIN officer: app.actor_role must be one of the two AND the
--     officer row of app.actor_id must hold that same role (the setting
--     alone is not trusted);
--   * returns only the columns the hash check needs, one page at a time;
--   * EXECUTE for app_user only.
-- The verifier's response is a summary; the rows never leave the api.
-- The audit chain design and the denial writer are unchanged.

CREATE OR REPLACE FUNCTION audit_verifier_denial_rows(
  p_part TEXT,           -- 'legacy' (seq IS NULL) or 'chain' (seq > p_after_seq)
  p_after_seq BIGINT,
  p_limit INTEGER
)
RETURNS TABLE (
  id TEXT, seq TEXT, hash_version SMALLINT, prev_hash TEXT, record_hash TEXT, hash_input TEXT,
  occurred_at_us TEXT, actor_user_id TEXT, actor_id TEXT, actor_type TEXT, actor_role TEXT,
  action_attempted TEXT, subject_type TEXT, subject_id TEXT, denial_reason TEXT, details TEXT,
  jurisdiction_state TEXT, jurisdiction_district TEXT, jurisdiction_source TEXT,
  ip_address TEXT, request_id TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_role TEXT := NULLIF(current_setting('app.actor_role', true), '');
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF v_actor IS NULL OR v_role IS NULL OR v_role NOT IN ('AUDITOR', 'SUPER_ADMIN')
     OR NOT EXISTS (
       SELECT 1 FROM "officers" o JOIN "roles" r ON r.id = o.role_id
        WHERE o.user_id = v_actor AND o.is_active AND r.name = v_role) THEN
    RAISE EXCEPTION 'audit_verifier_denial_rows: only an active AUDITOR or SUPER_ADMIN may read the denial chain'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_part NOT IN ('legacy', 'chain') THEN
    RAISE EXCEPTION 'audit_verifier_denial_rows: part must be legacy or chain' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
    SELECT d.id::text, d.seq::text, d.hash_version, d.prev_hash, d.record_hash, d.hash_input,
           ((extract(epoch FROM d.occurred_at) * 1000000)::bigint)::text,
           d.actor_user_id::text, d.actor_id::text, d.actor_type, d.actor_role,
           d.action_attempted, d.subject_type, d.subject_id, d.denial_reason, d.details::text,
           d.jurisdiction_state, d.jurisdiction_district, d.jurisdiction_source,
           d.ip_address, d.request_id
      FROM "authorization_denials" d
     WHERE (p_part = 'legacy' AND d.seq IS NULL)
        OR (p_part = 'chain' AND d.seq > p_after_seq)
     ORDER BY CASE WHEN p_part = 'chain' THEN d.seq END,
              d.occurred_at, d.id
     LIMIT CASE WHEN p_part = 'chain' THEN p_limit END;
END;
$$;
REVOKE ALL ON FUNCTION audit_verifier_denial_rows(TEXT, BIGINT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_verifier_denial_rows(TEXT, BIGINT, INTEGER) TO app_user;
