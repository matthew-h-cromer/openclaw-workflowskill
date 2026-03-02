## OpenClaw Integration

### Where to Save Skills

Save authored workflows to:

```
{{workspace}}/skills/<name>/SKILL.md
```

### Scheduling Workflows via Cron

OpenClaw schedules cron jobs at `~/.openclaw/cron/jobs.json`)

When a cron triggers, it invokes an agent session. The cron message should be a short trigger. Instructions to message the user should be encapsulated in the cron rather than the workflow. This ensures workflows are maximally reusable and composable.

```
Run the <name> workflow using workflowskill_run

Send results to Slack in the #general channel
```

Do not put business logic in the cron prompt. This duplicates the workflow, is fragile, and bypasses validation and run logging.
