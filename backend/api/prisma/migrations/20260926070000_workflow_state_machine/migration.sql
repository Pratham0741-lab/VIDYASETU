-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926070000_workflow_state_machine
--
-- Phase 4 (workflow state machine). Additive only: no existing migration,
-- RLS policy, or audit function is changed.
--
-- 1. Stage-entry SLA columns on applications. There is exactly one current
--    stage entry per application, so its due time lives next to
--    current_stage: the breach query is one indexed scan of applications,
--    already covered by the existing RLS policy and the api's jurisdiction
--    scope. Past entries are in workflow_transitions (their metadata records
--    each entry's due time), so a separate table would only duplicate that
--    and need RLS of its own.
-- 2. needs_eligibility_review: an application routed on by an INDETERMINATE
--    automatic eligibility gate, queryable so the scrutiny queue can surface
--    it distinctly.
-- 3. status is derived from current_stage: a CHECK enforces the mapping in
--    src/workflow/vidyasetu-workflow.ts (STATUS_FOR_STAGE), so no code path
--    and no manual UPDATE can set one without the other. An unknown stage
--    fails it too (the CASE yields NULL, which status NOT NULL never equals).
-- 4. workflow_system_transition(): the automatic gate's stage change.
-- ============================================================================

-- 1 + 2. New columns.
ALTER TABLE "applications"
  ADD COLUMN "stage_entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "stage_due_at" TIMESTAMPTZ(6),
  ADD COLUMN "needs_eligibility_review" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "applications_current_stage_stage_due_at_idx"
  ON "applications"("current_stage", "stage_due_at");
CREATE INDEX "applications_stage_due_at_idx"
  ON "applications"("stage_due_at");

-- 3. status derived from current_stage.
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_derived_from_stage_check"
  CHECK ("status" IS NOT DISTINCT FROM (CASE "current_stage"
    WHEN 'SUBMITTED' THEN 'PENDING'
    WHEN 'INO_VERIFIED' THEN 'UNDER_REVIEW'
    WHEN 'DNO_VERIFIED' THEN 'UNDER_REVIEW'
    WHEN 'SNO_VERIFIED' THEN 'UNDER_REVIEW'
    WHEN 'MINISTRY_APPROVED' THEN 'APPROVED'
    WHEN 'DEFECTIVE' THEN 'DEFECTIVE'
    WHEN 'REJECTED' THEN 'REJECTED'
    WHEN 'DISBURSED' THEN 'DISBURSED'
  END));

-- 4. System-actor stage change.
--
-- The automatic eligibility gate is a decision of the system, not of the
-- applicant whose request submitted the application. The api therefore runs
-- the gate's writes with app.actor_id cleared and app.actor_role = 'SYSTEM';
-- the existing audit trigger then records actor_user_id NULL, actor_type
-- NULL (its "no actor: system" case) and actor_role 'SYSTEM'.
--
-- The unchanged RLS policy on applications admits only a matching officer or
-- the owning applicant, so with no actor the gate's UPDATE would match zero
-- rows. This function performs exactly that one UPDATE as its owner. It is
-- narrow on purpose:
--   * callable only while app.actor_role = 'SYSTEM' and app.actor_id is empty;
--   * compare-and-swap on the expected current stage (returns rows updated);
--   * writes only the stage columns; status is the caller's derived value and
--     must still satisfy the CHECK above;
--   * the row-level audit trigger fires as for any UPDATE.
CREATE OR REPLACE FUNCTION workflow_system_transition(
  p_application_id UUID,
  p_from_stage TEXT,
  p_to_stage TEXT,
  p_status TEXT,
  p_stage_entered_at TIMESTAMPTZ,
  p_stage_due_at TIMESTAMPTZ,
  p_needs_eligibility_review BOOLEAN
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
    RAISE EXCEPTION 'workflow_system_transition may only run as the SYSTEM actor (app.actor_role = SYSTEM, no app.actor_id)';
  END IF;

  UPDATE "applications"
     SET "current_stage" = p_to_stage,
         "status" = p_status,
         "stage_entered_at" = p_stage_entered_at,
         "stage_due_at" = p_stage_due_at,
         "needs_eligibility_review" = p_needs_eligibility_review,
         "updated_at" = CURRENT_TIMESTAMP
   WHERE "id" = p_application_id
     AND "current_stage" = p_from_stage;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION workflow_system_transition(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow_system_transition(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO app_user;
