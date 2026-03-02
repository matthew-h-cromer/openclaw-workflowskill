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
