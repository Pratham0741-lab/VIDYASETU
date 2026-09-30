-- Phase 13E (Part C): committee review, publication and the final list
-- around the Phase 6 allocator - which is not changed and never re-run.
--
--   selection_lists     one per selection run (created by the run): its
--                       lifecycle DRAFT -> PROVISIONAL_PUBLISHED (the
--                       objection window is open) -> OBJECTION_WINDOW_CLOSED
--                       -> FINAL_PUBLISHED.
--   selection_list_entries  every candidate of the run as the allocator left
--                       them (SELECTED / NOT_SELECTED / HELD, rank) - the
--                       computed result is never edited - plus the
--                       committee's decision beside it and, once final, the
--                       final outcome.
--   selection_committee_decisions  insert-only: one row per approval,
--                       override, objection decision or early window close;
--                       a reason of at least 10 trimmed characters (except
--                       an approval, where it is optional).
-- A FINAL_PUBLISHED list is frozen: its row, entries and decisions refuse
-- every change (trigger). Every table is audited in the chain.

CREATE TABLE "selection_lists" (
  "id"                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "selection_run_id"              UUID NOT NULL UNIQUE,
  "scheme_code"                   TEXT NOT NULL,
  "academic_year"                 TEXT NOT NULL,
  "status"                        TEXT NOT NULL DEFAULT 'DRAFT',
  "approvals_required"            INTEGER NOT NULL,
  "objection_window_days"         INTEGER NOT NULL,
  "provisional_published_at"      TIMESTAMPTZ(6),
  "provisional_published_by"      UUID REFERENCES "officers"("id") ON DELETE RESTRICT,
  "window_closes_at"              TIMESTAMPTZ(6),
  "window_closed_at"              TIMESTAMPTZ(6),
  "window_closed_by"              UUID REFERENCES "officers"("id") ON DELETE RESTRICT,
  "window_closed_early"           BOOLEAN NOT NULL DEFAULT false,
  "final_published_at"            TIMESTAMPTZ(6),
  "final_published_by"            UUID REFERENCES "officers"("id") ON DELETE RESTRICT,
  "created_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "selection_lists_status_check" CHECK ("status" IN (
    'DRAFT', 'PROVISIONAL_PUBLISHED', 'OBJECTION_WINDOW_CLOSED', 'FINAL_PUBLISHED')),
  CONSTRAINT "selection_lists_approvals_check" CHECK ("approvals_required" BETWEEN 1 AND 20),
  CONSTRAINT "selection_lists_window_check" CHECK ("objection_window_days" BETWEEN 0 AND 365),
  CONSTRAINT "selection_lists_published_check" CHECK (
    ("status" = 'DRAFT') = ("provisional_published_at" IS NULL)),
  CONSTRAINT "selection_lists_final_check" CHECK (
    ("status" = 'FINAL_PUBLISHED') = ("final_published_at" IS NOT NULL))
);
CREATE INDEX "selection_lists_scheme_year_idx" ON "selection_lists" ("scheme_code", "academic_year");

CREATE TABLE "selection_list_entries" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "selection_list_id"       UUID NOT NULL REFERENCES "selection_lists"("id") ON DELETE RESTRICT,
  "application_id"          UUID NOT NULL REFERENCES "applications"("id") ON DELETE RESTRICT,
  "selection_id"            UUID REFERENCES "selections"("id") ON DELETE RESTRICT,
  -- The allocator's result, as the run left it (never edited).
  "computed_outcome"        TEXT NOT NULL,
  "computed_rank"           INTEGER,
  "not_selected_reason"     TEXT,
  "vertical_category"       TEXT,
  "horizontal_reservation"  TEXT,
  -- The committee's decision beside it (NULL: none).
  "committee_decision"      TEXT,
  -- Set when the final list is published.
  "final_outcome"           TEXT,
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "selection_list_entries_computed_check" CHECK ("computed_outcome" IN ('SELECTED', 'NOT_SELECTED', 'HELD')),
  CONSTRAINT "selection_list_entries_decision_check" CHECK ("committee_decision" IS NULL OR "committee_decision" IN ('INCLUDE', 'EXCLUDE')),
  CONSTRAINT "selection_list_entries_final_check" CHECK ("final_outcome" IS NULL OR "final_outcome" IN ('SELECTED', 'NOT_SELECTED', 'HELD')),
  CONSTRAINT "selection_list_entries_selected_check" CHECK (("computed_outcome" = 'SELECTED') = ("selection_id" IS NOT NULL)),
  CONSTRAINT "selection_list_entries_one_per_app_key" UNIQUE ("selection_list_id", "application_id")
);
CREATE INDEX "selection_list_entries_application_idx" ON "selection_list_entries" ("application_id");

CREATE TABLE "selection_committee_decisions" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "selection_list_id"   UUID NOT NULL REFERENCES "selection_lists"("id") ON DELETE RESTRICT,
  "entry_id"            UUID REFERENCES "selection_list_entries"("id") ON DELETE RESTRICT,
  "grievance_id"        UUID REFERENCES "grievances"("id") ON DELETE RESTRICT,
  "officer_id"          UUID NOT NULL REFERENCES "officers"("id") ON DELETE RESTRICT,
  "kind"                TEXT NOT NULL,
  "reason"              TEXT,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "selection_committee_decisions_kind_check" CHECK ("kind" IN (
    'APPROVE_LIST', 'OVERRIDE_INCLUDE', 'OVERRIDE_EXCLUDE', 'OBJECTION_UPHELD',
    'OBJECTION_DISMISSED', 'CLOSE_WINDOW_EARLY')),
  CONSTRAINT "selection_committee_decisions_reason_check" CHECK (
    "kind" = 'APPROVE_LIST' OR length(btrim(coalesce("reason", ''))) >= 10),
  CONSTRAINT "selection_committee_decisions_target_check" CHECK (
    (("kind" IN ('APPROVE_LIST', 'CLOSE_WINDOW_EARLY')) = ("entry_id" IS NULL))
    AND (("kind" LIKE 'OBJECTION_%') = ("grievance_id" IS NOT NULL)))
);
CREATE INDEX "selection_committee_decisions_list_idx" ON "selection_committee_decisions" ("selection_list_id", "created_at");

-- ---------------------------------------------------------------------------
-- Row-level security. Entries follow their application (officers by
-- jurisdiction or assignment; the owning applicant). Decisions on an entry
-- follow that entry; list-level decisions (approval, early close) are
-- visible to active officers. The list rows themselves carry no personal
-- data (scheme, year, status, times): readable by app_user, role-gated by
-- the api.
-- ---------------------------------------------------------------------------
ALTER TABLE "selection_list_entries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jurisdiction_selection_list_entries_policy" ON "selection_list_entries"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "officers" o
          ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       WHERE app.id = "selection_list_entries".application_id
         AND (o.jurisdiction_state IS NULL
              OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
              OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
              OR app.assigned_officer_id = o.id))
    OR EXISTS (
      SELECT 1 FROM "applications" app
        JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
       WHERE app.id = "selection_list_entries".application_id AND app.applicant_id = a.id)
  );

ALTER TABLE "selection_committee_decisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scoped_selection_committee_decisions_policy" ON "selection_committee_decisions"
  FOR ALL
  USING (
    ("entry_id" IS NULL AND EXISTS (
       SELECT 1 FROM "officers" o
        WHERE o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true))
    OR ("entry_id" IS NOT NULL AND EXISTS (
       SELECT 1 FROM "selection_list_entries" e WHERE e.id = "selection_committee_decisions".entry_id))
  );

REVOKE ALL ON "selection_lists", "selection_list_entries", "selection_committee_decisions" FROM PUBLIC;
REVOKE DELETE, TRUNCATE ON "selection_lists", "selection_list_entries" FROM app_user;
REVOKE UPDATE, DELETE, TRUNCATE ON "selection_committee_decisions" FROM app_user;
GRANT SELECT, INSERT, UPDATE ON "selection_lists", "selection_list_entries" TO app_user;
GRANT SELECT, INSERT ON "selection_committee_decisions" TO app_user;

CREATE TRIGGER "trigger_audit_selection_lists"
  AFTER INSERT OR UPDATE OR DELETE ON "selection_lists"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_selection_list_entries"
  AFTER INSERT OR UPDATE OR DELETE ON "selection_list_entries"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
CREATE TRIGGER "trigger_audit_selection_committee_decisions"
  AFTER INSERT OR UPDATE OR DELETE ON "selection_committee_decisions"
  FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

-- ---------------------------------------------------------------------------
-- The final list is frozen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION selection_list_frozen_refusal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_list UUID;
  v_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'selection_lists' THEN
    IF OLD.status = 'FINAL_PUBLISHED' THEN
      RAISE EXCEPTION 'LIST_FROZEN: the final list % is published and cannot change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  v_list := CASE WHEN TG_OP = 'DELETE' THEN OLD.selection_list_id ELSE NEW.selection_list_id END;
  SELECT status INTO v_status FROM "selection_lists" WHERE id = v_list;
  IF v_status = 'FINAL_PUBLISHED' THEN
    RAISE EXCEPTION 'LIST_FROZEN: the final list % is published and cannot change', v_list
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "trigger_selection_lists_frozen"
  BEFORE UPDATE OR DELETE ON "selection_lists"
  FOR EACH ROW EXECUTE FUNCTION selection_list_frozen_refusal();
CREATE TRIGGER "trigger_selection_list_entries_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "selection_list_entries"
  FOR EACH ROW EXECUTE FUNCTION selection_list_frozen_refusal();
CREATE TRIGGER "trigger_selection_committee_decisions_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "selection_committee_decisions"
  FOR EACH ROW EXECUTE FUNCTION selection_list_frozen_refusal();

-- test_fixtures may tag them.
ALTER TABLE "test_fixtures" DROP CONSTRAINT IF EXISTS "test_fixtures_entity_type_check";
ALTER TABLE "test_fixtures" ADD CONSTRAINT "test_fixtures_entity_type_check" CHECK ("entity_type" IN (
  'account', 'applicant', 'application', 'selection', 'sanction_order', 'disbursement',
  'fraud_flag', 'officer', 'document', 'deficiency', 'deficiency_item', 'applicant_profile_change',
  'selection_list', 'selection_list_entry', 'selection_committee_decision'));

-- Undecided objections to a run, counted across jurisdictions: a
-- state-scoped committee closing the window early must not miss another
-- state's objection. Returns a number only; EXECUTE for app_user.
CREATE OR REPLACE FUNCTION selection_list_pending_objections(p_run UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int FROM "grievances"
   WHERE subject_type = 'SELECTION_OBJECTION'
     AND selection_run_id = p_run
     AND status IN ('OPEN', 'IN_PROGRESS');
$$;
REVOKE ALL ON FUNCTION selection_list_pending_objections(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION selection_list_pending_objections(UUID) TO app_user;
