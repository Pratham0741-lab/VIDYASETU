-- Phase 16 C1 follow-up: the audit trigger records each row by its "id"
-- column (process_audit_log_hash_chain reads NEW.id / OLD.id), and
-- officer_preferences (20261002090000) was keyed by officer_id alone, so
-- every write failed inside the trigger ("record new has no field id";
-- found by the first live PUT, before any row existed). Additive fix: a
-- row id with a default; the table is empty when this runs, and officer_id
-- stays the primary key.
ALTER TABLE "officer_preferences"
  ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "officer_preferences_id_key" ON "officer_preferences" ("id");
