// WorkflowSkill OpenClaw Plugin
//
// Entry point called by OpenClaw when the plugin is loaded.
// Default-exports an object with id + register(api) per the OpenClaw plugin API.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AUTHORING_SKILL } from 'workflowskill';
import { validateHandler } from './tools/validate.js';
import { runHandler } from './tools/run.js';
import { runsHandler } from './tools/runs.js';
import { createToolAdapter, type GatewayConfig } from './lib/adapters.js';

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
  gateway?: {
    port?: number;
    bind?: string;
    auth?: { token?: string; password?: string };
  };
}

/** The API object OpenClaw passes to register(). */
interface PluginApi {
  /** OpenClaw configuration object. */
  config: OpenClawConfig;
  /** Register a tool with the OpenClaw agent. */
  registerTool(spec: ToolSpec): void;
}

/** Build a GatewayConfig from the OpenClaw config. Throws if auth is missing. */
function buildGatewayConfig(config: OpenClawConfig): GatewayConfig {
  const token = config?.gateway?.auth?.token;
  if (!token) {
    throw new Error(
      'WorkflowSkill plugin requires gateway auth to be configured. ' +
        'Set config.gateway.auth.token in your OpenClaw configuration.',
    );
  }
  // 'loopback' is an OpenClaw keyword meaning 127.0.0.1 — normalise to localhost.
  const rawBind = config?.gateway?.bind ?? 'localhost';
  const bind = rawBind === 'loopback' ? 'localhost' : rawBind;
  const port = config?.gateway?.port ?? 3000;
  return { baseUrl: `http://${bind}:${port}`, token };
}

/** Wrap a handler result as an OpenClaw text content response. */
function toContent(result: unknown): { content: TextContent[] } {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// ─── LLM helpers ───────────────────────────────────────────────────────────

const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function readAnthropicApiKey(): string {
  const profilesPath = join(homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
  let parsed: {
    profiles?: Record<string, { provider?: string; key?: string }>;
    lastGood?: Record<string, string>;
  };
  try {
    parsed = JSON.parse(readFileSync(profilesPath, 'utf-8')) as typeof parsed;
  } catch (err) {
    throw new Error(
      `WorkflowSkill: could not read OpenClaw auth profiles from ${profilesPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const profiles = parsed.profiles ?? {};
  const lastGoodName = parsed.lastGood?.['anthropic'];
  const profile = lastGoodName
    ? profiles[lastGoodName]
    : Object.values(profiles).find((p) => p.provider === 'anthropic');
  if (!profile?.key) {
    throw new Error(
      `WorkflowSkill: no anthropic profile found in ${profilesPath}. Add a profile with provider "anthropic" and a key.`,
    );
  }
  return profile.key;
}

const ANTHROPIC_TIMEOUT_MS = 60_000;

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const resolvedModel = MODEL_ALIASES[model] ?? model;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: resolvedModel,
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }
  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '';
  return text;
}

// ─── Plugin entry point ────────────────────────────────────────────────────

export default {
  id: 'openclaw-workflowskill',

  register(api: PluginApi): void {
    const workspace = api?.config?.agents?.defaults?.workspace;
    if (typeof workspace !== 'string' || workspace.length === 0) {
      throw new Error(
        `WorkflowSkill plugin requires a valid workspace path in config.agents.defaults.workspace. Received: ${JSON.stringify(workspace)}`,
      );
    }

    // Write the canonical authoring skill from the workflowskill package so
    // resolveSkillContent() finds it at the expected plugin-bundled path.
    // Append OpenClaw-specific context.
    const skillDir = join(import.meta.dirname, 'skills', 'workflowskill-author');
    mkdirSync(skillDir, { recursive: true });
    const contextPath = join(import.meta.dirname, 'lib', 'openclaw-context.md');
    const openclawContext = readFileSync(contextPath, 'utf-8')
      .replace(/\{\{workspace\}\}/g, workspace);
    writeFileSync(join(skillDir, 'SKILL.md'), AUTHORING_SKILL + '\n' + openclawContext, 'utf-8');

    const gatewayConfig = buildGatewayConfig(api.config);
    const toolAdapter = createToolAdapter(gatewayConfig);
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
        return toContent(validateHandler(params as { content: string }, toolAdapter));
      },
    });

    // ── workflowskill_run ─────────────────────────────────────────────────
    registerTool({
      name: 'workflowskill_run',
      description:
        'Execute a WorkflowSkill workflow and return a compact run summary. ' +
        'Accepts a skill_name (resolved from skills directories) or inline content. ' +
        'The full RunLog is persisted to workflow-runs/ automatically. ' +
        'Use workflowskill_runs with run_id to retrieve full step-level detail.',
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
        return toContent(
          await runHandler(
            params as { workflow_name?: string; content?: string; inputs?: Record<string, unknown> },
            workspace,
            toolAdapter,
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

    // ── workflowskill_llm ─────────────────────────────────────────────────
    registerTool({
      name: 'workflowskill_llm',
      description:
        'Call the Anthropic LLM and return { text }. ' +
        'Uses the API key from OpenClaw\'s credential store. ' +
        'Use in workflow tool steps when you need LLM reasoning inline. ' +
        'model is optional (haiku / sonnet / opus or full model ID); omit for haiku.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to send to the LLM.',
          },
          model: {
            type: 'string',
            description: 'Model alias (haiku/sonnet/opus) or full model ID. Optional.',
          },
        },
        required: ['prompt'],
      },
      execute: async (_id, params) => {
        const { prompt, model = DEFAULT_MODEL } = params as { prompt: string; model?: string };
        const apiKey = readAnthropicApiKey();
        const text = await callAnthropic(apiKey, model, prompt);
        return toContent({ text });
      },
    });

  },
};
