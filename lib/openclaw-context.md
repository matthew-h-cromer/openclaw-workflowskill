## OpenClaw Integration

### Where to Save Skills

Save authored workflows to:

```
{{workspace}}/skills/<name>/SKILL.md
```

### Scheduling Workflows via Cron

OpenClaw schedules cron jobs at `~/.openclaw/cron/jobs.json`.

When a cron triggers, it invokes an agent session. The message should be a short trigger — put delivery instructions (e.g. Slack channel) in the cron, not the workflow, so workflows stay reusable. Do not put business logic in the cron prompt; use `workflowskill_run` to invoke the workflow instead.

Always set `"model": "haiku"` on cron payloads — cron runs are lightweight orchestration and don't need a powerful model.

```json
{
  "payload": {
    "kind": "agentTurn",
    "message": "Run the <name> workflow using workflowskill_run\n\nSend results to Slack in the #general channel",
    "model": "haiku"
  }
}
```

> **Important:** Plugin tools are not available in sessions by default.
> Before scheduling, ensure `tools.alsoAllow` includes `openclaw-workflowskill`:
>
> ```bash
> openclaw config set tools.alsoAllow '["openclaw-workflowskill"]'
> ```
>
> Without this, cron sessions cannot invoke `workflowskill_run` and will fail silently.

### Fetching Raw API Data

Use `workflowskill_fetch_raw` when a workflow step needs structured data from an HTTP API. Unlike `web_fetch`, which converts responses to markdown (destroying JSON structure), `workflowskill_fetch_raw` returns a parsed object for `application/json` responses.

**Return shape:**
```json
{ "status": 200, "headers": { "content-type": "application/json" }, "body": { ... } }
```

Access response data via `$result.body.<field>`. Network errors return `status: 0` and a string `body` describing the error, so workflows can branch on failure.

**GET request (JSON API):**
```yaml
steps:
  - id: fetch_jobs
    type: tool
    tool: workflowskill_fetch_raw
    params:
      url: "https://boards-api.greenhouse.io/v1/boards/intrinsic/jobs"
  - id: count_jobs
    type: tool
    tool: workflowskill_llm
    params:
      prompt: "There are {{ steps.fetch_jobs.result.body.jobs.length }} jobs."
```

**POST request with JSON body:**
```yaml
steps:
  - id: create_item
    type: tool
    tool: workflowskill_fetch_raw
    params:
      url: "https://api.example.com/items"
      method: POST
      headers:
        Content-Type: application/json
        Authorization: "Bearer {{ inputs.token }}"
      body: '{"name": "{{ inputs.name }}"}'
```
