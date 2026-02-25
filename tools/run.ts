// workflowskill_run — execute a workflow and return the RunLog.
//
// Accepts either a skill_name (resolved from skills directories)
// or inline content. Persists the RunLog to <workspace>/workflow-runs/.

import { ParseError, parseSkillMd, parseWorkflowFromMd, buildFailedRunLog, runWorkflow } from 'workflowskill';
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

  if (!workflow_name && !inlineContent) {
    const startedAt = new Date();
    return buildFailedRunLog('unknown', {
      phase: 'parse',
      message: 'Either workflow_name or content is required',
    }, startedAt);
  }

  const startedAt = new Date();

  // Read content
  let content: string;
  if (inlineContent) {
    content = inlineContent;
  } else {
    try {
      content = resolveSkillContent(workspace, workflow_name!);
    } catch (err) {
      return buildFailedRunLog(workflow_name ?? 'unknown', {
        phase: 'parse',
        message: `Cannot resolve skill "${workflow_name}": ${err instanceof Error ? err.message : String(err)}`,
      }, startedAt);
    }
  }

  // Parse
  let workflow;
  let resolvedName = workflow_name ?? 'inline';
  try {
    const skill = parseSkillMd(content);
    workflow = skill.workflow;
    resolvedName = skill.frontmatter.name;
  } catch {
    try {
      workflow = parseWorkflowFromMd(content);
    } catch (err) {
      let message: string;
      let details: Array<{ path: string; message: string }> | undefined;
      if (err instanceof ParseError) {
        message = err.message;
        details = err.details.length > 0 ? err.details : undefined;
      } else {
        message = err instanceof Error ? err.message : String(err);
      }
      return buildFailedRunLog(resolvedName, { phase: 'parse', message, details }, startedAt);
    }
  }

  const { toolAdapter, llmAdapter } = adapters;

  // Execute
  let log: RunLog;
  try {
    log = await runWorkflow({
      workflow,
      inputs,
      toolAdapter,
      llmAdapter,
      workflowName: resolvedName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log = buildFailedRunLog(resolvedName, { phase: 'execute', message }, startedAt);
  }

  // Persist
  try {
    saveRunLog(workspace, log);
  } catch {
    // Persistence failure is non-fatal — still return the log
  }

  return log;
}
