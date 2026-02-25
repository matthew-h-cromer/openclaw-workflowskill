// storage.ts — RunLog file operations and skill resolution for the OpenClaw plugin.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunLog } from 'workflowskill';

/** Path to the run-logs directory inside the workspace. */
export function runsDir(workspace: string): string {
  return join(workspace, 'workflow-runs');
}

/**
 * Resolve a skill's SKILL.md content by name.
 *
 * Search order:
 *   1. <workspace>/skills/<name>/SKILL.md
 *   2. <plugin-dir>/skills/<name>/SKILL.md  (bundled skills)
 *
 * Throws with a descriptive error listing all searched paths if not found.
 */
export function resolveSkillContent(workspace: string, name: string): string {
  const workspacePath = join(workspace, 'skills', name, 'SKILL.md');
  if (existsSync(workspacePath)) {
    return readFileSync(workspacePath, 'utf-8');
  }

  const pluginPath = join(import.meta.dirname, '..', 'skills', name, 'SKILL.md');
  if (existsSync(pluginPath)) {
    return readFileSync(pluginPath, 'utf-8');
  }

  throw new Error(
    `Skill "${name}" not found. Searched:\n  ${workspacePath}\n  ${pluginPath}`,
  );
}

/** Persist a RunLog to <workspace>/workflow-runs/<name>-<timestamp>.json. */
export function saveRunLog(workspace: string, log: RunLog): string {
  const dir = runsDir(workspace);
  mkdirSync(dir, { recursive: true });
  const safeTimestamp = log.started_at.replace(/:/g, '-');
  const filename = `${log.workflow}-${safeTimestamp}.json`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(log, null, 2) + '\n', 'utf-8');
  return path;
}

export interface RunSummaryEntry {
  id: string;
  workflow: string;
  status: string;
  started_at: string;
  duration_ms: number;
  steps_executed: number;
  steps_skipped: number;
  total_tokens: number;
  error_message?: string;
}

/** Read all RunLog files and return summary entries, newest first. */
export function listRuns(
  workspace: string,
  filter?: { workflow_name?: string; status?: string },
): RunSummaryEntry[] {
  const dir = runsDir(workspace);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const entries: RunSummaryEntry[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const log = JSON.parse(raw) as RunLog;

      if (filter?.workflow_name && log.workflow !== filter.workflow_name) continue;
      if (filter?.status && log.status !== filter.status) continue;

      entries.push({
        id: log.id,
        workflow: log.workflow,
        status: log.status,
        started_at: log.started_at,
        duration_ms: log.duration_ms,
        steps_executed: log.summary.steps_executed,
        steps_skipped: log.summary.steps_skipped,
        total_tokens: log.summary.total_tokens,
        error_message: log.error?.message,
      });
    } catch {
      // Skip corrupt files
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return entries;
}

/** Read a single RunLog by run ID. Returns null if not found. */
export function getRunLog(workspace: string, runId: string): RunLog | null {
  const dir = runsDir(workspace);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return null;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const log = JSON.parse(raw) as RunLog;
      if (log.id === runId) return log;
    } catch {
      // Skip corrupt files
    }
  }
  return null;
}
