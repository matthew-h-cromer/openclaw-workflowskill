# OpenClaw WorkflowSkill Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=20](https://img.shields.io/badge/Node-%3E%3D20-green.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/matthew-h-cromer/openclaw-workflowskill/issues)

> [!IMPORTANT]
> **Pre-release.** This plugin tracks the [WorkflowSkill](https://github.com/matthew-h-cromer/workflowskill) spec, which is not yet frozen. Expect breaking changes as the spec evolves.

Author, validate, run, and review WorkflowSkill workflows — without leaving the OpenClaw chat.

1. Tell the agent what you need
2. The agent writes, validates, and test-runs the workflow in chat
3. Schedule it with cron — runs autonomously, no agent session needed

## Repositories

| Repo                                                               | Description                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [workflowskill](https://github.com/matthew-h-cromer/workflowskill) | Specification and reference runtime                                          |
| **openclaw-workflowskill** (this repo)                             | OpenClaw plugin — author, validate, run, and review workflows from the agent |

## Quick Start

Requires [OpenClaw](https://openclaw.ai).

### 1. Set your profile to Coding

In OpenClaw settings, change your profile from `messaging` (the default) to `coding`. The `coding` profile grants the agent filesystem access, which is required to read and write workflow files. For more granular access configuration, refer to the [OpenClaw documentation](https://docs.openclaw.ai/).

### 2. Install the plugin

```bash
openclaw plugins install openclaw-workflowskill
```

### 3. Restart the gateway

```bash
openclaw gateway restart
```

### 4. Verify

```bash
openclaw plugins list
# → workflowskill: 4 tools registered

openclaw skills list
# → workflowskill-author (user-invocable)
```

> **Note:** `workflowskill_llm` uses your Anthropic credentials from the main agent — no separate API key configuration needed.

### 5. Create a workflow

Just tell the agent what you want to automate:

> **You:** I want to check Hacker News for AI stories every morning and email me a summary.
>
> **Agent:** I'll author a WorkflowSkill for that. _(invokes `/workflowskill-author`, writes a SKILL.md, runs `workflowskill_validate`)_
>
> Validated — 3 steps: `fetch`, `filter`, `email`. Running a test now... _(invokes `workflowskill_run`)_
>
> Run complete: 4 AI stories found, summary drafted. Ready to schedule — want me to set up a daily cron at 8 AM?

### 6. Schedule it

Ask the agent to set up a cron job, or add one manually at `~/.openclaw/cron/jobs.json`:

```json
{
  "payload": {
    "kind": "agentTurn",
    "message": "Run the daily-triage workflow using workflowskill_run\n\nSend results to Slack in the #general channel",
    "model": "haiku"
  }
}
```

Your agent will use `"model": "haiku"` for cron jobs, ensuring execution is cheap and lightweight.

## Tools

Registers four tools with the OpenClaw agent:

| Tool                     | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `workflowskill_validate` | Parse and validate a SKILL.md or raw YAML workflow            |
| `workflowskill_run`      | Execute a workflow and return a compact run summary           |
| `workflowskill_runs`     | List and inspect past run logs                                |
| `workflowskill_llm`      | Call Anthropic directly for inline LLM reasoning in workflows |

Also ships the `/workflowskill-author` skill — just say "I want to automate X" and the agent handles the rest: researching, writing, validating, and test-running the workflow in chat.

## Workspace Layout

```
<workspace>/
  skills/              # Workflow SKILL.md files (one per subdirectory)
    daily-triage/
      SKILL.md
  workflow-runs/       # RunLog JSON files (auto-created)
    daily-triage-2024-01-15T09-00-00.000Z.json
```

Review past runs via `workflowskill_runs`.

## Architecture

### Tool delegation

Workflow `tool` steps are forwarded to the **OpenClaw gateway** via `POST /tools/invoke`. Any tool registered with the gateway is available to a workflow — the plugin sends the tool name and args as JSON and returns the result. Gateway auth (`config.gateway.auth.token`) must be configured or the plugin will refuse to start.

The `workflowskill_llm` tool is built-in: it calls Anthropic directly using the API key from OpenClaw's credential store, and is always available.

The plugin's own four tools (`workflowskill_validate`, `workflowskill_run`, `workflowskill_runs`, `workflowskill_llm`) are blocked from being forwarded to the gateway to prevent infinite recursion.

## Tool Reference

### `workflowskill_validate`

Parse and validate a SKILL.md or raw YAML workflow.

| Param     | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `content` | string | yes      | SKILL.md text or raw workflow YAML |

Returns `{ valid, errors[], name, stepCount, stepTypes[] }`.

### `workflowskill_run`

Execute a workflow and return a compact run summary. The full RunLog is persisted to `workflow-runs/` and retrievable via `workflowskill_runs` with `run_id`.

| Param           | Type   | Required | Description                                      |
| --------------- | ------ | -------- | ------------------------------------------------ |
| `workflow_name` | string | no\*     | Name of a skill resolved from skills directories |
| `content`       | string | no\*     | Inline SKILL.md content (bypasses skill files)   |
| `inputs`        | object | no       | Override workflow input defaults                 |

\*One of `workflow_name` or `content` is required.

### `workflowskill_runs`

List and inspect past run logs.

| Param           | Type   | Required | Description                         |
| --------------- | ------ | -------- | ----------------------------------- |
| `workflow_name` | string | no       | Filter by workflow name             |
| `run_id`        | string | no       | Get full RunLog detail for one run  |
| `status`        | string | no       | Filter by `"success"` or `"failed"` |

No params → 20 most recent runs (summary view).

### `workflowskill_llm`

Call Anthropic directly and return the text response. Uses the API key from OpenClaw's credential store. Useful in workflow `tool` steps when you need inline LLM reasoning.

| Param    | Type   | Required | Description                                                                        |
| -------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `prompt` | string | yes      | The prompt to send to the LLM                                                      |
| `model`  | string | no       | Model alias (`haiku`, `sonnet`, `opus`) or full model ID — omit to use the default |

Returns `{ text: string }`.

## Development

The plugin imports from `workflowskill`, installed from npm. No build step is required for type checking:

```bash
npm install
npm run typecheck
```

To test changes, link the plugin locally and restart the OpenClaw gateway:

```bash
openclaw plugins install --link "$(pwd)"
openclaw gateway restart
openclaw tools invoke workflowskill_validate '{"content": "..."}'
```

## License

MIT
