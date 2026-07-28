---
name: graph-my-task
description: Generate a Flowprint workflow graph — decompose a task into the flowchart of how Claude would execute it with ZERO helpers (no skills, plugins, connectors, or MCP servers), written as a validated .workflow.json. Use when the user runs /graph-my-task, or asks to graph, blueprint, flowchart, or map a task.
---

# Graph My Task

Turn the user's task description into a **vanilla workflow graph**: an honest flowchart of how Claude would accomplish the task using ONLY built-in abilities (reasoning, reading/writing files, running commands, browsing if available). Pretend no skills, plugins, connectors, or MCP servers exist.

## Rules of decomposition

1. **Be honest, not flattering.** Include the tedious parts: manual data gathering, format wrangling, retry loops after failures, human review gates, copy-paste steps. The pain is the point — later phases show how helpers erase it.
2. **6–16 nodes.** Fewer means you're summarizing; more means you're micro-stepping.
3. **Exactly one `input` node** (gathering requirements/materials from the user) and **at least one `output` node** (the delivered result).
4. **Node kinds:** `input`, `process`, `decision` (branching judgment), `loop` (bounded iteration over items), `review` (human-in-the-loop gate), `output`.
5. **painLevel rubric (1–5):** 1 = trivial/instant · 2 = easy but attention-consuming · 3 = moderate effort or fiddly formatting · 4 = slow, error-prone, or many manual sub-steps · 5 = heavy manual work across multiple tools/sessions.
6. **Edges:** `sequence` for normal flow, `branch` out of decisions (label each branch), `retry` for backward loops (label the failure reason). The graph must be connected; every non-input node is reachable from the input node.
7. **ids** are kebab-case (`^[a-z0-9][a-z0-9-]*$`), short and descriptive.

## Output

Write to `out/<slug>.workflow.json` where `<slug>` is a kebab-case slug of the title (or `gallery/<slug>.workflow.json` when the user says it's a gallery/showcase piece).

Document shape (Phase 1 — no knowledge base yet):

- `meta`: `task` (the user's words), `title` (your concise name), `generatedAt` (ISO 8601 UTC), `model` (your model id), `kbSource`: `"none"`
- `nodes`, `edges` per the rules above
- `suggestions`: `[]` (always empty until the Airtable knowledge base is linked in Phase 3)

Node and edge field names and constraints (required properties, label length caps): see `schema/workflow.schema.json` — read it before authoring.

## Validation loop (mandatory)

1. Run: `node scripts/validate.mjs out/<slug>.workflow.json`
2. If `REJECTED`, fix the listed errors and re-run. If it still fails after one fix attempt, STOP and show the user the errors instead of looping.
3. Only report success after seeing `OK:`.

## Report

After `OK:`, tell the user: the file path, node count, and the top 2–3 pain hotspots (highest painLevel nodes) — one sentence each. These hotspots are where Phase 3 suggestions will land.
