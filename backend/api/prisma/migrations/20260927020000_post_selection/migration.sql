-- ============================================================================
-- SMART INDIA HACKATHON (SIH) - MINISTRY OF TRIBAL AFFAIRS SCHOLARSHIP PORTAL
-- Migration: 20260927020000_post_selection
--
-- Phase 9 (post-selection management). No existing migration, RLS policy or
-- audit function is changed. New policies below are ADDED to tables that
-- had none, copying the existing "cascade via applications" policy shape.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. selections: confirmation + objection-window override.
--    CONFIRMED already exists in selections_selection_status_check (Phase 6).
--    The objection window is not stored: it closes OBJECTION_WINDOW_DAYS
--    (config) after the selection run completed (the row's created_at).
-- ---------------------------------------------------------------------------
ALTER TABLE "selections"
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirmed_by_officer_id" UUID,
  ADD COLUMN "objection_window_overridden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" TEXT;
ALTER TABLE "selections" ADD CONSTRAINT "selections_confirmed_by_officer_id_fkey"
  FOREIGN KEY ("confirmed_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selections" ADD CONSTRAINT "selections_confirmation_check"
  CHECK (("selection_status" = 'CONFIRMED') = ("confirmed_at" IS NOT NULL AND "confirmed_by_officer_id" IS NOT NULL));
ALTER TABLE "selections" ADD CONSTRAINT "selections_override_reason_check"
  CHECK (NOT "objection_window_overridden" OR length(btrim(coalesce("override_reason", ''))) > 0);

-- ---------------------------------------------------------------------------
-- 2. sanction_orders: one per CONFIRMED selection. content is the canonical
--    order data; content_sha256 = SHA-256 of its canonical JSON (sorted keys,
--    no whitespace) - the PDF bytes are not hashed (they embed timestamps).
-- ---------------------------------------------------------------------------
CREATE TABLE "sanction_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "selection_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "content_sha256" TEXT NOT NULL,
    "pdf_storage_key" TEXT NOT NULL,
    "generated_by_officer_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sanction_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sanction_orders_sha256_check" CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "sanction_orders_selection_id_key" ON "sanction_orders"("selection_id");
CREATE INDEX "sanction_orders_application_id_idx" ON "sanction_orders"("application_id");
ALTER TABLE "sanction_orders" ADD CONSTRAINT "sanction_orders_selection_id_fkey"
  FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sanction_orders" ADD CONSTRAINT "sanction_orders_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sanction_orders" ADD CONSTRAINT "sanction_orders_generated_by_officer_id_fkey"
  FOREIGN KEY ("generated_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. disbursements: currency, links, schedule, reconciliation, status CHECK.
--    NO bank-account reference of any kind is stored here (Phase 3
--    sensitive-field policy: bank_account is sensitive; a masked or partial
--    reference would still be derived from it). Correlating a disbursement
--    with a bank account means decrypting the Applicant row through the
--    existing PII extension - by design, not an oversight.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "disbursements") THEN
    RAISE EXCEPTION 'disbursements is not empty: backfill currency / selection_id by hand first';
  END IF;
END $$;
ALTER TABLE "disbursements"
  ADD COLUMN "currency" TEXT NOT NULL,
  ADD COLUMN "selection_id" UUID NOT NULL,
  ADD COLUMN "sanction_order_id" UUID NOT NULL,
  ADD COLUMN "academic_year" TEXT NOT NULL,
  ADD COLUMN "scheduled_date" DATE NOT NULL,
  ADD COLUMN "benefit_lines" JSONB NOT NULL,
  ADD COLUMN "initiated_by_officer_id" UUID,
  ADD COLUMN "reconciled_by_officer_id" UUID,
  ADD COLUMN "reconciled_at" TIMESTAMPTZ(6);
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_status_check"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED'));
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_amount_check" CHECK ("amount" > 0);
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_selection_id_fkey"
  FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_sanction_order_id_fkey"
  FOREIGN KEY ("sanction_order_id") REFERENCES "sanction_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_initiated_by_officer_id_fkey"
  FOREIGN KEY ("initiated_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_reconciled_by_officer_id_fkey"
  FOREIGN KEY ("reconciled_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "disbursements_application_installment_currency_key"
  ON "disbursements"("application_id", "installment_no", "currency", "beneficiary_type");
CREATE UNIQUE INDEX "disbursements_transaction_reference_key"
  ON "disbursements"("transaction_reference") WHERE "transaction_reference" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. renewals: progress report, endorsement, continuation check, decision.
--    verification_status is the renewal's state.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "renewals") THEN
    RAISE EXCEPTION 'renewals is not empty: backfill scheme_version_id / progress_report by hand first';
  END IF;
END $$;
ALTER TABLE "renewals"
  ADD COLUMN "scheme_version_id" UUID NOT NULL,
  ADD COLUMN "progress_report" TEXT NOT NULL,
  ADD COLUMN "submitted_by_account_id" UUID,
  ADD COLUMN "endorsed_by_officer_id" UUID,
  ADD COLUMN "endorsed_at" TIMESTAMPTZ(6),
  ADD COLUMN "endorsement_remarks" TEXT,
  ADD COLUMN "continuation_rule_id" TEXT,
  ADD COLUMN "continuation_verdict" TEXT,
  ADD COLUMN "continuation_evaluation_run_id" UUID,
  ADD COLUMN "continuation_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "decided_by_officer_id" UUID,
  ADD COLUMN "decision_remarks" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_verification_status_check"
  CHECK ("verification_status" IN ('PENDING', 'ENDORSED', 'APPROVED', 'DISCONTINUED'));
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_continuation_verdict_check"
  CHECK ("continuation_verdict" IS NULL OR "continuation_verdict" IN ('PASS', 'FAIL', 'ERROR'));
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_decision_check"
  CHECK (("verification_status" IN ('APPROVED', 'DISCONTINUED')) = ("decided_by_officer_id" IS NOT NULL AND "verified_at" IS NOT NULL));
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_scheme_version_id_fkey"
  FOREIGN KEY ("scheme_version_id") REFERENCES "scheme_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_endorsed_by_officer_id_fkey"
  FOREIGN KEY ("endorsed_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_decided_by_officer_id_fkey"
  FOREIGN KEY ("decided_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "renewals_parent_application_year_key"
  ON "renewals"("parent_application_id", "academic_year_number");

-- Renewal RLS gap: the init migration enabled RLS on seven application-
-- owned tables and left renewals out. No code wrote renewals before this
-- phase (0 rows, 0 audit rows in every deployment built from these
-- migrations), so nothing was exposed; it is closed here, before the first
-- write path exists.
ALTER TABLE "renewals" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. grievances. Every grievance concerns one application (jurisdiction and
--    RLS flow from it); what it is about is explicit: the application
--    itself, one selection, one disbursement, or - an objection - a
--    selection run in which the application was NOT selected (such
--    applications have no selections row, Phase 6). Explicit nullable FKs,
--    not a polymorphic (type, id) pair: every reference keeps real
--    referential integrity, and a CHECK ties each subject type to its column.
-- ---------------------------------------------------------------------------
CREATE TABLE "grievances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "raised_by_applicant_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "selection_id" UUID,
    "disbursement_id" UUID,
    "selection_run_id" UUID,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "status_entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sla_due_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "resolved_by_officer_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "grievances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "grievances_status_check" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED')),
    CONSTRAINT "grievances_subject_check" CHECK (
      ("subject_type" = 'APPLICATION' AND "selection_id" IS NULL AND "disbursement_id" IS NULL AND "selection_run_id" IS NULL)
      OR ("subject_type" = 'SELECTION' AND "selection_id" IS NOT NULL AND "disbursement_id" IS NULL AND "selection_run_id" IS NULL)
      OR ("subject_type" = 'DISBURSEMENT' AND "disbursement_id" IS NOT NULL AND "selection_id" IS NULL AND "selection_run_id" IS NULL)
      OR ("subject_type" = 'SELECTION_OBJECTION' AND "selection_run_id" IS NOT NULL AND "selection_id" IS NULL AND "disbursement_id" IS NULL)
    ),
    CONSTRAINT "grievances_resolution_check" CHECK (
      ("status" IN ('RESOLVED', 'REJECTED')) = ("resolved_by_officer_id" IS NOT NULL AND "resolved_at" IS NOT NULL AND "resolution_note" IS NOT NULL)
    )
);
CREATE INDEX "grievances_application_id_idx" ON "grievances"("application_id");
CREATE INDEX "grievances_status_sla_idx" ON "grievances"("status", "sla_due_at");
CREATE INDEX "grievances_selection_run_id_idx" ON "grievances"("selection_run_id");
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_raised_by_applicant_id_fkey"
  FOREIGN KEY ("raised_by_applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_selection_id_fkey"
  FOREIGN KEY ("selection_id") REFERENCES "selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_disbursement_id_fkey"
  FOREIGN KEY ("disbursement_id") REFERENCES "disbursements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grievances" ADD CONSTRAINT "grievances_resolved_by_officer_id_fkey"
  FOREIGN KEY ("resolved_by_officer_id") REFERENCES "officers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. RLS + audit for the new / newly protected tables. The policy body is
--    the existing "officer jurisdiction or owning applicant, via the parent
--    application" shape used by documents, decision_records, deficiencies,
--    scores, selections and disbursements - copied, not changed.
-- ---------------------------------------------------------------------------
ALTER TABLE "sanction_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "grievances" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "officer_jurisdiction_renewals_policy" ON "renewals"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = renewals.parent_application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = renewals.parent_application_id AND app.applicant_id = a.id
  )
);

CREATE POLICY "officer_jurisdiction_sanction_orders_policy" ON "sanction_orders"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = sanction_orders.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = sanction_orders.application_id AND app.applicant_id = a.id
  )
);

CREATE POLICY "officer_jurisdiction_grievances_policy" ON "grievances"
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
    WHERE app.id = grievances.application_id
      AND (
        o.jurisdiction_state IS NULL
        OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
        OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
        OR app.assigned_officer_id = o.id
      )
  )
  OR EXISTS (
    SELECT 1 FROM "applications" app
    JOIN "applicants" a ON a.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    WHERE app.id = grievances.application_id AND app.applicant_id = a.id
  )
);

DROP TRIGGER IF EXISTS trigger_audit_sanction_orders ON "sanction_orders";
CREATE TRIGGER trigger_audit_sanction_orders
AFTER INSERT OR UPDATE OR DELETE ON "sanction_orders"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();

DROP TRIGGER IF EXISTS trigger_audit_grievances ON "grievances";
CREATE TRIGGER trigger_audit_grievances
AFTER INSERT OR UPDATE OR DELETE ON "grievances"
FOR EACH ROW EXECUTE FUNCTION process_audit_log_hash_chain();
