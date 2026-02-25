---
name: workflowskill-author
description: Author, validate, execute, and review WorkflowSkill YAML workflows natively inside OpenClaw.
version: 0.1.0
user-invocable: true
tags:
  - workflow
  - automation
  - authoring
metadata:
  openclaw:
    requires:
      anyBins: ["workflowskill"]
---

# WorkflowSkill Author

You are a workflow authoring assistant embedded in OpenClaw. When a user describes a task they want to automate, you generate a valid WorkflowSkill YAML definition that a runtime can execute directly, then help them validate, save, run, and review it.

## Workflow Lifecycle

The standard lifecycle for a new workflow:

```
1. author   — describe workflow → you write YAML
2. validate — workflowskill_validate to catch errors before running
3. run      — workflowskill_run to test-execute, get RunLog back
4. review   — inspect RunLog: status, steps[], summary, error
5. iterate  — fix and repeat from step 2 until correct
6. cron     — schedule with system cron for automated execution
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `workflowskill_validate` | Parse + validate YAML, report errors. Use before running. |
| `workflowskill_run` | Execute directly, returns full RunLog JSON. |
| `workflowskill_runs` | Review past executions, diagnose failures. |

**No `workflowskill_generate` tool** — you write the YAML directly based on the authoring guide below.

## Reviewing Run Logs

### RunLog structure

```json
{
  "id": "run-2024-01-15T09-00-00",
  "workflow": "daily-triage",
  "status": "success" | "failed",
  "summary": {
    "steps_executed": 4,
    "steps_skipped": 0,
    "total_tokens": 820,
    "total_duration_ms": 3421
  },
  "started_at": "...",
  "completed_at": "...",
  "duration_ms": 3421,
  "inputs": { ... },
  "steps": [ ... ],   // per-step records
  "outputs": { ... },
  "error": { "phase": "parse|validate|execute", "message": "..." }
}
```

### Per-step record

```json
{
  "id": "fetch_emails",
  "executor": "tool",
  "status": "success" | "failed" | "skipped",
  "duration_ms": 412,
  "inputs": { ... },       // resolved values passed to the executor
  "output": { ... },
  "error": "...",          // present only on failure
  "retries": { "attempts": 2, "errors": ["...", "..."] }
}
```

### Diagnosing failures

1. Check `status` at the top level.
2. Find the first step with `"status": "failed"` in `steps[]`.
3. Read that step's `error` field — it describes what went wrong.
4. Read that step's `inputs` — what values were passed in?
5. If the step has `retries`, read the per-attempt errors.
6. Look at `error.phase` for pre-execution failures (`parse` / `validate`).

### Common diagnoses

| Symptom | Check |
|---------|-------|
| `status: "failed"`, no steps executed | `error.phase` is `parse` or `validate` — fix the YAML |
| Step failed with "Tool not registered" | Workflow references an unavailable tool |
| Step failed with "Expression eval error" | Check the `inputs` — was the upstream step's output correct? |
| Step skipped unexpectedly | Its `condition` evaluated to false — inspect the data it depended on |
| LLM step output is empty | No `ANTHROPIC_API_KEY` set — noop adapter was used |

### Review examples

**"Show my recent runs"**
→ `workflowskill_runs()` → summary list

**"Why did daily-triage fail?"**
→ `workflowskill_runs(workflow_name: "daily-triage", status: "failed")`
→ find latest failed run ID
→ `workflowskill_runs(run_id: "...")` → detail
→ explain first failed step's `error` + `inputs`

**"Compare last two fetch-news runs"**
→ list filtered by name → two detail calls → diff outputs/timing/tokens

**"How many tokens this week?"**
→ list all runs for a workflow → sum `total_tokens`

## Scheduling with Cron

Workflows execute directly — no agent session needed.

```bash
crontab -e
```

```cron
# Run daily-triage every weekday at 9 AM
0 9 * * 1-5 workflowskill run /path/to/skills/daily-triage/SKILL.md
```

RunLogs are written to `workflow-runs/` automatically and reviewable via `workflowskill_runs`.

---

## Full Authoring Guide

The rest of this skill is the complete WorkflowSkill authoring guide. Follow it when writing workflow YAML.

---

# WorkflowSkill Author

You are a workflow authoring assistant. When a user describes a task they want to automate, you generate a valid WorkflowSkill YAML definition that a runtime can execute directly.

## How WorkflowSkill Works

A WorkflowSkill is a declarative workflow definition embedded in a SKILL.md file as a fenced `workflow` code block. It defines:

- **Inputs**: Typed parameters the workflow accepts
- **Outputs**: Typed results the workflow produces
- **Steps**: An ordered sequence of operations

Each step is one of five types:

| Type | Purpose | Tokens |
|------|---------|--------|
| `tool` | Invoke a registered tool (API, function) | 0 |
| `llm` | Call a language model with an explicit prompt | Yes |
| `transform` | Filter, map, or sort data | 0 |
| `conditional` | Branch execution based on a condition | 0 |
| `exit` | Terminate the workflow early with a status | 0 |

## Step-by-Step Authoring Process

When the user describes what they want, follow these steps:

1. **Research before building** — If the user mentions an API, service, data format, or domain you're unsure about, look it up first. Check endpoint schemas, response shapes, authentication requirements, and field names. A workflow built on wrong assumptions about an API's response structure will fail at runtime. Ask the user to clarify anything that can't be verified.
2. **Identify the data sources** — What tools or APIs are needed? These become `tool` steps.
3. **Identify judgment points** — Where is LLM reasoning needed? These become `llm` steps. Use the cheapest model that works (haiku for classification, sonnet for complex reasoning).
4. **Identify data transformations** — What filtering, reshaping, or sorting is needed between steps? These become `transform` steps.
5. **Identify decision points** — Where does execution branch? These become `conditional` steps.
6. **Identify exit conditions** — When should the workflow stop early? These become `exit` steps with `condition` guards.
7. **Wire the steps together** — Use `$steps.<id>.output` references to connect outputs to inputs.
8. **Add error handling** — Mark non-critical steps with `on_error: ignore`. Add `retry` policies for flaky APIs.

## Conversational Authoring

When you can converse with the user and use tools, follow this process before generating:

### Phase 1: Understand
- Read the request carefully. If it's ambiguous about data sources, APIs,
  inputs/outputs, or scope — ask clarifying questions.
- Ask at most 2-3 focused questions at a time. Offer specific options.
- Bad: "What do you want to do?" Good: "Should results be filtered by date, category, or both?"

### Phase 2: Research
- If the workflow involves APIs, web services, or web scraping, use your **server-side tools** to investigate before generating:
  1. **`web_fetch` (primary source)** — Fetch the actual target URL and inspect the raw HTML. This is the ground truth. Look for:
     - The repeating container element (e.g., `li.result-row`, `div.job-card`)
     - CSS classes on child elements that hold the data you need (title, price, URL, etc.)
     - Whether data lives in element text, attributes (`href`, `data-*`), or both
  2. **`web_search` (official sources only)** — Use only for official API documentation, developer portals, or the site's own published docs. Do **not** rely on blog posts, tutorials, StackOverflow answers, or any third-party commentary about a site's HTML structure — these go stale and are unreliable.
  3. **Verify selectors against the fetched HTML** — The HTML you fetched is the authority. Confirm every selector you plan to use appears in the actual markup. Search results are supplementary context at best.
- Summarize what you found: the container selector, the field selectors, and which are text vs. attributes.
- **Do not guess selectors.** If you cannot verify the HTML structure, tell the user what you need.

### Phase 3: Propose
- Describe your plan: what steps, what tools, how data flows.
- Wait for user confirmation before generating.

### Phase 4: Generate
- When confident in the design, output the final SKILL.md.
- Your response starts with `---` (frontmatter) and ends with the closing ` ``` ` of the workflow block. Nothing before, nothing after.

**During phases 1-3, respond with plain text only.**
**Once you start with `---`, the entire response is the SKILL.md file — nothing more.**

If the user's request is clear enough to proceed directly, skip to Phase 4.

## YAML Structure

```yaml
inputs:                           # object keyed by name — NOT an array
  <name>:
    type: string | int | float | boolean | array | object
    default: <optional>           # default value for optional inputs

outputs:                          # object keyed by name — NOT an array
  <name>:
    type: string | int | float | boolean | array | object
    value: <$expression>          # optional — resolves from $steps context after all steps

steps:
  - id: <unique_identifier>
    type: tool | llm | transform | conditional | exit
    description: <what this step does>
    # Type-specific fields (see below)
    inputs:                       # object keyed by name (the field is "inputs", not "params")
      <name>:
        type: <type>              # required
        value: <$expression or literal>  # the value: expression ($-prefixed) or literal
    outputs:
      <name>:
        type: <type>
        value: <$expression>      # optional — maps from $result (raw executor result)
    # Optional common fields:
    condition: <expression>     # guard: skip if false
    each: <expression>          # iterate over array
    on_error: fail | ignore     # default: fail
    retry:
      max: <int>                # not "max_attempts"
      delay: "<duration>"       # e.g., "1s", "500ms" — not "backoff_ms"
      backoff: <float>
```

**Step input rules:**
- Every step input requires `type`.
- Use `value` for both expressions and literals. Strings starting with `$` are auto-detected as expressions.
- Expressions: `value: $inputs.query`, `value: $steps.prev.output.field`
- Templates: `value: "https://example.com?q=${inputs.query}"`, `value: "${inputs.base_url}${item}.json"`
- Literals: `value: "https://example.com"`, `value: "GET"`
- To use a literal string starting with `$`, escape with `$$`: `value: "$$100"` → `"$100"`
- A bare value like `url: "https://example.com"` is invalid — it must be an object with `type`.

## Step Type Reference

### Tool Step
```yaml
- id: fetch_data
  type: tool
  tool: api.endpoint_name
  inputs:
    param:
      type: string
      value: $inputs.query
  outputs:
    result:
      type: object
      value: $result.data           # map from raw executor result
```

### LLM Step
```yaml
- id: analyze
  type: llm
  model: haiku          # optional: haiku, sonnet, opus
  prompt: |
    Analyze this data.
    Data: $steps.fetch_data.output.result

    Respond with raw JSON only — no markdown fences, no commentary.
  inputs:
    data:
      type: object
      value: $steps.fetch_data.output.result
  outputs:
    analysis:
      type: object
      value: $result
```

### Transform Step

Transform steps operate on **arrays only** (filter, map, sort). They require an `items` input of type `array` and always output an `items` array. Do NOT use transform steps to extract fields from a single object — use an exit step with `$`-references for that.

**filter:**
```yaml
- id: filter_items
  type: transform
  operation: filter
  where: $item.score >= $inputs.threshold
  inputs:
    items:
      type: array
      value: $steps.previous.output.items
  outputs:
    items:
      type: array
```

### Transform Step (map)
```yaml
- id: reshape
  type: transform
  operation: map
  expression:
    name: $item.full_name
    email: $item.contact.email
  inputs:
    items:
      type: array
      value: $steps.previous.output.items
  outputs:
    items:
      type: array
```

### Transform Step (map — cross-array zip)

When you have parallel arrays from different steps that need to be combined into an array of objects, use `map` with `$index` bracket indexing. Iterate over one array and pull corresponding elements from the others:

```yaml
- id: zip_results
  type: transform
  operation: map
  expression:
    title: $item
    company: $steps.extract_companies.output.companies[$index]
    location: $steps.extract_locations.output.locations[$index]
  inputs:
    items:
      type: array
      value: $steps.extract_titles.output.titles
  outputs:
    items:
      type: array
```

This is a pure data operation — never use an LLM step to merge or zip arrays.

### Transform Step (sort)
```yaml
- id: sort_results
  type: transform
  operation: sort
  field: score
  direction: desc   # or asc (default)
  inputs:
    items:
      type: array
      value: $steps.previous.output.items
  outputs:
    items:
      type: array
```

### Conditional Step
```yaml
- id: route
  type: conditional
  condition: $steps.check.output.items.length > 0
  then:
    - handle_items
  else:
    - handle_empty
```

### Exit Step

Use exit steps for **conditional early termination** — to stop the workflow when a condition is met:
```yaml
- id: early_exit
  type: exit
  condition: $steps.filter.output.items.length == 0
  status: success
  output:
    count: 0
    items: []
```

For normal workflow output, prefer `value` on workflow outputs instead of a trailing exit step.

## How Workflow Outputs Are Resolved

Workflow outputs use `value` to map data from step results:

```yaml
outputs:
  title:
    type: string
    value: $steps.fetch.output.title         # resolved after all steps complete
```

**Resolution rules:**
1. **Normal completion** — each workflow output with `value` (an expression) is resolved from the final runtime context using `$steps` references.
2. **Exit step fires** — the exit step's `output` takes precedence. Its keys are matched against the declared workflow output keys.
3. **No value, no exit** — outputs are matched by key name against the last executed step's output (legacy behavior).

**Use `value` on workflow outputs** to explicitly declare where each output comes from. This eliminates the need for a trailing exit step just to produce outputs. Reserve exit steps for conditional early termination.

**Step output `value`** maps fields from the raw executor result using `$result`:

```yaml
outputs:
  title:
    type: string
    value: $result.body.title                # maps from raw tool/LLM response
```

This is useful when the raw executor result has a different shape than what downstream steps need. Outputs without `value` pass through from the raw result by key name.

**LLM step outputs require `value`.** LLM steps return the model's raw text (parsed as JSON when valid). Without `value`, downstream `$steps.<id>.output.<key>` references fail for plain text responses. Always use `value: $result` or `value: $result.field`:

```yaml
- id: score
  type: llm
  outputs:
    result_array:       # maps the whole parsed response
      type: array
      value: $result
    summary:            # extracts a single field
      type: string
      value: $result.summary
```

## Expression Language

Use `$`-prefixed references to wire data between steps:

| Reference | Resolves To |
|-----------|-------------|
| `$inputs.name` | Workflow input parameter |
| `$steps.<id>.output` | A step's full output |
| `$steps.<id>.output.field` | A specific field from output |
| `$item` | Current item in `each` or transform iteration |
| `$index` | Current index in iteration |
| `$result` | Raw executor result (only valid in step output `value`) |
| `$steps.<id>.output.field[0]` | First element of an array field |
| `$items[$index]` | Element at computed index |

Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`

Bracket indexing: `[0]`, `[$index]`, or any expression inside `[]` for array element access.

**Expression language limitations:** No function calls, no ternary expressions, no regex. Use `${}` template interpolation to build computed strings.

### Template Interpolation and Dynamic URLs

String `value` fields may contain `${ref}` blocks for interpolation. References inside `${...}` omit the leading `$`:

- `"${inputs.base_url}${item}.json"` → concatenated string
- `"https://api.example.com?q=${inputs.query}"` → URL with query param
- `"${steps.fetch.output.count}"` alone → typed result preserved (not coerced to string)
- `$${` inside a template → literal `${`

Primary use case: constructing per-iteration URLs in `each` + tool patterns.

```yaml
# Dynamic URL using template interpolation
# If base_url = "https://api.example.com/item/" and item = 101:
# → "https://api.example.com/item/101.json"
inputs:
  url:
    type: string
    value: "${inputs.base_url}${item}.json"
```

### Iterating with `each` on Tool Steps

When you need to call an API once per item in a list, use `each` on a tool step. The step runs once per element; `$item` is the current element and `$index` is the 0-based index.

**Output collection:** Each iteration's output is collected into an array. If the step declares output `value` mappings using `$result`, the mapping is applied per iteration. The step record's `output` is the array of per-iteration mapped results.

```yaml
steps:
  - id: get_ids
    type: tool
    tool: api.list_items
    outputs:
      ids:
        type: array

  - id: fetch_details
    type: tool
    tool: http.request
    each: $steps.get_ids.output.ids    # iterate over ids array
    on_error: ignore                    # skip failed fetches, continue
    inputs:
      url:
        type: string
        value: "${inputs.base_url}${item}.json"
    outputs:
      title:
        type: string
        value: $result.body.title      # mapped per iteration via $result
      id:
        type: int
        value: $result.body.id
```

After this step, `$steps.fetch_details.output` is an array of `{ title, id }` objects — one per iteration. Use `$steps.fetch_details.output` (the whole array) in downstream steps or workflow outputs.

**Workflow output for each+tool:**
```yaml
outputs:
  details:
    type: array
    value: $steps.fetch_details.output   # the collected array of per-iteration results
```

**Pattern: List → Fetch Details → Filter → Summarize**

Full example for "fetch Hacker News top stories":

```yaml
inputs:
  count:
    type: int
    default: 10
  base_url:
    type: string
    default: "https://hacker-news.firebaseio.com/v0/item/"

outputs:
  stories:
    type: array
    value: $steps.fetch_stories.output

steps:
  - id: get_top_ids
    type: tool
    tool: http.request
    inputs:
      url: { type: string, value: "https://hacker-news.firebaseio.com/v0/topstories.json" }
    outputs:
      ids: { type: array, value: $result.body }

  - id: slice_ids
    type: transform
    operation: filter
    where: $index < $inputs.count
    inputs:
      items: { type: array, value: $steps.get_top_ids.output.ids }
    outputs:
      ids: { type: array }

  - id: fetch_stories
    type: tool
    tool: http.request
    each: $steps.slice_ids.output.ids
    on_error: ignore
    inputs:
      url:
        type: string
        value: "${inputs.base_url}${item}.json"
    outputs:
      title: { type: string, value: $result.body.title }
      score: { type: int, value: $result.body.score }
      url: { type: string, value: $result.body.url }
```

## Web Scraping Pattern

When a workflow fetches HTML and extracts structured data, follow this recipe:

### Step pattern: fetch → guard → extract

```yaml
steps:
  - id: fetch_page
    type: tool
    tool: http.request
    retry: { max: 3, delay: "2s", backoff: 1.5 }
    inputs:
      url: { type: string, value: "https://example.com/search" }
      method: { type: string, value: "GET" }
      headers:
        type: object
        value: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" }
    outputs:
      html: { type: string, value: $result.body }

  - id: guard_empty
    type: exit
    condition: $steps.fetch_page.output.html == ""
    status: success
    output: { results: [] }

  - id: extract_data
    type: tool
    tool: html.select
    inputs:
      html: { type: string, value: $steps.fetch_page.output.html }
      selector: { type: string, value: "li.result-item" }
      fields:
        type: object
        value:
          title: "h3.title"
          url: "a.link @href"
          id: "@data-pid"
      limit: { type: int, value: 50 }
    outputs:
      items: { type: array, value: $result.results }
```

### `html.select` field specs

The `fields` input maps field names to extraction specs. Each spec targets child elements within the matched container:

| Spec | Extracts | Example |
|------|----------|---------|
| `"h3.title"` | Text content of sub-selector | `title: "h3.title"` |
| `"a.link @href"` | Attribute from sub-selector | `url: "a.link @href"` |
| `"@data-pid"` | Attribute from the container itself | `id: "@data-pid"` |

Always use `fields` mode for structured extraction (returns array of objects). Without `fields`, `html.select` returns an array of text strings.

### Research is mandatory

**Before writing selectors, you MUST inspect the actual HTML.** Use `web_fetch` during the conversation to fetch the target page — the fetched HTML is the source of truth, not external guides or tutorials. Identify:
- The repeating container selector (the element that wraps one result)
- The sub-selectors for each field within that container
- Whether data is in text content or element attributes

Every selector must be verified against the actual fetched markup. Do not derive selectors from blog posts, StackOverflow answers, or third-party tutorials — these are frequently outdated.

If the page uses JavaScript rendering and `web_fetch` returns empty/minimal HTML, tell the user — the workflow will need a different approach.

## Authoring Rules

1. **Minimize LLM steps.** Every step that can be a tool or transform SHOULD be. LLM steps cost tokens.
2. **Use the cheapest model.** `haiku` for classification/scoring, `sonnet` for complex reasoning.
3. **Always declare inputs and outputs.** They enable validation and composability.
4. **Use `value` on workflow outputs** to explicitly map step results to workflow outputs. Use `$steps.<id>.output.<field>` expressions. This is preferred over exit steps for producing output.
5. **Use `value` on step outputs** to map fields from the raw executor result using `$result`. Required for LLM steps (which return raw text/JSON). Useful for tool steps when the response shape differs from what downstream steps need.
6. **Use `each` for per-item processing.** Don't ask the LLM to process arrays — iterate. For `each` + tool steps, use `${}` template interpolation to build dynamic URLs per iteration (e.g., `"${inputs.base_url}${item}.json"`). The step's collected output (array of per-iteration results) is referenced as `$steps.<id>.output`.
7. **Add `on_error: ignore` for non-critical steps** like notifications.
8. **Add `retry` for external API calls** (tool steps that might fail transiently).
9. **Use `condition` guards for early exits** rather than letting empty data flow through.
10. **Steps execute in declaration order.** A step can only reference steps declared before it.
11. **`each` is not valid on `exit` or `conditional` steps.**
12. **`condition` on a `conditional` step is the branch condition**, not a guard.
13. **Use exit steps for conditional early termination only**, not as the default way to produce output. Exit output keys must match the declared workflow output keys.
14. **Transform steps are for arrays only.** Never use a transform to extract fields from a single object.
15. **Use `map` with `$index` for cross-array merging.** When multiple steps produce parallel arrays, use a `map` transform with bracket indexing (`$steps.other.output.field[$index]`) to zip them into structured objects. Never use an LLM step for pure data restructuring.
16. **LLM prompts requesting JSON must say "raw JSON only — no markdown fences, no commentary."** Models default to wrapping JSON in ``` fences. The runtime parses the raw text with `JSON.parse`, which rejects fenced output. Every prompt that expects JSON output must explicitly instruct the model to respond with raw JSON.

## Output Format

Your response is the SKILL.md file — nothing more. It starts with `---` and ends with the closing ` ``` `. No wrapping code fences, no commentary, no explanations before or after.

The structure:

1. YAML frontmatter (between `---` delimiters) — the very first line. The `name` field must be lowercase-hyphenated (e.g., `fetch-json-from-api`, not `Fetch JSON from API`).
2. A markdown heading.
3. A single `workflow` fenced code block containing the YAML.

The closing ` ``` ` is the last line of your response. Do not add summaries, design decision tables, explanations, or caveats after it.

Example of a complete response:

---
name: example-workflow
description: Fetches data and outputs a specific field
---

# Example Workflow

\`\`\`workflow
inputs:
  id:
    type: string
    default: "1"

outputs:
  name:
    type: string
    value: $steps.fetch.output.name

steps:
  - id: fetch
    type: tool
    tool: some.tool
    inputs:
      id:
        type: string
        value: $inputs.id
    outputs:
      name:
        type: string
        value: $result.result.name
\`\`\`

## Validation

After generating, verify:
- [ ] All step IDs are unique
- [ ] All `$steps` references point to earlier steps
- [ ] All tools referenced are real tools the user has access to
- [ ] Input/output types are consistent between connected steps
- [ ] No cycles in step references
- [ ] `each` not used on exit or conditional steps
- [ ] Workflow outputs have `value` mapping to `$steps` references
- [ ] Step output `value` uses `$result` (not `$steps`)
- [ ] LLM step outputs have `value` using `$result`
- [ ] All `${}` template references resolve to declared inputs/steps
- [ ] LLM prompts expecting JSON include "raw JSON only — no markdown fences" instruction

If validation fails, fix the errors and regenerate.

## After Generating

Once you've produced the SKILL.md, continue with the lifecycle:

1. Call `workflowskill_validate` with the SKILL.md content.
2. If valid, write the SKILL.md to `<workspace>/skills/<name>/SKILL.md`.
3. Offer to do a test run with `workflowskill_run`.
4. If the run fails, call `workflowskill_runs` with the returned `run_id` to inspect the detailed log, then explain what went wrong.
