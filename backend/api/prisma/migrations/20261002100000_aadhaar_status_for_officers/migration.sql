-- Phase 16 C2 (M55): in-jurisdiction officers see an applicant's Aadhaar
-- authentication status - the outcome, and the last four digits where an
-- authentication was recorded - never the number (not stored) and never
-- the keyed hash.
--
-- aadhaar_authentications stays owner-only (RLS). This function reads it as
-- its owner, narrowly: it answers only when the transaction's actor is an
-- active officer holding one of the four reviewer roles (the role in
-- app.actor_role must be the officer's own) whose jurisdiction covers the
-- application - the same rule as the applications policy. Anyone else
-- (other officers, AUDITOR, COMMITTEE, applicants, no actor) gets no row.

CREATE OR REPLACE FUNCTION aadhaar_status_for_application(p_application_id UUID)
RETURNS TABLE (outcome TEXT, uid_last4 TEXT, authenticated_at TIMESTAMPTZ)
SET search_path = public, pg_temp
SECURITY DEFINER
STABLE
AS $$
#variable_conflict use_column
DECLARE
  v_role TEXT := NULLIF(current_setting('app.actor_role', true), '');
  v_actor TEXT := NULLIF(current_setting('app.actor_id', true), '');
  v_applicant UUID;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL OR v_role NOT IN
     ('INSTITUTE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'STATE_NODAL_OFFICER', 'MINISTRY_OFFICER') THEN
    RETURN;
  END IF;
  SELECT app.applicant_id INTO v_applicant
    FROM applications app
    JOIN officers o ON o.user_id = v_actor::uuid AND o.is_active = true
    JOIN roles r ON r.id = o.role_id AND r.name = v_role
   WHERE app.id = p_application_id
     AND (o.jurisdiction_state IS NULL
          OR (o.jurisdiction_district IS NULL AND app.jurisdiction_state = o.jurisdiction_state)
          OR (app.jurisdiction_state = o.jurisdiction_state AND app.jurisdiction_district = o.jurisdiction_district)
          OR app.assigned_officer_id = o.id);
  IF v_applicant IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT coalesce(x.outcome, 'NOT_ATTEMPTED'), x.uid_last4, x.created_at
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT a.outcome, a.uid_last4, a.created_at FROM aadhaar_authentications a
       WHERE a.applicant_id = v_applicant ORDER BY a.created_at DESC, a.id LIMIT 1) x ON TRUE;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION aadhaar_status_for_application(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aadhaar_status_for_application(UUID) TO app_user;
