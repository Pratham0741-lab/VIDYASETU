-- Phase 14 loose ends Part D1: renewal years are scheduled (M21, plan Phase 14).
--
-- An approved renewal scheduled nothing. Now, in the approving transaction:
--   * the year advance is RECORDED on the renewal (year_advanced_from ->
--     year_advanced_to, at year_advanced_at): the institution-endorsed
--     academic_year_number becomes the recorded PhD year the NFST tier reads.
--     Nothing upgrades a year automatically; the CHECKs below allow exactly
--     one year forward, and only on an APPROVED renewal;
--   * the renewal year's instalments are created as disbursement rows linked
--     to the renewal (renewal_id), the original selection and its sanction
--     order. A renewal that is pending or discontinued schedules nothing.
--
-- Additive: nullable columns, CHECKs that every existing row satisfies (all
-- NULL), one FK and one index. Disbursement guards (the fraud hold guard on
-- initiation, the status CHECK, the no-bank-reference rule) are unchanged.

ALTER TABLE "renewals"
  ADD COLUMN "year_advanced_from" INTEGER,
  ADD COLUMN "year_advanced_to" INTEGER,
  ADD COLUMN "year_advanced_at" TIMESTAMPTZ(6);

ALTER TABLE "renewals" ADD CONSTRAINT "renewals_year_advance_check" CHECK (
  ("year_advanced_to" IS NULL AND "year_advanced_from" IS NULL AND "year_advanced_at" IS NULL)
  OR ("year_advanced_to" IS NOT NULL AND "year_advanced_at" IS NOT NULL
      AND "verification_status" = 'APPROVED'
      AND "year_advanced_to" = "academic_year_number"
      AND ("year_advanced_from" IS NULL OR "year_advanced_to" = "year_advanced_from" + 1))
);

ALTER TABLE "disbursements" ADD COLUMN "renewal_id" UUID;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_renewal_id_fkey"
  FOREIGN KEY ("renewal_id") REFERENCES "renewals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "disbursements_renewal_id_idx" ON "disbursements" ("renewal_id") WHERE "renewal_id" IS NOT NULL;
