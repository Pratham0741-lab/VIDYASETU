-- Phase 17 B4 follow-up: the change log's field list (20260930100000) named
-- only the applicant-editable fields (phone, preferred_language). A verified
-- correction also changes first_name, last_name, dob or gender (the fields
-- correction_requests allows). The CHECK is recreated with those added; every
-- existing row satisfies it. Field NAMES only, as before - never values.
ALTER TABLE "applicant_profile_changes" DROP CONSTRAINT "applicant_profile_changes_fields_check";
ALTER TABLE "applicant_profile_changes" ADD CONSTRAINT "applicant_profile_changes_fields_check" CHECK (
  cardinality("changed_fields") >= 1
  AND "changed_fields" <@ ARRAY['phone', 'preferred_language', 'first_name', 'last_name', 'dob', 'gender']::text[]
);
