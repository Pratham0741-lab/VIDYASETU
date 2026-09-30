import type { DbClient } from '../database/db-client';

/**
 * Phase 13E: the selection list of a run, if the run has one (runs before
 * Phase 13E have none). Lists carry no personal data and have no row-level
 * security. A separate file so the post-selection services can ask without
 * importing SelectionListsService (which imports them).
 */
export function listForRun(client: DbClient, runId: string) {
  return client.selectionList.findUnique({
    where: { selection_run_id: runId },
    select: { id: true, status: true, window_closes_at: true, window_closed_at: true },
  });
}
