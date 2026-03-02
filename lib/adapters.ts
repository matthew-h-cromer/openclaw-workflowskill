// adapters.ts — host-delegating adapters for the OpenClaw plugin.
//
// Tool steps delegate to the Gateway HTTP API via HostToolAdapter (POST /tools/invoke).
// LLM steps use AnthropicLLMAdapter with the API key read directly from
// OpenClaw's credential store at ~/.openclaw/agents/main/agent/auth-profiles.json.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LLMAdapter, ToolAdapter, ToolDescriptor, ToolResult } from 'workflowskill';
import { AnthropicLLMAdapter, BuiltinToolAdapter } from 'workflowskill';

// Tools served locally by BuiltinToolAdapter (html.select, http.request, etc.)
// These bypass the gateway and run in-process.
const DEV_TOOL_NAMES = new Set(['html.select', 'http.request']);

// Lazy singleton — BuiltinToolAdapter.create() is async so we initialize on first use.
let _devToolsPromise: Promise<BuiltinToolAdapter> | null = null;
function getDevTools(): Promise<BuiltinToolAdapter> {
  if (!_devToolsPromise) {
    _devToolsPromise = BuiltinToolAdapter.create();
  }
  return _devToolsPromise as Promise<BuiltinToolAdapter>;
}

export interface GatewayConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

export interface AdapterSet {
  toolAdapter: ToolAdapter;
  llmAdapter: LLMAdapter;
}

// Tools this plugin registers — must not be forwarded to the gateway to prevent infinite recursion.
const SELF_REFERENCING_TOOLS = new Set([
  'workflowskill_validate',
  'workflowskill_run',
  'workflowskill_runs',
  'workflowskill_llm',
]);

/** ToolAdapter that delegates to the Gateway HTTP API via POST /tools/invoke. */
export class HostToolAdapter implements ToolAdapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: GatewayConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  has(toolName: string): boolean {
    return !SELF_REFERENCING_TOOLS.has(toolName);
  }

  async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (SELF_REFERENCING_TOOLS.has(toolName)) {
      return {
        output: null,
        error: `Tool '${toolName}' cannot be called from within a workflow (self-referencing).`,
      };
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ tool: toolName, args }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return {
        output: null,
        error: `Tool '${toolName}' invocation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (response.status === 200) {
      const result = (await response.json()) as unknown;
      return { output: result };
    }
    if (response.status === 404) {
      return { output: null, error: `Tool '${toolName}' not found or blocked by the gateway.` };
    }
    if (response.status === 401) {
      return {
        output: null,
        error: `Tool '${toolName}' invocation failed: unauthorized. Check your gateway token.`,
      };
    }
    if (response.status === 429) {
      return {
        output: null,
        error: `Tool '${toolName}' invocation failed: rate limited by gateway.`,
      };
    }
    const body = await response.text().catch(() => '');
    return {
      output: null,
      error: `Tool '${toolName}' invocation failed: HTTP ${response.status}${body ? `: ${body}` : ''}`,
    };
  }

  list(): ToolDescriptor[] {
    return [];
  }
}

/**
 * Read the Anthropic API key from OpenClaw's credential store.
 * Throws a clear error if the file is missing or has no anthropic profile.
 */
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
  // Prefer the profile OpenClaw last used successfully for anthropic.
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

/**
 * Create host adapters backed by the Gateway HTTP API.
 *
 * HostToolAdapter forwards tool steps to the gateway's POST /tools/invoke endpoint.
 * Self-referencing tools (the plugin's own four tools) are blocked to prevent recursion.
 * LLM steps use AnthropicLLMAdapter with the key read from OpenClaw's credential store.
 */
export function createAdapters(gatewayConfig: GatewayConfig): AdapterSet {
  const hostTools = new HostToolAdapter(gatewayConfig);
  const llmAdapter = new AnthropicLLMAdapter(readAnthropicApiKey());

  const LLM_COMPLETE = 'workflowskill_llm';
  const LLM_COMPLETE_DESCRIPTOR: ToolDescriptor = {
    name: LLM_COMPLETE,
    description: 'Call the host LLM with a prompt; returns { text }.',
  };

  const toolAdapter: ToolAdapter = {
    has(toolName: string): boolean {
      if (toolName === LLM_COMPLETE) return true;
      if (DEV_TOOL_NAMES.has(toolName)) return true;
      return hostTools.has(toolName);
    },
    async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
      if (toolName === LLM_COMPLETE) {
        const result = await llmAdapter.call(
          args.model as string | undefined,
          args.prompt as string,
        );
        return { output: { text: result.text } };
      }
      if (DEV_TOOL_NAMES.has(toolName)) {
        const devTools = await getDevTools();
        return devTools.invoke(toolName, args);
      }
      return hostTools.invoke(toolName, args);
    },
    list(): ToolDescriptor[] {
      const hostToolList = hostTools.list();
      return [
        LLM_COMPLETE_DESCRIPTOR,
        ...hostToolList.filter((t) => t.name !== LLM_COMPLETE),
      ];
    },
  };

  return {
    toolAdapter,
    llmAdapter,
  };
}
