// WorkflowSkill OpenClaw Plugin
//
// Entry point called by OpenClaw when the plugin is loaded.
// Default-exports an object with id + register(api) per the OpenClaw plugin API.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTHORING_SKILL } from 'workflowskill';
import { validateHandler } from './tools/validate.js';
import { runHandler } from './tools/run.js';
import { runsHandler } from './tools/runs.js';
import { createBridgeAdapters } from './lib/adapters.js';

// ─── OpenClaw plugin API types ─────────────────────────────────────────────

/** JSON Schema (subset) for describing tool parameters. */
interface JsonSchemaObject {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  items?: JsonSchemaObject;
  enum?: string[];
}

/** Content block returned by execute handlers. */
interface TextContent {
  type: 'text';
  text: string;
}

/** Specification for registering a tool with OpenClaw. */
interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, JsonSchemaObject>;
    required?: string[];
  };
  execute: (_id: unknown, params: Record<string, unknown>) => Promise<{ content: TextContent[] }>;
}

/** OpenClaw agent config shape (relevant subset). */
interface OpenClawConfig {
  agents?: { defaults?: { workspace?: string } };
}

/** The API object OpenClaw passes to register(). */
interface PluginApi {
  /** OpenClaw configuration object. */
  config: OpenClawConfig;
  /** Register a tool with the OpenClaw agent. */
  registerTool(spec: ToolSpec): void;
  /** Invoke a tool registered with the host agent. */
  invokeTool(name: string, params: Record<string, unknown>): Promise<{ content: TextContent[] }>;
  /** Check whether a tool is registered with the host agent. */
  hasTool(name: string): boolean;
  /** List tools registered with the host agent. Optional. */
  listTools?(): Array<{ name: string; description: string }>;
}

/** Wrap a handler result as an OpenClaw text content response. */
function toContent(result: unknown): { content: TextContent[] } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// ─── Plugin entry point ────────────────────────────────────────────────────

export default {
  id: 'workflowskill',

  register(api: PluginApi): void {
    // Write the canonical authoring skill from the workflowskill package so
    // resolveSkillContent() finds it at the expected plugin-bundled path.
    const skillDir = join(import.meta.dirname, 'skills', 'workflowskill-author');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), AUTHORING_SKILL, 'utf-8');

    const workspace = api?.config?.agents?.defaults?.workspace;
    if (typeof workspace !== 'string' || workspace.length === 0) {
      throw new Error(
        `WorkflowSkill plugin requires a valid workspace path in config.agents.defaults.workspace. Received: ${JSON.stringify(workspace)}`,
      );
    }

    // createBridgeAdapters is async (DevToolAdapter.create initialises tool registrations).
    // Lazy-initialise: create the promise once, await it inside each execute handler.
    const adaptersPromise = createBridgeAdapters(api);
    const { registerTool } = api;

    // ── workflowskill_validate ────────────────────────────────────────────
    registerTool({
      name: 'workflowskill_validate',
      description:
        'Parse and validate a WorkflowSkill SKILL.md or raw YAML. ' +
        'Returns { valid, errors[], name, stepCount, stepTypes[] }. ' +
        'Use before running to catch structural and type errors early.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Full SKILL.md text or raw workflow YAML to validate.',
          },
        },
        required: ['content'],
      },
      execute: async (_id, params) => {
        const adapters = await adaptersPromise;
        return toContent(await validateHandler(params as { content: string }, adapters.toolAdapter));
      },
    });

    // ── workflowskill_run ─────────────────────────────────────────────────
    registerTool({
      name: 'workflowskill_run',
      description:
        'Execute a WorkflowSkill workflow and return the full RunLog JSON. ' +
        'Accepts a skill_name (resolved from skills directories) or inline content. ' +
        'RunLog is persisted to workflow-runs/ automatically.',
      parameters: {
        type: 'object',
        properties: {
          workflow_name: {
            type: 'string',
            description: 'Name of a workflow skill to resolve from skills directories.',
          },
          content: {
            type: 'string',
            description: 'Inline SKILL.md content (alternative to workflow_name).',
          },
          inputs: {
            type: 'object',
            description: 'Input values to override workflow defaults. Optional.',
          },
        },
      },
      execute: async (_id, params) => {
        const adapters = await adaptersPromise;
        return toContent(
          await runHandler(
            params as { workflow_name?: string; content?: string; inputs?: Record<string, unknown> },
            workspace,
            adapters,
          ),
        );
      },
    });

    // ── workflowskill_runs ────────────────────────────────────────────────
    registerTool({
      name: 'workflowskill_runs',
      description:
        'List and inspect past workflow run logs. ' +
        'No params → 20 most recent runs (summary). ' +
        'workflow_name → filter by workflow. ' +
        'run_id → full RunLog detail. ' +
        'status → filter by "success" or "failed". ' +
        'Use for failure diagnosis: find failed run → detail view → explain first failed step.',
      parameters: {
        type: 'object',
        properties: {
          workflow_name: {
            type: 'string',
            description: 'Filter results to a specific workflow by name.',
          },
          run_id: {
            type: 'string',
            description: 'Get the full RunLog for a specific run ID.',
          },
          status: {
            type: 'string',
            enum: ['success', 'failed'],
            description: 'Filter by run status.',
          },
        },
      },
      execute: async (_id, params) => {
        return toContent(
          await runsHandler(
            params as { workflow_name?: string; run_id?: string; status?: string },
            workspace,
          ),
        );
      },
    });

    // ── llm ───────────────────────────────────────────────────────────────────
    registerTool({
      name: 'llm',
      description:
        'Call Anthropic directly and return the text response. ' +
        'Uses the API key from OpenClaw\'s credential store (~/.openclaw/agents/main/agent/auth-profiles.json). ' +
        'Use in workflow tool steps when you need LLM reasoning inline. ' +
        'model is optional (haiku / sonnet / opus or full model ID); omit for the default.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to send to the LLM.',
          },
          model: {
            type: 'string',
            description: 'Model alias or ID. Optional — omit to use the Anthropic default.',
          },
        },
        required: ['prompt'],
      },
      execute: async (_id, params) => {
        const adapters = await adaptersPromise;
        const { prompt, model } = params as { prompt: string; model?: string };
        const result = await adapters.llmAdapter.call(model, prompt);
        return toContent({ text: result.text });
      },
    });
  },
};
