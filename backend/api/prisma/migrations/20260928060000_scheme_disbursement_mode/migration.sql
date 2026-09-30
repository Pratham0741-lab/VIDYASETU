-- Phase 12 Part A (decision D2 on M16): who disburses a scheme's money.
--   SCHEDULED_BY_PLATFORM  instalments are scheduled here and sent to PFMS
--   FORWARDED_TO_STATE     the State pays by DBT; the platform schedules
--                          nothing and shows "disbursement handled by State DBT"
-- Additive: one column, defaulting to the behaviour every scheme had so far.
-- Values per scheme are set by the seed (prisma/seed.ts).
ALTER TABLE "schemes"
  ADD COLUMN "disbursement_mode" TEXT NOT NULL DEFAULT 'SCHEDULED_BY_PLATFORM',
  ADD CONSTRAINT "schemes_disbursement_mode_check"
    CHECK ("disbursement_mode" IN ('SCHEDULED_BY_PLATFORM', 'FORWARDED_TO_STATE'));
