-- Phase 11.5 - verification and limitation fixes. Additive only: no existing
-- table, column, policy or grant is changed.

-- ---------------------------------------------------------------------------
-- 1. B1: refresh an INSTITUTION_SURGE flag's count on re-evaluation.
--
-- fraud_flags stays as Phase 11 left it (SYSTEM may only INSERT; officers
-- may only UPDATE the review columns). This SYSTEM-only function is the one
-- way to change a surge flag after it is raised, and it can touch only the
-- detector's figures: summary, evidence, related_application_ids and
-- updated_at. status, reviewed_by_officer_id, reviewed_at and review_notes
-- are never written here, so an officer's disposition always survives. The
-- UPDATE fires the existing audit trigger like any other change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fraud_refresh_surge_flag(
  p_dedup_key TEXT,
  p_summary TEXT,
  p_evidence JSONB,
  p_related_application_ids UUID[]
)
RETURNS INTEGER
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'fraud_refresh_surge_flag may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;
  UPDATE "fraud_flags"
     SET summary = p_summary,
         evidence = p_evidence,
         related_application_ids = p_related_application_ids,
         updated_at = now()
   WHERE dedup_key = p_dedup_key
     AND flag_type = 'INSTITUTION_SURGE'
     AND (summary IS DISTINCT FROM p_summary
          OR evidence IS DISTINCT FROM p_evidence
          OR related_application_ids IS DISTINCT FROM p_related_application_ids);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION fraud_refresh_surge_flag(TEXT, TEXT, JSONB, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fraud_refresh_surge_flag(TEXT, TEXT, JSONB, UUID[]) TO app_user;

-- ---------------------------------------------------------------------------
-- 2. B5: test-fixture register.
--
-- Rows created by proof harnesses (never by the application) are listed
-- here so analytics can exclude them:
--   ... WHERE NOT EXISTS (SELECT 1 FROM test_fixtures f
--                         WHERE f.entity_type = 'application' AND f.entity_id = a.id)
-- The application never writes this table (no grant to app_user); it is
-- maintained by the database owner, like the fixtures themselves.
-- ---------------------------------------------------------------------------
CREATE TABLE "test_fixtures" (
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "note" TEXT,
  "tagged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "test_fixtures_pkey" PRIMARY KEY ("entity_type", "entity_id"),
  CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
    'account', 'applicant', 'application', 'selection', 'sanction_order',
    'disbursement', 'fraud_flag', 'officer'
  )),
  CONSTRAINT "test_fixtures_label_check" CHECK ("label" ~ '^[a-z0-9][a-z0-9._-]{1,63}$')
);
CREATE INDEX "test_fixtures_label_idx" ON "test_fixtures" ("label");

-- Default privileges would give app_user write access; read-only instead.
REVOKE ALL ON "test_fixtures" FROM PUBLIC;
REVOKE ALL ON "test_fixtures" FROM app_user;
GRANT SELECT ON "test_fixtures" TO app_user;
