-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260926080000_selection_reservations
--
-- Phase 6 (merit, quota & selection). No existing migration, RLS policy or
-- audit function is changed; selections and scores keep their existing RLS
-- policies and audit triggers.
--
-- 1. selections: selection_category (one string: ST_OTHERS | PVTG |
--    DIVYANGJAN | FEMALE) could not represent a candidate who is both PVTG
--    (vertical) and FEMALE (horizontal). Nothing reads it (checked in code),
--    so it is dropped and replaced:
--      vertical_category   - the vertical pool the seat belongs to;
--      is_female_reserved,
--      is_pwd_reserved     - the horizontal reservation the candidate was
--                            SELECTED UNDER. False for a reservation-
--                            eligible candidate who won a general seat on
--                            merit. Two booleans, not a join table: the
--                            policy data defines exactly these two
--                            horizontal reservations, and the allocator
--                            seats a candidate under at most one of them
--                            (CHECK below), so a join table would only add
--                            a table (with its own RLS) to hold one row.
--      selection_basis     - which selection path produced the row;
--      selection_run_id    - groups the rows of one selection run;
--      score_id            - the Score the ranking used (NULL if unranked).
-- 2. At most one live (PROVISIONAL / CONFIRMED) selection per application.
-- 3. scores.rule_evaluation_id: the rule_evaluations row a score was read
--    from (Phase 3 evidence), so no score is ever recomputed.
--
-- The applicant fields registration now accepts (gender, dob, is_disabled,
-- disability_percentage) already exist on applicants: no change needed.
-- ============================================================================

-- The new NOT NULL columns have no meaningful default for existing rows;
-- selections has never been written by the api, so refuse rather than guess.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "selections") THEN
    RAISE EXCEPTION 'selections is not empty: migrate existing rows to vertical_category / horizontal flags by hand first';
  END IF;
END $$;

-- 1. selections.
ALTER TABLE "selections" DROP COLUMN "selection_category";

ALTER TABLE "selections"
  ADD COLUMN "vertical_category" TEXT NOT NULL,
  ADD COLUMN "is_female_reserved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_pwd_reserved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "selection_basis" TEXT NOT NULL,
  ADD COLUMN "selection_run_id" UUID NOT NULL,
  ADD COLUMN "score_id" UUID;

ALTER TABLE "selections" ADD CONSTRAINT "selections_vertical_category_check"
  CHECK ("vertical_category" IN ('ST_OTHERS', 'PVTG'));
ALTER TABLE "selections" ADD CONSTRAINT "selections_one_horizontal_reservation_check"
  CHECK (NOT ("is_female_reserved" AND "is_pwd_reserved"));
ALTER TABLE "selections" ADD CONSTRAINT "selections_selection_basis_check"
  CHECK ("selection_basis" IN ('NO_COMPETITION', 'RANKED_NO_CAP', 'QUOTA'));
ALTER TABLE "selections" ADD CONSTRAINT "selections_selection_status_check"
  CHECK ("selection_status" IN ('PROVISIONAL', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN'));

ALTER TABLE "selections" ADD CONSTRAINT "selections_score_id_fkey"
  FOREIGN KEY ("score_id") REFERENCES "scores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. One live selection per application (a concurrent or repeated run
-- cannot create a duplicate even if the api's own check were bypassed).
CREATE UNIQUE INDEX "selections_one_live_per_application_key"
  ON "selections"("application_id")
  WHERE "selection_status" IN ('PROVISIONAL', 'CONFIRMED');
CREATE INDEX "selections_selection_run_id_idx" ON "selections"("selection_run_id");

-- 3. scores -> rule_evaluations (RESTRICT: evidence must not disappear).
ALTER TABLE "scores" ADD COLUMN "rule_evaluation_id" UUID;
ALTER TABLE "scores" ADD CONSTRAINT "scores_rule_evaluation_id_fkey"
  FOREIGN KEY ("rule_evaluation_id") REFERENCES "rule_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "scores_rule_evaluation_id_idx" ON "scores"("rule_evaluation_id");
