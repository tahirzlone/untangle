# Flowprint Phase 1 — Contract + Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the standalone `flowprint` repo with the `workflow.json` JSON Schema contract, a validator, and the `/graph-my-task` Claude Code skill that produces valid *vanilla* workflow graphs (no suggestions yet).

**Architecture:** The engine is a Claude Code skill (no server). It writes `*.workflow.json` files conforming to `schema/workflow.schema.json`; a Node validator (`ajv`) enforces the schema plus referential integrity. The viewer (Phase 2) will consume these files. Suggestions/KB matching arrive in Phase 3 — but the schema defines the FULL contract now so it never breaks later.

**Tech Stack:** Node 20+, npm, ajv + ajv-formats (JSON Schema 2020-12), vitest. No framework yet (viewer comes in Phase 2).

## Global Constraints

- Repo root: `C:\dev\flowprint` (standalone repo — NOT inside tahirlone.com).
- **No data-gathering/sync/backfill scripts** — Tahir explicitly rejected them. The only scripts allowed are validation.
- Every suggestion (Phase 3+) must carry `airtableRecordId` — the schema enforces this NOW via `required`.
- All JSON documents validate against `schema/workflow.schema.json` before commit.
- Commands must run on Windows (PowerShell) — use `node`/`npm`, no bash-isms.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Design spec source: `C:\Users\w002tzl\.claude\plans\i-am-planning-a-keen-wilkes.md`.

## File Structure

```
C:\dev\flowprint\
├── .claude\skills\graph-my-task\SKILL.md   # THE ENGINE (canonical location — autoloads when repo opened in Claude Code)
├── CLAUDE.md                               # repo conventions for Claude Code sessions
├── README.md                               # stub now, full fork story in Phase 5
├── LICENSE                                 # MIT
├── package.json                            # ajv, ajv-formats, vitest
├── schema\workflow.schema.json             # the contract
├── scripts\validate-core.mjs               # pure validation (schema + integrity) — exported function
├── scripts\validate.mjs                    # thin CLI over validate-core
├── tests\schema.test.mjs                   # vitest: schema + integrity cases
├── tests\cli.test.mjs                      # vitest: CLI exit codes
├── tests\fixtures\valid.workflow.json      # canonical valid document (with one suggestion)
├── gallery\add-e2e-tests.workflow.json     # first real vanilla graph (Task 6)
├── out\                                    # gitignored default output dir for skill runs
└── docs\
    ├── specs\2026-07-28-flowprint-design.md
    └── superpowers\plans\  (this file)
```

Note: the approved design sketched `skill/graph-my-task/`; the canonical location is `.claude/skills/graph-my-task/` instead so the skill works the moment anyone opens the repo in Claude Code — no copy step. (Minor deviation, functionally superior; flag to Tahir at review.)

---

### Task 1: Repo scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`, `LICENSE`

**Interfaces:**
- Produces: a git repo at `C:\dev\flowprint` with `npm test` runnable (vitest, zero tests OK).

- [ ] **Step 1: Create directory and git init**

```powershell
New-Item -ItemType Directory -Force C:\dev\flowprint; Set-Location C:\dev\flowprint; git init -b main
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "flowprint",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Blueprint your Claude workflows — graph how Claude would break down a task, then watch skills, plugins, and MCPs simplify it.",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "validate": "node scripts/validate.mjs"
  },
  "devDependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
out/
*.log
```

- [ ] **Step 4: Write `README.md` stub**

```markdown
# Flowprint

Blueprint your Claude workflows. Describe a task → see the flowchart of how Claude would break it down with zero helpers → watch skills, plugins, connectors, and MCP servers from a curated knowledge base collapse it into something radically simpler.

**Status: Phase 1 — contract + engine.** The `/graph-my-task` Claude Code skill generates validated `*.workflow.json` graphs. Viewer, suggestions, and the magic morph are coming in later phases.

## Try it (Phase 1)

1. Open this repo in Claude Code.
2. Run `/graph-my-task "your task here"`.
3. Find the generated graph in `out/`.
```

- [ ] **Step 5: Write `LICENSE`** — standard MIT text, `Copyright (c) 2026 Tahir Lone`.

- [ ] **Step 6: Install and verify**

Run: `npm install` then `npm test`
Expected: exit 0 — vitest reports "No test files found" (the `--passWithNoTests` flag makes this pass; real tests arrive in Task 3).

- [ ] **Step 7: Commit**

```powershell
git add -A; git commit -m "chore: scaffold flowprint repo (package, license, readme)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Commit the design spec

**Files:**
- Create: `docs/specs/2026-07-28-flowprint-design.md`

- [ ] **Step 1: Copy the approved design**

Copy `C:\Users\w002tzl\.claude\plans\i-am-planning-a-keen-wilkes.md` → `docs\specs\2026-07-28-flowprint-design.md` (verbatim; retitle first line to `# Flowprint — Design Specification` if desired).

- [ ] **Step 2: Commit**

```powershell
git add docs/specs; git commit -m "docs: add Flowprint design specification

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Schema + validate-core (TDD)

**Files:**
- Create: `schema/workflow.schema.json`, `scripts/validate-core.mjs`, `tests/schema.test.mjs`, `tests/fixtures/valid.workflow.json`

**Interfaces:**
- Produces: `validateWorkflow(doc) → { valid: boolean, errors: string[] }` from `scripts/validate-core.mjs`. Schema id `https://flowprint.dev/schema/workflow.schema.json`. Later tasks and the Phase-3 reducer rely on the exact field names below.

- [ ] **Step 1: Write the valid fixture** `tests/fixtures/valid.workflow.json`

```json
{
  "meta": {
    "task": "Send a weekly newsletter from my RSS reads",
    "title": "Weekly RSS Newsletter",
    "generatedAt": "2026-07-28T12:00:00Z",
    "model": "claude-fable-5",
    "kbSource": "none"
  },
  "nodes": [
    { "id": "collect-feeds", "label": "Collect feed list", "kind": "input", "description": "Gather the RSS feed URLs and the sending schedule from the user.", "painLevel": 2 },
    { "id": "fetch-articles", "label": "Fetch new articles", "kind": "process", "description": "Manually fetch each feed, parse XML, filter to the last 7 days.", "painLevel": 4 },
    { "id": "summarize", "label": "Summarize articles", "kind": "process", "description": "Read each article and write a 2-sentence summary.", "painLevel": 3 },
    { "id": "select-stories", "label": "Select top stories", "kind": "decision", "description": "Rank summaries and pick the 5 best for this issue.", "painLevel": 3 },
    { "id": "draft-email", "label": "Draft the email", "kind": "process", "description": "Compose subject line and HTML body from the selected summaries.", "painLevel": 3 },
    { "id": "human-review", "label": "Human review", "kind": "review", "description": "User proofreads the draft and requests edits.", "painLevel": 2 },
    { "id": "send-issue", "label": "Send the issue", "kind": "output", "description": "Paste the final HTML into the newsletter service and hit send.", "painLevel": 2 }
  ],
  "edges": [
    { "from": "collect-feeds", "to": "fetch-articles", "kind": "sequence" },
    { "from": "fetch-articles", "to": "summarize", "kind": "sequence" },
    { "from": "summarize", "to": "select-stories", "kind": "sequence" },
    { "from": "select-stories", "to": "draft-email", "kind": "sequence", "label": "top 5" },
    { "from": "draft-email", "to": "human-review", "kind": "sequence" },
    { "from": "human-review", "to": "draft-email", "kind": "retry", "label": "edits requested" },
    { "from": "human-review", "to": "send-issue", "kind": "sequence", "label": "approved" }
  ],
  "suggestions": [
    {
      "nodeId": "fetch-articles",
      "airtableRecordId": "recABCDEFGHIJKLMN",
      "name": "example/rss-mcp",
      "url": "https://github.com/example/rss-mcp",
      "category": "MCP Server",
      "claim": "Fetches and filters feeds in one tool call instead of manual parsing.",
      "install": "claude mcp add rss -- npx rss-mcp",
      "effect": {
        "removeNodes": ["summarize"],
        "mergeNodes": ["fetch-articles"],
        "replaceWith": { "id": "rss-digest", "label": "Fetch + digest via MCP", "kind": "process", "description": "One MCP call returns filtered, summarized articles.", "painLevel": 1 },
        "newEdges": [
          { "from": "collect-feeds", "to": "rss-digest", "kind": "sequence" },
          { "from": "rss-digest", "to": "select-stories", "kind": "sequence" }
        ],
        "metrics": { "stepsSaved": 2, "estTimeSavedMin": 35, "estTokensSaved": 12000, "manualInterventionsRemoved": 1 }
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests** `tests/schema.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateWorkflow } from '../scripts/validate-core.mjs';

const valid = () => JSON.parse(readFileSync(new URL('./fixtures/valid.workflow.json', import.meta.url), 'utf8'));

describe('workflow contract', () => {
  it('accepts the canonical valid document', () => {
    expect(validateWorkflow(valid())).toEqual({ valid: true, errors: [] });
  });

  it('rejects a node missing painLevel', () => {
    const doc = valid();
    delete doc.nodes[0].painLevel;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects an unknown node kind', () => {
    const doc = valid();
    doc.nodes[0].kind = 'magic';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects an edge pointing at a non-existent node', () => {
    const doc = valid();
    doc.edges[0].to = 'ghost-node';
    const res = validateWorkflow(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/ghost-node/);
  });

  it('rejects duplicate node ids', () => {
    const doc = valid();
    doc.nodes[1].id = doc.nodes[0].id;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a suggestion without airtableRecordId', () => {
    const doc = valid();
    delete doc.suggestions[0].airtableRecordId;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a malformed airtableRecordId', () => {
    const doc = valid();
    doc.suggestions[0].airtableRecordId = 'not-a-record-id';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a suggestion whose nodeId is unknown', () => {
    const doc = valid();
    doc.suggestions[0].nodeId = 'ghost-node';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('allows newEdges to reference the replaceWith node id', () => {
    expect(validateWorkflow(valid()).valid).toBe(true);
  });

  it('rejects newEdges referencing a truly unknown id', () => {
    const doc = valid();
    doc.suggestions[0].effect.newEdges[0].from = 'ghost-node';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects painLevel outside 1-5', () => {
    const doc = valid();
    doc.nodes[0].painLevel = 9;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects kbSource values outside the enum', () => {
    const doc = valid();
    doc.meta.kbSource = 'csv';
    expect(validateWorkflow(doc).valid).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/schema.test.mjs`
Expected: FAIL — cannot resolve `../scripts/validate-core.mjs`.

- [ ] **Step 4: Write `schema/workflow.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://flowprint.dev/schema/workflow.schema.json",
  "title": "Flowprint Workflow",
  "type": "object",
  "additionalProperties": false,
  "required": ["meta", "nodes", "edges", "suggestions"],
  "properties": {
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["task", "title", "generatedAt", "model", "kbSource"],
      "properties": {
        "task": { "type": "string", "minLength": 1 },
        "title": { "type": "string", "minLength": 1 },
        "generatedAt": { "type": "string", "format": "date-time" },
        "model": { "type": "string", "minLength": 1 },
        "kbSource": { "enum": ["airtable", "none"] }
      }
    },
    "nodes": {
      "type": "array",
      "minItems": 3,
      "items": { "$ref": "#/$defs/node" }
    },
    "edges": {
      "type": "array",
      "minItems": 2,
      "items": { "$ref": "#/$defs/edge" }
    },
    "suggestions": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["nodeId", "airtableRecordId", "name", "url", "category", "claim", "effect"],
        "properties": {
          "nodeId": { "$ref": "#/$defs/nodeId" },
          "airtableRecordId": { "type": "string", "pattern": "^rec[A-Za-z0-9]{14}$" },
          "name": { "type": "string", "minLength": 1 },
          "url": { "type": "string", "format": "uri" },
          "category": { "enum": ["Claude Skill", "Claude Plugin", "MCP Server", "Connector", "Other"] },
          "claim": { "type": "string", "minLength": 1 },
          "install": { "type": "string" },
          "effect": {
            "type": "object",
            "additionalProperties": false,
            "required": ["removeNodes", "mergeNodes", "newEdges", "metrics"],
            "properties": {
              "removeNodes": { "type": "array", "items": { "$ref": "#/$defs/nodeId" } },
              "mergeNodes": { "type": "array", "items": { "$ref": "#/$defs/nodeId" } },
              "replaceWith": { "$ref": "#/$defs/node" },
              "newEdges": { "type": "array", "items": { "$ref": "#/$defs/edge" } },
              "metrics": {
                "type": "object",
                "additionalProperties": false,
                "required": ["stepsSaved", "estTimeSavedMin", "estTokensSaved", "manualInterventionsRemoved"],
                "properties": {
                  "stepsSaved": { "type": "integer", "minimum": 0 },
                  "estTimeSavedMin": { "type": "integer", "minimum": 0 },
                  "estTokensSaved": { "type": "integer", "minimum": 0 },
                  "manualInterventionsRemoved": { "type": "integer", "minimum": 0 }
                }
              }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "nodeId": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" },
    "node": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "label", "kind", "description", "painLevel"],
      "properties": {
        "id": { "$ref": "#/$defs/nodeId" },
        "label": { "type": "string", "minLength": 1, "maxLength": 60 },
        "kind": { "enum": ["input", "process", "decision", "loop", "review", "output"] },
        "description": { "type": "string", "minLength": 1 },
        "painLevel": { "type": "integer", "minimum": 1, "maximum": 5 },
        "lane": { "type": "string" }
      }
    },
    "edge": {
      "type": "object",
      "additionalProperties": false,
      "required": ["from", "to", "kind"],
      "properties": {
        "from": { "$ref": "#/$defs/nodeId" },
        "to": { "$ref": "#/$defs/nodeId" },
        "label": { "type": "string", "maxLength": 60 },
        "kind": { "enum": ["sequence", "branch", "retry"] }
      }
    }
  }
}
```

- [ ] **Step 5: Write `scripts/validate-core.mjs`**

```js
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(
  readFileSync(new URL('../schema/workflow.schema.json', import.meta.url), 'utf8')
);

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

export function validateWorkflow(doc) {
  const errors = [];
  if (!validateSchema(doc)) {
    for (const e of validateSchema.errors ?? []) {
      errors.push(`schema: ${e.instancePath || '/'} ${e.message}`);
    }
    return { valid: false, errors };
  }

  const nodeIds = new Set(doc.nodes.map((n) => n.id));
  if (nodeIds.size !== doc.nodes.length) {
    errors.push('integrity: duplicate node ids');
  }
  doc.edges.forEach((e, i) => {
    if (!nodeIds.has(e.from)) errors.push(`integrity: edges[${i}].from "${e.from}" is not a node id`);
    if (!nodeIds.has(e.to)) errors.push(`integrity: edges[${i}].to "${e.to}" is not a node id`);
  });
  doc.suggestions.forEach((s, i) => {
    if (!nodeIds.has(s.nodeId)) {
      errors.push(`integrity: suggestions[${i}].nodeId "${s.nodeId}" is not a node id`);
    }
    const allowed = new Set(nodeIds);
    if (s.effect.replaceWith) allowed.add(s.effect.replaceWith.id);
    for (const id of s.effect.removeNodes) {
      if (!nodeIds.has(id)) errors.push(`integrity: suggestions[${i}].effect.removeNodes "${id}" is not a node id`);
    }
    for (const id of s.effect.mergeNodes) {
      if (!nodeIds.has(id)) errors.push(`integrity: suggestions[${i}].effect.mergeNodes "${id}" is not a node id`);
    }
    s.effect.newEdges.forEach((e, j) => {
      if (!allowed.has(e.from)) errors.push(`integrity: suggestions[${i}].effect.newEdges[${j}].from "${e.from}" is unknown`);
      if (!allowed.has(e.to)) errors.push(`integrity: suggestions[${i}].effect.newEdges[${j}].to "${e.to}" is unknown`);
    });
  });

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/schema.test.mjs`
Expected: PASS (12 tests).

- [ ] **Step 7: Commit**

```powershell
git add schema scripts/validate-core.mjs tests; git commit -m "feat: workflow.json contract — JSON Schema + integrity validator (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Validator CLI

**Files:**
- Create: `scripts/validate.mjs`, `tests/cli.test.mjs`

**Interfaces:**
- Consumes: `validateWorkflow` from `scripts/validate-core.mjs` (Task 3).
- Produces: `node scripts/validate.mjs <file>` → exit 0 + `OK: <file>` on success; exit 1 + `REJECTED: <file>` + bullet list of errors on failure; exit 2 on usage error. The SKILL (Task 5) invokes exactly this command.

- [ ] **Step 1: Write the failing test** `tests/cli.test.mjs`

```js
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/valid.workflow.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe('validate CLI', () => {
  it('exits 0 and prints OK for a valid file', () => {
    const res = run(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK:');
  });

  it('exits 1 and prints REJECTED for an invalid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowprint-'));
    const bad = join(dir, 'bad.workflow.json');
    writeFileSync(bad, JSON.stringify({ meta: {} }));
    const res = run(bad);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('REJECTED');
  });

  it('exits 1 for a file that is not JSON at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowprint-'));
    const bad = join(dir, 'not-json.txt');
    writeFileSync(bad, 'hello');
    const res = run(bad);
    expect(res.status).toBe(1);
  });

  it('exits 2 with usage when no file is given', () => {
    const res = run();
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('usage');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/cli.test.mjs` → FAIL (`scripts/validate.mjs` missing).

- [ ] **Step 3: Write `scripts/validate.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateWorkflow } from './validate-core.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/validate.mjs <workflow.json>');
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`REJECTED: ${file} — not valid JSON (${err.message})`);
  process.exit(1);
}

const { valid, errors } = validateWorkflow(doc);
if (!valid) {
  console.error(`REJECTED: ${file}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK: ${file}`);
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run` → ALL tests PASS (schema + cli).

- [ ] **Step 5: Commit**

```powershell
git add scripts/validate.mjs tests/cli.test.mjs; git commit -m "feat: validate CLI with OK/REJECTED contract for the skill loop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: The `/graph-my-task` skill + repo CLAUDE.md

**Files:**
- Create: `.claude/skills/graph-my-task/SKILL.md`, `CLAUDE.md`, `out/.gitkeep` (commit `out/.gitkeep` but keep `out/*` ignored — adjust `.gitignore` to `out/*` + `!out/.gitkeep`)

**Interfaces:**
- Consumes: `node scripts/validate.mjs <file>` (Task 4).
- Produces: the engine. Running `/graph-my-task "<task>"` in Claude Code yields a schema-valid `out/<slug>.workflow.json` vanilla graph.

- [ ] **Step 1: Write `.claude/skills/graph-my-task/SKILL.md`**

```markdown
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

## Validation loop (mandatory)

1. Run: `node scripts/validate.mjs out/<slug>.workflow.json`
2. If `REJECTED`, fix the listed errors and re-run. If it still fails after one fix attempt, STOP and show the user the errors instead of looping.
3. Only report success after seeing `OK:`.

## Report

After `OK:`, tell the user: the file path, node count, and the top 2–3 pain hotspots (highest painLevel nodes) — one sentence each. These hotspots are where Phase 3 suggestions will land.
```

- [ ] **Step 2: Write repo `CLAUDE.md`**

```markdown
# Flowprint

The contract is `schema/workflow.schema.json` — every `*.workflow.json` in `out/`, `gallery/`, or `tests/fixtures/` must pass `node scripts/validate.mjs <file>`.

- The engine is the `/graph-my-task` skill in `.claude/skills/graph-my-task/`.
- No data-gathering, sync, or backfill scripts belong in this repo — the knowledge base is read live from Airtable at generation time (Phase 3+).
- Run tests with `npm test` (vitest).
```

- [ ] **Step 3: Update `.gitignore`** — replace `out/` line with:

```
out/*
!out/.gitkeep
```

Create empty `out/.gitkeep`.

- [ ] **Step 4: Verify** — `npm test` still fully green.

- [ ] **Step 5: Commit**

```powershell
git add .claude CLAUDE.md .gitignore out/.gitkeep; git commit -m "feat: /graph-my-task skill — vanilla graph engine with mandatory validation loop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: First real gallery graph (skill dry run)

**Files:**
- Create: `gallery/add-e2e-tests.workflow.json`

**Interfaces:**
- Consumes: the SKILL.md rules (Task 5) and the validate CLI (Task 4).
- Produces: the first exhibit for the Phase-2 viewer.

- [ ] **Step 1: Execute the skill's instructions manually** for the task *"Add end-to-end tests to an existing web app"* — follow `.claude/skills/graph-my-task/SKILL.md` exactly as written (honest vanilla decomposition, 6–16 nodes, one input, output node, retry loops around flaky test debugging, review gate before CI merge), writing to `gallery/add-e2e-tests.workflow.json` with `suggestions: []`, `kbSource: "none"`.

- [ ] **Step 2: Validate**

Run: `node scripts/validate.mjs gallery/add-e2e-tests.workflow.json`
Expected: `OK: gallery/add-e2e-tests.workflow.json`

- [ ] **Step 3: Sanity-check the story** — read the graph as prose: does the sequence make sense to a developer? Are painLevels honest (debugging flaky selectors should be 4–5)? Fix and re-validate if not.

- [ ] **Step 4: Commit**

```powershell
git add gallery; git commit -m "feat: first gallery workflow — vanilla 'add e2e tests' decomposition

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 1 exit criteria

- `npm test` green (schema + CLI suites).
- `/graph-my-task` on a fresh prompt produces a file that passes the validator on first or second attempt.
- Gallery contains one honest, readable vanilla graph.
- Tahir reviews locally (his gate per one-feature-at-a-time) before Phase 2 begins.
