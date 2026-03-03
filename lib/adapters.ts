// adapters.ts — host-delegating tool adapter for the OpenClaw plugin.
//
// Tool steps delegate to the Gateway HTTP API via HostToolAdapter (POST /tools/invoke).

import type { ToolAdapter, ToolDescriptor, ToolResult } from 'workflowskill';

export interface GatewayConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
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
 * Create a ToolAdapter backed by the Gateway HTTP API.
 *
 * HostToolAdapter forwards tool steps to the gateway's POST /tools/invoke endpoint.
 * Self-referencing tools (the plugin's own tools) are blocked to prevent recursion.
 */
export function createToolAdapter(gatewayConfig: GatewayConfig): ToolAdapter {
  return new HostToolAdapter(gatewayConfig);
}
