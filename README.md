# openclaw-workflowskill

OpenClaw plugin for [WorkflowSkill](https://github.com/matthewcromer/workflowskill). Gives the OpenClaw agent native tools to author, validate, run, and review declarative YAML workflows — without leaving the chat.

## What it does

Registers three tools with the OpenClaw agent:

| Tool | Description |
|------|-------------|
| `workflowskill_validate` | Parse and validate a SKILL.md or raw YAML workflow |
| `workflowskill_run` | Execute a workflow and return the full RunLog |
| `workflowskill_runs` | List and inspect past run logs |

Also ships the `/workflowskill-author` skill — a conversational prompt that guides the agent through authoring, testing, and iterating on workflows.

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

### 3. Set environment variables

Create or update `~/.openclaw/.env`:

```bash
# Required for LLM steps in workflows and for conversational authoring
ANTHROPIC_API_KEY=sk-ant-...

# Optional: enables Gmail and Sheets built-in tools
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

### 4. Restart the gateway

```bash
openclaw gateway restart
```

### 5. Verify

```bash
openclaw plugins list
# → workflowskill: 3 tools registered

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

Execute a workflow and return the full RunLog. Persists to `workflow-runs/`.

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
