# openclaw-workflowskill

OpenClaw plugin that provides WorkflowSkill tools: author, validate, run, and inspect YAML workflows via the `workflowskill` runtime.

## Key Commands

```bash
npm run typecheck   # Type-check all TypeScript (no build step)
npm run reset       # Clear OpenClaw state and restart gateway for dev
```

There are no tests and no build/bundle step.

## Architecture

- **`index.ts`** — Plugin entry point; registers `workflowskill_validate`, `workflowskill_run`, `workflowskill_runs`
- **`tools/`** — One file per tool: `validate.ts`, `run.ts`, `runs.ts`
- **`lib/`** — Shared infrastructure: `adapters.ts` (HTTP gateway adapter), `storage.ts` (run history), `openclaw-context.md`
- **`openclaw.plugin.json`** — Plugin manifest (id: `openclaw-workflowskill`)
- **`scripts/reset.sh`** — Dev reset script

## Code Conventions

- **ESM** (`"type": "module"`), raw TypeScript — no compile/bundle step; files ship as `.ts`
- **Imports**: use `.js` extensions on relative imports (e.g., `./lib/storage.js`); use `node:` prefix on Node built-ins
- **Strict TypeScript**: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters` — avoid suppression
- **Naming**: PascalCase for interfaces/types, camelCase for functions, UPPER_SNAKE_CASE for constants, `workflowskill_` prefix on all tool names
- No linter or formatter — follow existing style

## Key Dependency

`workflowskill` (`^0.3.2`) provides:
- `runWorkflowSkill` — execute a workflow
- `validateWorkflowSkill` — validate YAML
- `AUTHORING_SKILL` — skill content for the author tool
- All relevant types

## Publishing

Ships raw `.ts` files. `"files"` in `package.json` controls what's included. `prepublishOnly` runs `tsc --noEmit` to typecheck before publish.
