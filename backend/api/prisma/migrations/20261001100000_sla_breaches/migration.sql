-- Phase 14 loose ends Part B: scheduled SLA breach sweep (plan Phase 5).
--
-- Breach detection was on demand only (GET /applications/sla-breaches). A
-- scheduled job now records ONE breach per stage instance - an application's
-- stay in a stage, identified by (application_id, stage, stage_entered_at) -
-- whose stage_due_at has passed. The unique key makes the sweep idempotent:
-- re-running it records nothing new for a breach already recorded, and a
-- later stay in a stage (re-entered after a defect, say) is a new instance.
--
-- The breach rule is the existing one (stage_due_at before now), the same as
-- slaView(), findBreached() and the analytics SLA view; the due times were
-- set by the workflow from STAGE_SLA_DAYS when the stage was entered.
--
-- The sweep runs as the SYSTEM actor, which cannot see applications under
-- RLS; sla_record_breaches() reads and writes as its owner, narrowly:
-- callable only while app.actor_role = 'SYSTEM' with no actor, it inserts
-- breach rows and returns them - nothing else. Rows are audited (trigger);
-- app_user may only read them, under the applications' jurisdiction rule.

CREATE TABLE "sla_breaches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "stage" TEXT NOT NULL,
  "stage_entered_at" TIMESTAMPTZ(6) NOT NULL,
  "stage_due_at" TIMESTAMPTZ(6) NOT NULL,
  "sla_days" NUMERIC NOT NULL,
  "jurisdiction_state" TEXT NOT NULL,
  "jurisdiction_district" TEXT,
  "sweep_run_id" UUID NOT NULL,
  "detected_at" TIMESTAMPTZ(6) NOT NULL,
  -- NULL: the scheduled job; else the SUPER_ADMIN account that ran the sweep by hand.
  "triggered_by_account_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sla_breaches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sla_breaches_due_after_entry_check" CHECK ("stage_due_at" > "stage_entered_at"),
  CONSTRAINT "sla_breaches_detected_after_due_check" CHECK ("detected_at" > "stage_due_at")
);
CREATE UNIQUE INDEX "sla_breaches_stage_instance_key"
  ON "sla_breaches" ("application_id", "stage", "stage_entered_at");
CREATE INDEX "sla_breaches_detected_at_idx" ON "sla_breaches" ("detected_at");
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_triggered_by_account_id_fkey"
  FOREIGN KEY ("triggered_by_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sla_breaches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jurisdiction_sla_breaches_policy" ON "sla_breaches"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "officers" o
          ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       WHERE app.id = "sla_breaches".application_id
         AND (o.jurisdiction_state IS NULL
              OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
              OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
              OR app.assigned_officer_id = o.id))
    OR EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
       WHERE app.id = "sla_breaches".application_id AND app.applicant_id = a.id)
  );

REVOKE ALL ON "sla_breaches" FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "sla_breaches" FROM app_user;
GRANT SELECT ON "sla_breaches" TO app_user;

CREATE TRIGGER "trigger_audit_sla_breaches"
  AFTER INSERT OR UPDATE OR DELETE ON "sla_breaches"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- Every stage instance past its due time at p_now, with newly_recorded = true
-- for the ones this call recorded (false: recorded by an earlier sweep).
CREATE OR REPLACE FUNCTION sla_record_breaches(p_now TIMESTAMPTZ, p_run UUID, p_triggered_by UUID)
RETURNS TABLE (
  breach_id UUID,
  application_id UUID,
  application_no TEXT,
  applicant_id UUID,
  jurisdiction_state TEXT,
  jurisdiction_district TEXT,
  stage TEXT,
  stage_entered_at TIMESTAMPTZ,
  stage_due_at TIMESTAMPTZ,
  sla_days NUMERIC,
  detected_at TIMESTAMPTZ,
  newly_recorded BOOLEAN
)
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
#variable_conflict use_column
BEGIN
  IF NULLIF(current_setting('app.actor_role', true), '') IS DISTINCT FROM 'SYSTEM'
     OR NULLIF(current_setting('app.actor_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'sla_record_breaches may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT a.id, a.application_no, a.applicant_id, a.jurisdiction_state, a.jurisdiction_district,
           a.current_stage, a.stage_entered_at, a.stage_due_at
      FROM applications a
     WHERE a.stage_due_at IS NOT NULL AND a.stage_due_at < p_now
  ),
  ins AS (
    INSERT INTO sla_breaches AS b (application_id, stage, stage_entered_at, stage_due_at, sla_days,
                                   jurisdiction_state, jurisdiction_district, sweep_run_id,
                                   detected_at, triggered_by_account_id)
    SELECT d.id, d.current_stage, d.stage_entered_at, d.stage_due_at,
           round(extract(epoch FROM d.stage_due_at - d.stage_entered_at) / 86400, 3),
           d.jurisdiction_state, d.jurisdiction_district, p_run, p_now, p_triggered_by
      FROM due d
    ON CONFLICT ("application_id", "stage", "stage_entered_at") DO NOTHING
    RETURNING b.id, b.application_id, b.stage, b.stage_entered_at
  )
  SELECT coalesce(i.id, old.id), d.id, d.application_no, d.applicant_id, d.jurisdiction_state,
         d.jurisdiction_district, d.current_stage, d.stage_entered_at, d.stage_due_at,
         round(extract(epoch FROM d.stage_due_at - d.stage_entered_at) / 86400, 3),
         coalesce(old.detected_at, p_now), i.id IS NOT NULL
    FROM due d
    LEFT JOIN ins i ON i.application_id = d.id AND i.stage = d.current_stage
                   AND i.stage_entered_at = d.stage_entered_at
    LEFT JOIN sla_breaches old ON old.application_id = d.id AND old.stage = d.current_stage
                              AND old.stage_entered_at = d.stage_entered_at
   ORDER BY d.stage_due_at, d.id;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION sla_record_breaches(TIMESTAMPTZ, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sla_record_breaches(TIMESTAMPTZ, UUID, UUID) TO app_user;

-- test_fixtures may tag the new rows and API-authored schemes (Part A).
ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision',
  'scheme', 'scheme_version', 'sla_breach'));
