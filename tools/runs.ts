// workflowskill_runs — list and inspect past run logs.
//
// No params         → list 20 most recent runs (summary view)
// workflow_name     → filter by workflow name
// run_id            → get full RunLog detail for one run
// status            → filter by "success" or "failed"

import type { RunLog } from 'workflowskill';
import { getRunLog, listRuns, type RunSummaryEntry } from '../lib/storage.js';

export interface RunsParams {
  workflow_name?: string;
  run_id?: string;
  status?: string;
}

export type RunsResult = RunSummaryEntry[] | RunLog | { error: string };

const RECENT_LIMIT = 20;

export function runsHandler(params: RunsParams, workspace: string): RunsResult {
  const { workflow_name, run_id, status } = params;

  // Detail view — return full RunLog for a specific run
  if (run_id) {
    const log = getRunLog(workspace, run_id);
    if (!log) {
      return { error: `No run found with id "${run_id}"` };
    }
    return log;
  }

  // Summary view — list and filter
  const entries = listRuns(workspace, {
    workflow_name,
    status,
  });

  return entries.slice(0, RECENT_LIMIT);
}
