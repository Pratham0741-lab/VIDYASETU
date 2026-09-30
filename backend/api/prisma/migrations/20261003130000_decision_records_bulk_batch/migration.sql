-- Phase 17 Part F4: a decision recorded as part of a bulk action carries the
-- batch id, so the workload view can tell bulk from individual decisions.
--
-- Additive and nullable. The value comes from a transaction-local setting the
-- bulk-action service sets before it runs the items
-- (set_config('app.bulk_batch_id', <batch>, true)); every decision inserted in
-- that transaction - through the ordinary single-item path, unchanged - gets
-- it by default, any other insert gets NULL. Rows written before this
-- migration are NULL: earlier bulk decisions cannot be told apart.
ALTER TABLE "decision_records"
  ADD COLUMN "bulk_batch_id" UUID DEFAULT NULLIF(current_setting('app.bulk_batch_id', true), '')::uuid;

CREATE INDEX "decision_records_bulk_batch_id_idx" ON "decision_records" ("bulk_batch_id")
  WHERE "bulk_batch_id" IS NOT NULL;
