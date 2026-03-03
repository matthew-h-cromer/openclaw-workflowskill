// workflowskill_llm — call Anthropic LLM using OpenClaw's credential store.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface LlmParams {
  prompt: string;
  model?: string;
}

const MODEL_ALIASES: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_TIMEOUT_MS = 60_000;

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
  return data.content.find((b) => b.type === 'text')?.text ?? '';
}

export async function llmHandler(params: LlmParams): Promise<string> {
  const { prompt, model = DEFAULT_MODEL } = params;
  const apiKey = readAnthropicApiKey();
  return callAnthropic(apiKey, model, prompt);
}
