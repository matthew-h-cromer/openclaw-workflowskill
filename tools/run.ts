// workflowskill_run — execute a workflow and return a compact summary.
//
// Accepts either a skill_name (resolved from skills directories)
// or inline content. Persists the full RunLog to <workspace>/workflow-runs/.
// Returns a compact summary to avoid blowing up the calling agent's context.

import { runWorkflowSkill } from 'workflowskill';
import type { RunLog, RunSummary } from 'workflowskill';
import type { AdapterSet } from '../lib/adapters.js';
import { resolveSkillContent, saveRunLog } from '../lib/storage.js';

export interface RunParams {
  workflow_name?: string;
  content?: string;
  inputs?: Record<string, unknown>;
}

interface RunSummarySuccess {
  status: 'success';
  id: string;
  workflow: string;
  duration_ms: number;
  summary: RunSummary;
  outputs: Record<string, unknown>;
}

interface RunSummaryFailed {
  status: 'failed';
  id: string;
  workflow: string;
  duration_ms: number;
  summary: RunSummary;
  error: RunLog['error'];
  failed_step: {
    id: string;
    executor: string;
    error: string | undefined;
  } | undefined;
}

function summarizeRunLog(log: RunLog): RunSummarySuccess | RunSummaryFailed {
  const base = {
    id: log.id,
    workflow: log.workflow,
    duration_ms: log.duration_ms,
    summary: log.summary,
  };

  if (log.status === 'success') {
    return { status: 'success', ...base, outputs: log.outputs };
  }

  const failedStep = log.steps.find((s) => s.status === 'failed');
  return {
    status: 'failed',
    ...base,
    error: log.error,
    failed_step: failedStep
      ? { id: failedStep.id, executor: failedStep.executor, error: failedStep.error }
      : undefined,
  };
}

export async function runHandler(
  params: RunParams,
  workspace: string,
  adapters: AdapterSet,
): Promise<RunSummarySuccess | RunSummaryFailed> {
  const { workflow_name, content: inlineContent, inputs = {} } = params;

  let content = inlineContent ?? '';
  if (!content && workflow_name) {
    content = resolveSkillContent(workspace, workflow_name);
  }

  const { toolAdapter, llmAdapter } = adapters;

  const log: RunLog = await runWorkflowSkill({
    content,
    inputs,
    toolAdapter,
    llmAdapter,
    workflowName: workflow_name ?? 'inline',
  });

  // Persist full log
  try {
    saveRunLog(workspace, log);
  } catch {
    // Persistence failure is non-fatal
  }

  return summarizeRunLog(log);
}
