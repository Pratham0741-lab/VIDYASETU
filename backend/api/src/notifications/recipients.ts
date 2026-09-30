/**
 * Does an officer's jurisdiction cover an application's? The same rule as
 * the applications RLS policy and applicationScopeFor (Phase 2), stated for
 * one (officer, application) pair: NULL state = national; state with NULL
 * district = that state; state + district = that district. (The policy's
 * "assigned officer" branch is about one application's assignee and is not
 * a broadcast audience.) A national-audience intent (no application
 * jurisdiction) covers every officer of the role.
 */
export function officerCovers(
  officer: { jurisdiction_state: string | null; jurisdiction_district: string | null },
  target: { jurisdiction_state: string | null; jurisdiction_district: string | null },
): boolean {
  if (target.jurisdiction_state === null) return true;
  if (officer.jurisdiction_state === null) return true;
  if (officer.jurisdiction_state !== target.jurisdiction_state) return false;
  if (officer.jurisdiction_district === null) return true;
  return officer.jurisdiction_district === target.jurisdiction_district;
}
