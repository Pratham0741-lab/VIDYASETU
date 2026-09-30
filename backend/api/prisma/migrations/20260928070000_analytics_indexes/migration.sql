-- Phase 12 Part B (analytics): every analytics view starts from the cohort
-- of applications submitted in a bounded [from, to) window, optionally for
-- one scheme. Additive: an index only; no table, policy or grant changes.
-- (workflow_transitions (application_id, created_at), fraud_flags
-- (application_id, status), disbursements (application_id, status) and
-- test_fixtures (entity_type, entity_id) are already indexed.)
CREATE INDEX "applications_submitted_at_scheme_id_idx"
  ON "applications" ("submitted_at", "scheme_id");
