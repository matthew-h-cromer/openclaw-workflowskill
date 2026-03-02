// adapters.ts — bridge adapters for the OpenClaw plugin.
//
// Tool steps use DevToolAdapter (ships with workflowskill, handles http.request,
// html.select, etc.) since the host OpenClaw agent may not implement invokeTool.
// LLM steps use AnthropicLLMAdapter with the API key read directly from
// OpenClaw's credential store at ~/.openclaw/agents/main/agent/auth-profiles.json.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LLMAdapter, ToolAdapter, ToolDescriptor, ToolResult } from 'workflowskill';
import { AnthropicLLMAdapter, DevToolAdapter } from 'workflowskill';

/** Content block returned by the OpenClaw bridge. */
interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Subset of PluginApi used by the bridge adapters.
 * Decouples adapter module from the full PluginApi shape.
 */
export interface BridgeApi {
  invokeTool(name: string, params: Record<string, unknown>): Promise<{ content: TextContent[] }>;
  hasTool?(name: string): boolean; // optional — may not be implemented by all host versions
  listTools?(): Array<{ name: string; description: string }>;
}

export interface AdapterSet {
  toolAdapter: ToolAdapter;
  llmAdapter: LLMAdapter;
}

/** ToolAdapter that delegates to the host OpenClaw agent. */
export class BridgeToolAdapter implements ToolAdapter {
  constructor(private readonly api: BridgeApi) {}

  has(toolName: string): boolean {
    if (typeof this.api.hasTool !== 'function') return true; // assume available if host doesn't expose hasTool
    return this.api.hasTool(toolName);
  }

  async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    let response: { content: TextContent[] };
    try {
      response = await this.api.invokeTool(toolName, args);
    } catch (err) {
      return {
        output: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    try {
      return { output: JSON.parse(text) as unknown };
    } catch {
      // Plain-text fallback — tool returned non-JSON
      return { output: text };
    }
  }

  list(): ToolDescriptor[] {
    if (!this.api.listTools) return [];
    return this.api.listTools().map((t) => ({ name: t.name, description: t.description }));
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
  const profile = lastGoodName ? profiles[lastGoodName] : Object.values(profiles).find((p) => p.provider === 'anthropic');
  if (!profile?.key) {
    throw new Error(
      `WorkflowSkill: no anthropic profile found in ${profilesPath}. Add a profile with provider "anthropic" and a key.`,
    );
  }
  return profile.key;
}

/**
 * Create bridge adapters backed by the host OpenClaw agent.
 *
 * Tool steps are handled by DevToolAdapter (native http.request, html.select, etc.)
 * since host OpenClaw versions may not implement api.invokeTool.
 * LLM steps use AnthropicLLMAdapter with the key read from OpenClaw's credential store.
 */
export async function createBridgeAdapters(api: BridgeApi): Promise<AdapterSet> {
  // DevToolAdapter handles http.request, html.select, gmail.*, sheets.* natively.
  // Falls back to BridgeToolAdapter for host-registered tools not in the dev set.
  const devAdapter = await DevToolAdapter.create({});
  const bridgeTool = new BridgeToolAdapter(api);

  const llmAdapter = new AnthropicLLMAdapter(readAnthropicApiKey());

  const LLM_COMPLETE = 'llm';
  const LLM_COMPLETE_DESCRIPTOR: ToolDescriptor = {
    name: LLM_COMPLETE,
    description: 'Call the host LLM with a prompt; returns { text }.',
  };

  const toolAdapter: ToolAdapter = {
    has(toolName: string): boolean {
      if (toolName === LLM_COMPLETE) return true;
      return devAdapter.has(toolName) || bridgeTool.has(toolName);
    },
    async invoke(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
      if (toolName === LLM_COMPLETE) {
        const result = await llmAdapter.call(
          args.model as string | undefined,
          args.prompt as string,
        );
        return { output: { text: result.text } };
      }
      if (devAdapter.has(toolName)) return devAdapter.invoke(toolName, args);
      return bridgeTool.invoke(toolName, args);
    },
    list(): ToolDescriptor[] {
      const devTools = devAdapter.list?.() ?? [];
      const bridgeTools = bridgeTool.list?.() ?? [];
      const seen = new Set([LLM_COMPLETE, ...devTools.map((t) => t.name)]);
      return [
        LLM_COMPLETE_DESCRIPTOR,
        ...devTools,
        ...bridgeTools.filter((t) => !seen.has(t.name)),
      ];
    },
  };

  return {
    toolAdapter,
    llmAdapter,
  };
}
