// workflowskill_run — execute a workflow and return the RunLog.
//
// Accepts either a skill_name (resolved from skills directories)
// or inline content. Persists the RunLog to <workspace>/workflow-runs/.

import { runWorkflowSkill } from 'workflowskill';
import type { RunLog } from 'workflowskill';
import type { AdapterSet } from '../lib/adapters.js';
import { resolveSkillContent, saveRunLog } from '../lib/storage.js';

export interface RunParams {
  workflow_name?: string;
  content?: string;
  inputs?: Record<string, unknown>;
}

export async function runHandler(params: RunParams, workspace: string, adapters: AdapterSet): Promise<RunLog> {
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

  // Persist
  try {
    saveRunLog(workspace, log);
  } catch {
    // Persistence failure is non-fatal — still return the log
  }

  return log;
}
