-- Phase 13C (Part B, KNOWN_LIMITATIONS M34): the objection-window override
-- reason needs at least 10 trimmed characters, like every other decision
-- reason (Phase 13B, api/src/common/reason.ts).
--
-- New writes only: a BEFORE trigger that fires only when an override is
-- being MADE - the row is inserted overridden, becomes overridden, or its
-- override_reason changes. A later update of an existing row that leaves
-- the override alone is never re-checked. (0 of the 7 overridden rows at
-- the time of writing have a reason under 10 characters.)
-- selections_override_reason_check (non-blank) is kept unchanged.

CREATE OR REPLACE FUNCTION selections_override_reason_min()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.objection_window_overridden
     AND (TG_OP = 'INSERT'
          OR NOT OLD.objection_window_overridden
          OR OLD.override_reason IS DISTINCT FROM NEW.override_reason)
     AND length(btrim(coalesce(NEW.override_reason, ''))) < 10 THEN
    PERFORM decision_reason_refusal('an objection-window override');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_selections_override_reason_min
  BEFORE INSERT OR UPDATE ON "selections"
  FOR EACH ROW EXECUTE FUNCTION selections_override_reason_min();
