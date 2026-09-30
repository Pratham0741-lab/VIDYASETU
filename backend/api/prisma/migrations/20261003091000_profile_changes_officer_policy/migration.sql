-- Phase 17 B4 follow-up: an approved correction is applied through the
-- verified change path, which writes applicant_profile_changes as the
-- deciding officer. That table's only policy (20260930100000) admits the
-- owning applicant, so the officer's insert was refused (found by the first
-- live approval). Additive: officers whose jurisdiction covers the
-- applicant's domicile may read the change log and insert entries they make
-- themselves (changed_by_account_id = the actor). Nothing is updated or
-- deleted (no grant).
CREATE POLICY "officer_applicant_profile_changes_policy" ON "applicant_profile_changes"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "applicants" a
      JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
     WHERE a.id = "applicant_profile_changes".applicant_id
       AND (o.jurisdiction_state IS NULL
            OR (o.jurisdiction_district IS NULL AND a.domicile_state = o.jurisdiction_state)
            OR (a.domicile_state = o.jurisdiction_state AND a.domicile_district = o.jurisdiction_district))));
CREATE POLICY "officer_applicant_profile_changes_insert" ON "applicant_profile_changes"
  FOR INSERT
  WITH CHECK (
    "changed_by_account_id" = NULLIF(current_setting('app.actor_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "applicants" a
        JOIN "officers" o ON o.user_id = NULLIF(current_setting('app.actor_id', true), '')::uuid AND o.is_active = true
       WHERE a.id = "applicant_profile_changes".applicant_id
         AND (o.jurisdiction_state IS NULL
              OR (o.jurisdiction_district IS NULL AND a.domicile_state = o.jurisdiction_state)
              OR (a.domicile_state = o.jurisdiction_state AND a.domicile_district = o.jurisdiction_district))));
