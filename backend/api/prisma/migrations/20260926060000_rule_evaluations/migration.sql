-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926060000_rule_evaluations
--
-- Phase 3 (scheme engine): one row per rule evaluated in an evaluation run.
-- Machine-generated evidence, distinct from decision_records (officer
-- decisions, untouched). application_id is NULL for reverse-eligibility
-- checks, which have no application yet.
--
-- Attribution: evaluated_by_account_id / evaluated_by_role default to the
-- same transaction-local settings the Phase 2 actor transaction sets
-- (app.actor_id / app.actor_role), so the database records who evaluated
-- without the application having to pass it. NULL for anonymous
-- (public-route) evaluations, where no actor exists.
--
-- Audit coverage follows the Phase 1 precedent: every table whose rows
-- inform a decision about an application is audited, including
-- machine-generated rows (scores with NULL officer_id, workflow_transitions
-- triggered by "SYSTEM"). Only raw data (document_extractions) and
-- reference/identity tables are unaudited.
--
-- New table created by the migration owner: app_user receives
-- SELECT/INSERT/UPDATE/DELETE through the default privileges from
-- migration 20260926030000. No RLS policy or audit function is changed.
-- ============================================================================

CREATE TABLE "rule_evaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evaluation_run_id" UUID NOT NULL,
    "scheme_version_id" UUID NOT NULL,
    "application_id" UUID,
    "rule_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "expr" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "result_value" JSONB,
    "trace" JSONB NOT NULL,
    "explanation" TEXT,
    "message_key" TEXT,
    "evaluated_by_account_id" UUID DEFAULT NULLIF(current_setting('app.actor_id', true), '')::uuid,
    "evaluated_by_role" TEXT DEFAULT NULLIF(current_setting('app.actor_role', true), ''),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_evaluations_pkey" PRIMARY KEY ("id"),
    -- PASS/FAIL: eligibility gate result; COMPUTED: operational value recorded;
    -- INFO: informational rule, not evaluated as a gate; ERROR: could not be evaluated.
    CONSTRAINT "rule_evaluations_verdict_check"
        CHECK ("verdict" IN ('PASS', 'FAIL', 'COMPUTED', 'INFO', 'ERROR'))
);

CREATE INDEX "rule_evaluations_application_id_created_at_idx"
    ON "rule_evaluations"("application_id", "created_at");
CREATE INDEX "rule_evaluations_evaluation_run_id_idx"
    ON "rule_evaluations"("evaluation_run_id");
CREATE INDEX "rule_evaluations_scheme_version_id_rule_id_idx"
    ON "rule_evaluations"("scheme_version_id", "rule_id");

-- RESTRICT: evaluations are evidence; they must not disappear with their parent.
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_scheme_version_id_fkey"
    FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit coverage (existing hash-chain function, unchanged).
DROP TRIGGER IF EXISTS trigger_audit_rule_evaluations ON "rule_evaluations";
CREATE TRIGGER trigger_audit_rule_evaluations
AFTER INSERT OR UPDATE OR DELETE ON "rule_evaluations"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
