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

```bash
openclaw config set tools.profile coding
```

The `coding` profile grants the agent filesystem access, which is required to read and write workflow files. For more granular access configuration, refer to the [OpenClaw documentation](https://docs.openclaw.ai/).

### 2. Install the plugin

```bash
openclaw plugins install openclaw-workflowskill
```

### 3. Configure

```bash
openclaw config set plugins.allow '["openclaw-workflowskill"]'
openclaw config set tools.alsoAllow '["openclaw-workflowskill", "web_fetch"]'
```

The first command allowlists the plugin so the gateway loads it. The second makes its tools available in every session — including cron jobs — so agents can invoke `workflowskill_run` to execute workflows autonomously.

### 4. Restart the gateway

```bash
openclaw gateway restart
```

The gateway loads plugins and config at startup. A restart is required to pick up the plugin installation and config changes from the previous steps.

### 5. Verify

```bash
openclaw plugins list
# → workflowskill: 6 tools registered

openclaw skills list
# → workflowskill-author (user-invocable)
```

> **Note:** `workflowskill_llm` uses your Anthropic credentials from the main agent — no separate API key configuration needed.

### 6. Create a workflow

Just tell the agent what you want to automate:

> **You:** I want to check Hacker News for AI stories every morning and email me a summary.
>
> **Agent:** I'll author a WorkflowSkill for that. _(invokes `/workflowskill-author`, writes a SKILL.md, runs `workflowskill_validate`)_
>
> Validated — 3 steps: `fetch`, `filter`, `email`. Running a test now... _(invokes `workflowskill_run`)_
>
> Run complete: 4 AI stories found, summary drafted. Ready to schedule — want me to set up a daily cron at 8 AM?

### 7. Schedule it

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

> **Important:** Plugin tools are not available in sessions by default. Before scheduling, ensure `tools.alsoAllow` includes `openclaw-workflowskill`:
>
> ```bash
> openclaw config set tools.alsoAllow '["openclaw-workflowskill"]'
> ```
>
> Without this, cron sessions cannot invoke `workflowskill_run` and will fail silently.

## Tools

Registers six tools with the OpenClaw agent:

| Tool                       | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `workflowskill_validate`   | Parse and validate a SKILL.md or raw YAML workflow                 |
| `workflowskill_run`        | Execute a workflow and return a compact run summary                |
| `workflowskill_runs`       | List and inspect past run logs                                     |
| `workflowskill_llm`        | Call Anthropic directly for inline LLM reasoning in workflows      |
| `workflowskill_fetch_raw`  | HTTP fetch returning `{ status, headers, body }` with JSON parsed  |
| `workflowskill_scrape`     | Fetch a web page and extract text via CSS selectors                |

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

The `workflowskill_llm`, `workflowskill_fetch_raw`, and `workflowskill_scrape` tools are built-in: they call external services directly without going through the gateway adapter.

Only `workflowskill_run` is blocked from gateway forwarding — it is self-referencing and would create infinite recursion. The other plugin tools (`workflowskill_validate`, `workflowskill_runs`, `workflowskill_llm`, `workflowskill_fetch_raw`, `workflowskill_scrape`) are leaf operations and are forwarded normally.

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

Returns the LLM response as a plain text string.

### `workflowskill_fetch_raw`

Make an HTTP request and return the raw response with JSON auto-parsed. Use this instead of `web_fetch` when you need structured data from a JSON API — `web_fetch` converts responses to markdown, destroying JSON structure.

| Param     | Type   | Required | Description                                                    |
| --------- | ------ | -------- | -------------------------------------------------------------- |
| `url`     | string | yes      | The URL to fetch (http or https)                               |
| `method`  | string | no       | HTTP method — GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS     |
| `headers` | object | no       | Request headers as key-value pairs                             |
| `body`    | string | no       | Request body string (e.g. `JSON.stringify(...)` for POST/PUT)  |

Returns `{ status, headers, body }`. `body` is a parsed object for `application/json` responses, or a raw string otherwise. Network errors return `{ status: 0, headers: {}, body: "<error message>" }` so workflows can branch on failure.

### `workflowskill_scrape`

Fetch a web page and extract structured data using CSS selectors.

| Param       | Type   | Required | Description                                                          |
| ----------- | ------ | -------- | -------------------------------------------------------------------- |
| `url`       | string | yes      | The page URL to fetch (http or https)                                |
| `selectors` | object | yes      | Named CSS selectors, e.g. `{ "title": "h1", "prices": "span.price" }` |
| `headers`   | object | no       | Custom request headers as key-value pairs                            |

Returns `{ status, results }` where `results` maps each selector name to an array of matching text values. Errors return `{ status: 0, error: "<message>" }`.

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
```

Then verify tools work by asking the agent:

> Validate this workflow: `inputs: { url: { type: string } }`

## License

MIT
