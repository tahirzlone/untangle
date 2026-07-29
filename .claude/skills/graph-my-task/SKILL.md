---
name: graph-my-task
description: Generate a Flowprint workflow graph — decompose a task into the flowchart of how Claude would execute it with ZERO helpers (no skills, plugins, connectors, or MCP servers), written as a validated .workflow.json. Use when the user runs /graph-my-task, or asks to graph, flowchart, or map a task, workflow, or pipeline.
---

# Graph My Task

Turn the user's task description into a **vanilla workflow graph**: an honest flowchart of how Claude would accomplish the task using ONLY built-in abilities (reasoning, reading/writing files, running commands, browsing if available). Pretend no skills, plugins, connectors, or MCP servers exist.

## Rules of decomposition

1. **Be honest, not flattering.** Include the tedious parts: manual data gathering, format wrangling, retry loops after failures, human review gates, copy-paste steps. The pain is the point — the knowledge-base stage below shows how helpers erase it.
2. **6–16 nodes.** Fewer means you're summarizing; more means you're micro-stepping.
3. **Exactly one `input` node** (gathering requirements/materials from the user) and **at least one `output` node** (the delivered result).
4. **Node kinds:** `input`, `process`, `decision` (branching judgment), `loop` (bounded iteration over items), `review` (human-in-the-loop gate), `output`.
5. **painLevel rubric (1–5):** 1 = trivial/instant · 2 = easy but attention-consuming · 3 = moderate effort or fiddly formatting · 4 = slow, error-prone, or many manual sub-steps · 5 = heavy manual work across multiple tools/sessions.
6. **Edges:** `sequence` for normal flow, `branch` out of decisions (label each branch), `retry` for backward loops (label the failure reason). The graph must be connected; every non-input node is reachable from the input node.
7. **ids** are kebab-case (`^[a-z0-9][a-z0-9-]*$`), short and descriptive.

## Output

Write to `out/<slug>.workflow.json` where `<slug>` is a kebab-case slug of the title (or `gallery/<slug>.workflow.json` when the user says it's a gallery/showcase piece).

Document shape:

- `meta`: `task` (the user's words), `title` (your concise name), `generatedAt` (ISO 8601 UTC), `model` (your model id), `kbSource` (`"airtable"` or `"none"` — the knowledge-base stage below decides which)
- `nodes`, `edges` per the rules above
- `suggestions`: filled by the knowledge-base stage below; `[]` when no knowledge base is linked or nothing matched

Field names and constraints for nodes, edges, and suggestions (required properties, label length caps, enums, the `airtableRecordId` pattern): see `schema/workflow.schema.json` — read it before authoring.

## Knowledge base (suggestions)

This stage attaches real, existing helpers — Claude skills, plugins, and MCP servers from a curated Airtable knowledge base — to the nodes they would collapse. Run it once the nodes and edges are settled and **before** the validation loop; the suggestions belong in the same file (if you already wrote the file, update it in place).

**HARD RULES — no exceptions, no judgment calls:**

> Suggestions may ONLY reference rows that exist in the Airtable response. Never invent, remember, or import resources from anywhere else.

> At most ONE suggestion per Airtable row per graph — the same row must never be attached to two nodes (the viewer refuses duplicate ids).

A resource you know about from training, from another repo, from your own memory of this session, or from a web search is **not** eligible. If it is not in the response you fetched, it does not exist for this graph. (The reverse is fine: one node may carry several suggestions, as long as each comes from a different row.)

### 1. Is a knowledge base linked?

Check the `AIRTABLE_API_KEY` environment variable.

- **Unset or empty → skip this whole stage.** Set `meta.kbSource: "none"`, leave `suggestions: []`, and tell the user "KB not linked" in the report. This is normal, not a failure: the vanilla graph is the deliverable.
- **Set → fetch (step 2).** If the fetch fails (401, 404, network error) or returns zero rows, do not retry more than once and do not fabricate anything: report the failure in one line and fall back to exactly the keyless behavior above (`kbSource: "none"`, `suggestions: []`).

### 2. Fetch every row

Resolve the base and table from the environment, with Tahir's base as the default so a fork can point elsewhere:

| Variable | Default |
| --- | --- |
| `FLOWPRINT_AIRTABLE_BASE` | `appRSePRgk4jlaRUc` |
| `FLOWPRINT_AIRTABLE_TABLE` | `tblOJzSLHAW7lbBWv` |

Endpoint: `https://api.airtable.com/v0/<base>/<table>` · Header: `Authorization: Bearer $AIRTABLE_API_KEY`

**Pagination is mandatory.** Airtable returns at most 100 records per request as `{ "records": [...], "offset": "..." }`. An `offset` in the response means more rows exist; request again with that exact `offset` value. Repeat until a response comes back with **no** `offset` key. Never stop after the first page.

Use whichever of these fits the session. All three do the same thing.

**Node (any platform, walks all pages by itself, prints `id` + fields per row):**

```bash
node -e "(async()=>{const B=process.env.FLOWPRINT_AIRTABLE_BASE||'appRSePRgk4jlaRUc',T=process.env.FLOWPRINT_AIRTABLE_TABLE||'tblOJzSLHAW7lbBWv';let out=[],offset;do{const u=new URL('https://api.airtable.com/v0/'+B+'/'+T);u.searchParams.set('pageSize','100');if(offset)u.searchParams.set('offset',offset);const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.AIRTABLE_API_KEY}});if(!r.ok){console.error('airtable',r.status,await r.text());process.exitCode=1;return}const j=await r.json();out=out.concat(j.records);offset=j.offset}while(offset);console.log(JSON.stringify(out.map(r=>Object.assign({id:r.id},r.fields)),null,1))})()"
```

**curl (bash / Git Bash) — page 1:**

```bash
curl -sS -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  "https://api.airtable.com/v0/${FLOWPRINT_AIRTABLE_BASE:-appRSePRgk4jlaRUc}/${FLOWPRINT_AIRTABLE_TABLE:-tblOJzSLHAW7lbBWv}?pageSize=100"
```

**curl — every page after the first** (paste the previous response's `offset` value verbatim; `-G` + `--data-urlencode` escapes it safely):

```bash
curl -sS -G -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  --data-urlencode "pageSize=100" \
  --data-urlencode "offset=PASTE_OFFSET_FROM_PREVIOUS_RESPONSE" \
  "https://api.airtable.com/v0/${FLOWPRINT_AIRTABLE_BASE:-appRSePRgk4jlaRUc}/${FLOWPRINT_AIRTABLE_TABLE:-tblOJzSLHAW7lbBWv}"
```

**PowerShell** (in PowerShell 5.1 `curl` is an alias for `Invoke-WebRequest`, so the bash flags above fail — use this instead; it walks all pages):

```powershell
$base = if ($env:FLOWPRINT_AIRTABLE_BASE) { $env:FLOWPRINT_AIRTABLE_BASE } else { 'appRSePRgk4jlaRUc' }
$table = if ($env:FLOWPRINT_AIRTABLE_TABLE) { $env:FLOWPRINT_AIRTABLE_TABLE } else { 'tblOJzSLHAW7lbBWv' }
$headers = @{ Authorization = "Bearer $env:AIRTABLE_API_KEY" }
$rows = @(); $offset = $null
do {
  $uri = "https://api.airtable.com/v0/$base/$table" + '?pageSize=100'
  if ($offset) { $uri += '&offset=' + [uri]::EscapeDataString($offset) }
  $page = Invoke-RestMethod -Uri $uri -Headers $headers
  $rows += $page.records
  $offset = $page.offset
} while ($offset)
$rows | ConvertTo-Json -Depth 6
```

A bad or missing key surfaces as an `AUTHENTICATION_REQUIRED` JSON body (curl, node) or a thrown `(401) Unauthorized` (PowerShell). Either way, step 1's fallback applies — do not paper over it.

Two things about the response shape, both of which matter later:

- Each record is `{ "id": "recXXXXXXXXXXXXXX", "createdTime": "...", "fields": { ... } }`. The `id` is the only legal source of `airtableRecordId`.
- **Airtable omits empty fields entirely.** An absent key in `fields` means blank — not an error, and not something to guess at.

The knowledge-base table's fields and select choices are documented in `kb/airtable-template.md`. Read it if a row's shape surprises you, or if the user is setting up their own base.

### 3. Candidate filter

A row is a candidate if **either** condition holds:

- its `Category` is `Claude Skill`, `Claude Plugin`, or `MCP Server`; **or**
- its `Capability Tags` is non-empty (present with at least one value) — whatever the `Category`, including `GitHub Trending` and `Other`.

Every other row (typically a `GitHub Trending` row nobody has enriched yet) is not a candidate. Ignore it silently; unenriched rows are not defects.

### 4. Match candidates to nodes

For each node, compare the node's `kind` + `label` + `description` against each candidate's `Step Archetypes` + `Capability Tags` + `Description`.

`Step Archetypes` is the strongest signal — it names the kind of step the resource upgrades (`research`, `scaffold`, `code`, `test`, `browser-verify`, `deploy`, `document`, `data-etl`, `review`, `orchestrate`). Node `kind` alone never decides a match: a `process` node might be research, ETL, or deployment work. The label and description say which.

A match is worth keeping only when the resource would **actually erase or collapse the work that node describes** — not merely sit in the same topic area. Prefer the highest-`painLevel` nodes; that is where a helper is visibly worth installing.

- **0–3 suggestions per graph is NORMAL.** A forced match is worse than none.
- Fetched the knowledge base and nothing matched? That is a legitimate result: `meta.kbSource: "airtable"`, `suggestions: []`, and say so plainly in the report.

### 5. Author each suggestion

One object per match, in `suggestions`:

| Field | Value |
| --- | --- |
| `nodeId` | the id of the node this upgrades — must be an id that exists in `nodes`. This is where the suggestion badge appears, so it is normally the painful node the resource takes over (usually one of the nodes the effect removes or merges) |
| `airtableRecordId` | the row's real `id` from the response, copied exactly (`^rec[A-Za-z0-9]{14}$`). Never type one from memory, never edit one, never make one up — this field is what proves the resource is real |
| `name` | the row's `Name`, verbatim |
| `url` | the row's `URL`, verbatim (must start with `http://` or `https://`) |
| `category` | the row's `Category`, verbatim — **except** that the schema's enum is `Claude Skill`, `Claude Plugin`, `MCP Server`, `Connector`, `Other`. Airtable's `GitHub Trending` choice is not in that enum: write `Other` for those rows. Any other value outside the enum also becomes `Other` |
| `claim` | the row's `Improvement Claim`, verbatim. Blank or absent → write one line yourself in the same plain style, grounded ONLY in that row's own `Description` / `Why Noteworthy`. Never invent a repo, a feature, or a capability the row does not support |
| `install` | the row's `Install`, verbatim. Blank or absent → **omit the key entirely** rather than writing an empty string |
| `effect` | the patch — see step 6 |

### 6. The `effect` patch

`effect` is not decoration; the viewer executes it. Applying suggestion S to workflow W does exactly this, in order:

1. Delete every node in `S.effect.removeNodes` and `S.effect.mergeNodes`.
2. If `S.effect.replaceWith` exists, add it as a new node.
3. Drop every edge touching a deleted node; add `S.effect.newEdges` verbatim.
4. Remove S from `suggestions`, along with any OTHER suggestion whose `nodeId` or effect references a deleted node (its target is gone).
5. Add `S.effect.metrics` to the session totals.

The result is re-validated. A patch that breaks the graph is refused and the card renders as un-appliable — a wasted suggestion.

Fields:

- **`removeNodes`** (required array, may be empty) — nodes the resource makes unnecessary outright.
- **`mergeNodes`** (required array, may be empty) — nodes that collapse into `replaceWith`. Deleted exactly like `removeNodes`; the distinction is only how the UI narrates it. **A node id must never appear in both arrays.**
- **`replaceWith`** (optional, a single full node: `id`, `label`, `kind`, `description`, `painLevel`) — the one step that stands in for what was removed. Its `id` must be new kebab-case, must not collide with any surviving node id, **and must not equal any OTHER suggestion's `replaceWith.id` — each replacement node id must be unique across the whole `suggestions` array.** (Two suggestions introducing the same id both validate, but once one is applied the other collides with the node it just created and is permanently un-appliable.) Its `painLevel` is the eased work, so it belongs at the bottom of the rubric (1–2) — a replacement as painful as what it replaced is not an improvement.
- **`newEdges`** (required array, may be empty) — edges to add after the deletions. Every endpoint must be a surviving node id or `replaceWith.id`. **An endpoint this same effect deletes is a hard error.**
- **`metrics`** (required) — `stepsSaved`, `estTimeSavedMin`, `estTokensSaved`, `manualInterventionsRemoved`, all integers ≥ 0.

Every effect must change the graph. An effect with empty `removeNodes`, empty `mergeNodes`, and no `replaceWith` passes the schema but does nothing on screen — the user clicks APPLY and watches an identical graph. If a resource eliminates nothing, it is not load-bearing; drop the suggestion instead. A real effect takes one of two shapes:

- **Collapse:** `removeNodes` (and/or `mergeNodes`) with `newEdges` closing the gap — steps disappear entirely.
- **Substitute:** `mergeNodes` listing the painful steps plus a low-pain `replaceWith` and `newEdges` wiring it in — several manual steps become one helper-driven step.

Two traps to author around:

- **Rewire what you cut.** Because step 3 drops every edge touching a deleted node, removing a node from the middle of the flow leaves its upstream and downstream disconnected. Supply `newEdges` reconnecting them (upstream → `replaceWith` → downstream, or upstream → downstream directly). **Nothing downstream checks connectivity** — no validator and no reducer will catch a missed rewire; the patch applies happily and strands an orphaned node on screen. YOU are the only gate: after authoring the effect, re-trace every surviving node and confirm it still has a path from the input node.
- **Respect the size floor.** The schema requires **at least 3 nodes and at least 2 edges**, and the graph is re-validated AFTER the patch applies. Count it before you write it: `nodes − (removeNodes + mergeNodes) + (replaceWith ? 1 : 0) ≥ 3`, and surviving edges + `newEdges` ≥ 2. On a small graph, keep effects modest — one or two nodes. Never author an effect that would shrink the graph below the floor.

Metrics, estimated **conservatively** — this number is on screen next to a real resource, so it has to survive scrutiny:

- `stepsSaved` — the count of nodes this effect actually eliminates: `removeNodes + mergeNodes − (replaceWith ? 1 : 0)`. Never more than that.
- `estTimeSavedMin` — minutes the eliminated steps genuinely cost, read off their `painLevel` (a pain-2 node is a few minutes, not an hour).
- `estTokensSaved` — `0` unless you have a real basis for a number. `0` is honest; a rounded guess is not.
- `manualInterventionsRemoved` — count only eliminated `review` nodes and explicit human hand-offs. Usually `0` or `1`.

If two suggestions target overlapping nodes, that is allowed but understand the consequence: applying the first deletes the second's target, so the second disappears (step 4). Prefer suggestions with disjoint targets so the user can apply them all.

### 7. Set `meta.kbSource`

- `"airtable"` — you fetched the knowledge base, whatever the match count (including zero).
- `"none"` — no key, or the fetch failed. Then `suggestions` must be `[]`.

### 8. Self-check before validating

Walk the list; the validator catches most of it, but a caught error costs a round trip:

- [ ] every `nodeId` exists in `nodes`
- [ ] every `airtableRecordId` matches `^rec[A-Za-z0-9]{14}$` **and** appears in a response you actually fetched
- [ ] no `airtableRecordId` appears twice in `suggestions`
- [ ] every `category` is one of the schema's five values
- [ ] `install` present only when it has real content
- [ ] all `removeNodes` / `mergeNodes` ids exist; no id in both
- [ ] no effect is a no-op — each one removes, merges, or substitutes at least one node
- [ ] every `newEdges` endpoint is a surviving node id or `replaceWith.id`
- [ ] every `replaceWith.id` is unique across the whole `suggestions` array (no two suggestions introduce the same replacement id)
- [ ] every surviving node still has a path from the input node after each patch — you are the only connectivity check
- [ ] post-patch counts still ≥ 3 nodes and ≥ 2 edges
- [ ] `metrics` are four non-negative integers
- [ ] `meta.kbSource` matches what you actually did

## Validation loop (mandatory)

1. From the repo root, run: `node scripts/validate.mjs <path-you-wrote>` (e.g. `out/<slug>.workflow.json` or `gallery/<slug>.workflow.json`).
2. If `REJECTED`, fix the listed errors and re-run. If it still fails after one fix attempt, STOP and show the user the errors instead of looping.
3. Only report success after seeing `OK:`.

## Report

After `OK:`, tell the user:

1. the file path and node count;
2. the top 2–3 pain hotspots (highest `painLevel` nodes) — one sentence each;
3. one line per suggestion, in this shape: `<node label> → <resource name> (<category>) — <claim>`;
4. the knowledge-base state in one line: `KB not linked` when there was no `AIRTABLE_API_KEY`, the failure in one line if the fetch broke, or `KB read, no load-bearing matches` when it was fetched and nothing matched.
