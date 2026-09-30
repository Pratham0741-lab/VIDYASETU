-- Phase 17 Part D: database-level protections.
--
-- M45 - applicants gets row-level security, the existing pattern:
--   * the owning applicant (user_id = the actor): every operation;
--   * an active officer whose jurisdiction covers the applicant's domicile:
--     read; a reviewer role (INO / DNO / SNO / MINISTRY_OFFICER) also update
--     (the verified correction path);
--   * the SYSTEM actor (app.actor_role = SYSTEM, no actor id): read only - the
--     fraud data layer and the document pipeline's eligibility cross-check
--     run as SYSTEM, the same rule pii_match_index uses;
--   * no actor: nothing.
-- The policy never looks at applications (whose own policy reads applicants:
-- a cycle would be infinite recursion), so an officer outside the
-- applicant's domicile jurisdiction who is only the ASSIGNED officer of one
-- application does not see the applicant row.
-- Login and refresh run before any actor exists and need only to know
-- whether an account is an applicant: applicant_id_for_account() answers
-- that (the id, nothing else) as its owner.
--
-- M32 - AUDITOR is read-only in the database: a statement-level trigger on
-- every public table refuses INSERT / UPDATE / DELETE / TRUNCATE while
-- app.actor_role = 'AUDITOR'. Exceptions, which never carry an AUDITOR's own
-- change: authorization_denials and its chain head (an AUDITOR's refused
-- attempt must still be recorded), audit_logs and audit_chain_head (written
-- only by the audit trigger), _prisma_migrations and test_fixtures (owner
-- only). A table added later needs the trigger too (SECURITY_REVIEW.md).

-- ------------------------------------------------------------------ M45
ALTER TABLE "applicants" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_applicants_policy" ON "applicants" FOR ALL
  USING ("user_id" = NULLIF(current_setting('app.actor_id', true), '')::uuid)
  WITH CHECK ("user_id" = NULLIF(current_setting('app.actor_id', true), '')::uuid);

CREATE POLICY "officer_applicants_read" ON "applicants" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "officers" o
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "applicants".domicile_state = o.jurisdiction_state)
            OR ("applicants".domicile_state = o.jurisdiction_state
                AND "applicants".domicile_district = o.jurisdiction_district))));

CREATE POLICY "reviewer_applicants_update" ON "applicants" FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM "officers" o JOIN "roles" r ON r.id = o.role_id
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND r.name IN ('INSTITUTE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'STATE_NODAL_OFFICER', 'MINISTRY_OFFICER')
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "applicants".domicile_state = o.jurisdiction_state)
            OR ("applicants".domicile_state = o.jurisdiction_state
                AND "applicants".domicile_district = o.jurisdiction_district))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "officers" o JOIN "roles" r ON r.id = o.role_id
     WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       AND r.name IN ('INSTITUTE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'STATE_NODAL_OFFICER', 'MINISTRY_OFFICER')
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND "applicants".domicile_state = o.jurisdiction_state)
            OR ("applicants".domicile_state = o.jurisdiction_state
                AND "applicants".domicile_district = o.jurisdiction_district))));

CREATE POLICY "system_applicants_read" ON "applicants" FOR SELECT
  USING (NULLIF(current_setting('app.actor_role', true), '') = 'SYSTEM'
         AND NULLIF(current_setting('app.actor_id', true), '') IS NULL);

CREATE OR REPLACE FUNCTION applicant_id_for_account(p_account_id UUID)
RETURNS UUID
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
  SELECT a.id FROM applicants a WHERE a.user_id = p_account_id;
$$ LANGUAGE sql;
REVOKE ALL ON FUNCTION applicant_id_for_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION applicant_id_for_account(UUID) TO app_user;

-- ------------------------------------------------------------------ M32
CREATE OR REPLACE FUNCTION refuse_auditor_writes()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') = 'AUDITOR' THEN
    RAISE EXCEPTION 'AUDITOR_READ_ONLY: the AUDITOR role cannot % %', TG_OP, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('authorization_denials', 'authorization_denial_chain_head',
                             'audit_logs', 'audit_chain_head', '_prisma_migrations', 'test_fixtures')
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trigger_refuse_auditor_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I '
      'FOR EACH STATEMENT EXECUTE FUNCTION refuse_auditor_writes()', t);
  END LOOP;
END;
$$;
