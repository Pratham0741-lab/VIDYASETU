-- ============================================================================
-- Authorization denials: a tamper-evident record of REFUSED privileged or
-- consequential actions (a denied role, a workflow stage/guard rejection, an
-- objection-window refusal, a failed SYSTEM-actor guard). A refused action
-- changes no row, so the audit_logs trigger never sees it; before this table
-- such refusals existed only in application logs.
--
-- Deliberately separate from audit_logs (which is untouched):
--   * its own table and its own hash chain (own advisory lock, own sequence);
--   * rows are written only through record_authorization_denial(), a
--     SECURITY DEFINER function - app_user may SELECT (under RLS) but never
--     INSERT/UPDATE/DELETE/TRUNCATE, the same posture as audit_logs;
--   * append-only for EVERY role, owner and superuser included (triggers).
-- The api writes a denial in its own fresh transaction (the refused request's
-- transaction rolls back or never opened), see src/authorization-denials.
-- ============================================================================

CREATE TABLE "authorization_denials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_id" UUID,
    "actor_type" TEXT,
    "actor_role" TEXT,
    "action_attempted" TEXT NOT NULL,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "denial_reason" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "jurisdiction_state" TEXT,
    "jurisdiction_district" TEXT,
    "jurisdiction_source" TEXT,
    "ip_address" TEXT,
    "request_id" TEXT,
    "prev_hash" TEXT,
    "record_hash" TEXT NOT NULL,

    CONSTRAINT "authorization_denials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "authorization_denials_actor_type_check"
      CHECK ("actor_type" IS NULL OR "actor_type" IN ('OFFICER', 'APPLICANT', 'UNKNOWN')),
    CONSTRAINT "authorization_denials_action_check"
      CHECK (length("action_attempted") BETWEEN 1 AND 200),
    CONSTRAINT "authorization_denials_reason_check"
      CHECK ("denial_reason" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT "authorization_denials_subject_type_check"
      CHECK ("subject_type" IS NULL OR "subject_type" ~ '^[a-z][a-z0-9_]{0,39}$'),
    CONSTRAINT "authorization_denials_subject_id_check"
      CHECK ("subject_id" IS NULL OR length("subject_id") BETWEEN 1 AND 200),
    CONSTRAINT "authorization_denials_details_check"
      CHECK (jsonb_typeof("details") = 'object'),
    CONSTRAINT "authorization_denials_jurisdiction_source_check"
      CHECK ("jurisdiction_source" IS NULL OR "jurisdiction_source" IN ('SUBJECT', 'ACTOR'))
);
-- No FK on actor_id (unlike audit_logs.actor_id): an FK action would have to
-- UPDATE these append-only rows, which would then block officer re-keying.
COMMENT ON COLUMN "authorization_denials"."actor_id" IS
  'officers.id when the acting user is an officer (resolved exactly as audit_logs.actor_id), else NULL.';

CREATE INDEX "authorization_denials_occurred_at_idx" ON "authorization_denials"("occurred_at");
CREATE INDEX "authorization_denials_actor_user_id_idx" ON "authorization_denials"("actor_user_id");
CREATE INDEX "authorization_denials_subject_idx" ON "authorization_denials"("subject_type", "subject_id");
CREATE INDEX "authorization_denials_jurisdiction_idx"
  ON "authorization_denials"("jurisdiction_state", "jurisdiction_district");

-- ----------------------------------------------------------------------------
-- 1. Canonical row content for the hash chain: every column except the two
--    hash columns, as jsonb text (jsonb normalises key order), with the
--    timestamp rendered in UTC so the value is independent of the session's
--    TimeZone and can be re-verified from any connection.
--    record_hash = sha256( COALESCE(prev_hash, '') || canonical_content )
--    - the audit_logs construction, on this table's own chain.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION authorization_denial_canonical(d "authorization_denials")
RETURNS TEXT
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', d.id,
    'occurred_at', to_char(d.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor_user_id', d.actor_user_id,
    'actor_id', d.actor_id,
    'actor_type', d.actor_type,
    'actor_role', d.actor_role,
    'action_attempted', d.action_attempted,
    'subject_type', d.subject_type,
    'subject_id', d.subject_id,
    'denial_reason', d.denial_reason,
    'details', d.details,
    'jurisdiction_state', d.jurisdiction_state,
    'jurisdiction_district', d.jurisdiction_district,
    'jurisdiction_source', d.jurisdiction_source,
    'ip_address', d.ip_address,
    'request_id', d.request_id
  )::text;
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION authorization_denial_canonical("authorization_denials") FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. The only writer. Actor fields come from the caller's transaction-local
--    app.* settings (set by the api's Phase 2 actor-transaction mechanism),
--    resolved with the audit trigger's actor block COPIED VERBATIM from
--    process_audit_log_hash_chain() (migration 20260926040000) - that logic
--    is inline in the audit trigger, which is not modified, so it is copied
--    rather than called. Jurisdiction: the subject's owning application when
--    the subject resolves to one, else the acting officer's, else NULL
--    (visible to national officers only).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_authorization_denial(
  p_action_attempted TEXT,
  p_subject_type TEXT,
  p_subject_id TEXT,
  p_denial_reason TEXT,
  p_details JSONB,
  p_request_id TEXT
)
RETURNS UUID
SET search_path = public, pg_temp
SECURITY DEFINER
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
BEGIN
  -- Separate chain, separate lock: never contends with audit_log_chain.
  PERFORM pg_advisory_xact_lock(hashtext('authorization_denial_chain'));

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

  -- Jurisdiction from the subject's owning application (SECURITY DEFINER:
  -- not filtered by RLS - the refused actor may not be able to see it).
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

  SELECT d.record_hash INTO v_row.prev_hash
  FROM "authorization_denials" d
  ORDER BY d.occurred_at DESC, d.id DESC
  LIMIT 1;

  v_row.record_hash := encode(
    digest(COALESCE(v_row.prev_hash, '') || authorization_denial_canonical(v_row), 'sha256'),
    'hex'
  );

  INSERT INTO "authorization_denials" SELECT (v_row).*;
  RETURN v_row.id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION record_authorization_denial(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_authorization_denial(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO app_user;

-- ----------------------------------------------------------------------------
-- 3. Privileges, stated explicitly (not left to the default privileges of
--    migration 20260926030000, which GRANT app_user SELECT/INSERT/UPDATE/
--    DELETE on every new table): app_user may only read.
-- ----------------------------------------------------------------------------
REVOKE ALL ON "authorization_denials" FROM app_user;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "authorization_denials" FROM app_user;
GRANT SELECT ON "authorization_denials" TO app_user;

-- ----------------------------------------------------------------------------
-- 4. Append-only for EVERY role (owner and superuser included), mirroring
--    prevent_audit_log_mutation(). Same PostgreSQL limits: a superuser can
--    still ALTER TABLE ... DISABLE TRIGGER or use session_replication_role;
--    the hash chain is what makes such tampering detectable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_authorization_denial_mutation()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'authorization_denials is append-only: % is not allowed (trigger %, enforced for every role including owner and superuser)',
    TG_OP, TG_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_authorization_denial_mutation
BEFORE UPDATE OR DELETE ON "authorization_denials"
FOR EACH ROW
EXECUTE FUNCTION prevent_authorization_denial_mutation();

-- TRUNCATE bypasses row-level triggers, so block it with a statement trigger.
CREATE TRIGGER trigger_prevent_authorization_denial_truncate
BEFORE TRUNCATE ON "authorization_denials"
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_authorization_denial_mutation();

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security: the established officer-jurisdiction predicate
--    (national / state / state+district), copied from the applications
--    policy and applied to the denial row's own jurisdiction columns. Read
--    only (no write policy: app_user has no write privilege). Applicants see
--    nothing; a NULL-jurisdiction row is visible to national officers only.
-- ----------------------------------------------------------------------------
ALTER TABLE "authorization_denials" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officer_jurisdiction_authorization_denials_policy" ON "authorization_denials"
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "officers" o
    WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      AND o.is_active = true
      AND (
        o.jurisdiction_state IS NULL
        OR (
          o.jurisdiction_district IS NULL
          AND authorization_denials.jurisdiction_state = o.jurisdiction_state
        )
        OR (
          authorization_denials.jurisdiction_state = o.jurisdiction_state
          AND authorization_denials.jurisdiction_district = o.jurisdiction_district
        )
      )
  )
);
