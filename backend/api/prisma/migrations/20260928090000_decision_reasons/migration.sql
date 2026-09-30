-- Phase 13B (Part B): every decision that overrides, corrects, rejects or
-- otherwise changes an outcome carries a reason of at least 10 characters
-- (trimmed), enforced here as well as by the api (REASON_REQUIRED), so a
-- raw write without one fails.
--
-- Existing rows are left exactly as they are:
--   * decision_records is insert-only: its CHECK is added NOT VALID, so the
--     one existing DEFECT row without remarks is never re-checked;
--   * the other tables are updated in place, so they get BEFORE triggers that
--     fire only when a decision is being MADE (the status moves into a
--     decided state, or a confirmation with corrections is recorded) - never
--     on a later update of an old row.
-- The reason is stored in the decision's own row; the AFTER audit trigger
-- then records that row (reason included) in audit_logs.
--
-- Not changed: selections (objection-window override) already has
-- selections_override_reason_check.

-- ---------------------------------------------------------------------------
-- 1. OCR value corrections: where the reason is stored.
-- ---------------------------------------------------------------------------
ALTER TABLE "document_extractions" ADD COLUMN "confirmation_reason" TEXT;

-- ---------------------------------------------------------------------------
-- 2. decision_records: reject, defect, eligibility-review override.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_records"
  ADD CONSTRAINT "decision_records_reason_check" CHECK (
    (decision NOT IN ('REJECT', 'DEFECT')
      AND coalesce(reasons ->> 'eligibility_review_confirmed', '') <> 'true')
    OR length(btrim(coalesce(remarks, ''))) >= 10
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. Transition triggers (one shared refusal message).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION decision_reason_refusal(p_what TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'REASON_REQUIRED: % needs a reason of at least 10 characters', p_what
    USING ERRCODE = 'check_violation';
END;
$$;

-- OCR confirmation that corrects values.
CREATE OR REPLACE FUNCTION enforce_extraction_correction_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.review_status = 'OFFICER_CONFIRMED'
     AND (TG_OP = 'INSERT' OR OLD.review_status IS DISTINCT FROM 'OFFICER_CONFIRMED')
     AND jsonb_typeof(NEW.corrected_fields) = 'array'
     AND jsonb_array_length(NEW.corrected_fields) > 0
     AND length(btrim(coalesce(NEW.confirmation_reason, ''))) < 10 THEN
    PERFORM decision_reason_refusal('an OCR value correction');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trigger_extraction_correction_reason"
  BEFORE INSERT OR UPDATE ON "document_extractions"
  FOR EACH ROW EXECUTE FUNCTION enforce_extraction_correction_reason();

-- Fraud flag disposition (CONFIRMED / FALSE_POSITIVE / NEEDS_MORE_INFO).
CREATE OR REPLACE FUNCTION enforce_fraud_disposition_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status <> 'OPEN'
     AND (TG_OP = 'INSERT'
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at)
     AND length(btrim(coalesce(NEW.review_notes, ''))) < 10 THEN
    PERFORM decision_reason_refusal('a fraud flag disposition');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trigger_fraud_disposition_reason"
  BEFORE INSERT OR UPDATE ON "fraud_flags"
  FOR EACH ROW EXECUTE FUNCTION enforce_fraud_disposition_reason();

-- Renewal discontinuation.
CREATE OR REPLACE FUNCTION enforce_renewal_discontinue_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.verification_status = 'DISCONTINUED'
     AND (TG_OP = 'INSERT' OR OLD.verification_status IS DISTINCT FROM 'DISCONTINUED')
     AND length(btrim(coalesce(NEW.decision_remarks, ''))) < 10 THEN
    PERFORM decision_reason_refusal('a renewal discontinuation');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trigger_renewal_discontinue_reason"
  BEFORE INSERT OR UPDATE ON "renewals"
  FOR EACH ROW EXECUTE FUNCTION enforce_renewal_discontinue_reason();

-- Grievance resolution or rejection.
CREATE OR REPLACE FUNCTION enforce_grievance_resolution_reason()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IN ('RESOLVED', 'REJECTED')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND length(btrim(coalesce(NEW.resolution_note, ''))) < 10 THEN
    PERFORM decision_reason_refusal('a grievance resolution');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "trigger_grievance_resolution_reason"
  BEFORE INSERT OR UPDATE ON "grievances"
  FOR EACH ROW EXECUTE FUNCTION enforce_grievance_resolution_reason();
