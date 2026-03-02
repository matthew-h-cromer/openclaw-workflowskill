# openclaw-workflowskill

OpenClaw plugin for [WorkflowSkill](https://github.com/matthewcromer/workflowskill). Gives the OpenClaw agent native tools to author, validate, run, and review declarative YAML workflows — without leaving the chat.

## What it does

Registers four tools with the OpenClaw agent:

| Tool | Description |
|------|-------------|
| `workflowskill_validate` | Parse and validate a SKILL.md or raw YAML workflow |
| `workflowskill_run` | Execute a workflow and return a compact run summary |
| `workflowskill_runs` | List and inspect past run logs |
| `workflowskill_llm` | Call Anthropic directly for inline LLM reasoning in workflows |

Also ships the `/workflowskill-author` skill — a conversational prompt that guides the agent through authoring, testing, and iterating on workflows.

## Architecture

### Tool delegation

Workflow `tool` steps are forwarded to the **OpenClaw gateway** via `POST /tools/invoke`. Any tool registered with the gateway is available to a workflow — the plugin sends the tool name and args as JSON and returns the result. Gateway auth (`config.gateway.auth.token`) must be configured or the plugin will refuse to start.

The `workflowskill_llm` tool is built-in: it calls Anthropic directly using the API key from OpenClaw's credential store, and is always available.

The plugin's own four tools (`workflowskill_validate`, `workflowskill_run`, `workflowskill_runs`, `workflowskill_llm`) are blocked from being forwarded to the gateway to prevent infinite recursion.

## Requirements

- [OpenClaw](https://openclaw.ai) installed and running
- [WorkflowSkill](https://github.com/matthewcromer/workflowskill) runtime built locally

## Setup

### 1. Build the WorkflowSkill runtime

```bash
cd /path/to/workflowskill/runtime
npm install
npm run build
```

### 2. Install the plugin

```bash
cd /path/to/openclaw-workflowskill
openclaw plugins install --link "$(pwd)"
```

### 3. Configure Anthropic credentials

The plugin reads your Anthropic API key from OpenClaw's credential store — no `.env` file needed. Make sure an Anthropic auth profile is configured in OpenClaw (`~/.openclaw/agents/main/agent/auth-profiles.json`).

### 4. Restart the gateway

```bash
openclaw gateway restart
```

### 5. Verify

```bash
openclaw plugins list
# → workflowskill: 4 tools registered

openclaw skills list
# → workflowskill-author (user-invocable)
```

## Workflow lifecycle

```
describe workflow in natural language
    ↓
/workflowskill-author  (agent writes YAML)
    ↓
workflowskill_validate  (catch errors early)
    ↓
workflowskill_run  (test run, review RunLog)
    ↓
workflowskill_runs  (diagnose failures, iterate)
    ↓
cron  (schedule for automated execution)
```

## Tool reference

### `workflowskill_validate`

Parse and validate a SKILL.md or raw YAML workflow.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes | SKILL.md text or raw workflow YAML |

Returns `{ valid, errors[], name, stepCount, stepTypes[] }`.

### `workflowskill_run`

Execute a workflow and return a compact run summary. The full RunLog is persisted to `workflow-runs/` and retrievable via `workflowskill_runs` with `run_id`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_name` | string | no* | Name of a skill resolved from skills directories |
| `content` | string | no* | Inline SKILL.md content (bypasses skill files) |
| `inputs` | object | no | Override workflow input defaults |

*One of `workflow_name` or `content` is required.

### `workflowskill_runs`

List and inspect past run logs.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_name` | string | no | Filter by workflow name |
| `run_id` | string | no | Get full RunLog detail for one run |
| `status` | string | no | Filter by `"success"` or `"failed"` |

No params → 20 most recent runs (summary view).

### `workflowskill_llm`

Call Anthropic directly and return the text response. Uses the API key from OpenClaw's credential store. Useful in workflow `tool` steps when you need inline LLM reasoning.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | yes | The prompt to send to the LLM |
| `model` | string | no | Model alias (`haiku`, `sonnet`, `opus`) or full model ID — omit to use the default |

Returns `{ text: string }`.

## Workspace layout

```
<workspace>/
  skills/              # Workflow SKILL.md files (one per subdirectory)
    daily-triage/
      SKILL.md
  workflow-runs/       # RunLog JSON files (auto-created)
    daily-triage-2024-01-15T09-00-00.000Z.json
```

## Cron scheduling

Run workflows on a schedule via system cron — no agent session required:

```cron
# Every weekday at 9 AM
0 9 * * 1-5 workflowskill run /path/to/skills/daily-triage/SKILL.md >> /tmp/daily-triage.log 2>&1
```

Review past runs later via `workflowskill_runs`.

## Development

The plugin imports from `workflowskill` (peer dependency). The `tsconfig.json` maps `workflowskill` to `../workflowskill/runtime/src/index.ts` for local development, so no build step is required for type checking:

```bash
npm install
npm run typecheck
```

To test changes, restart the OpenClaw gateway:

```bash
openclaw gateway restart
openclaw tools invoke workflowskill_validate '{"content": "..."}'
```

## License

MIT
