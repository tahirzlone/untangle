---
name: graph-my-task
description: Generate an Untangle workflow graph — decompose a task into the flowchart of how Claude would execute it with ZERO helpers (no skills, plugins, connectors, or MCP servers), written as a validated .workflow.json. Use when the user runs /graph-my-task, or asks to graph, flowchart, or map a task, workflow, or pipeline, or asks to install a workflow's suggested resources.
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

- `meta`: `task` (the user's words), `title` (your concise name), `generatedAt` (ISO 8601 UTC), `model` (your model id), `kbSource` (`"airtable"` or `"none"` — the knowledge-base stage below decides which), `promptIntro` (optional — see "The optimized prompt" below)
- `nodes`, `edges` per the rules above
- `suggestions`: filled by the knowledge-base stage below; `[]` when no knowledge base is linked or nothing matched

Field names and constraints for nodes, edges, and suggestions (required properties, label length caps, enums, the `airtableRecordId` pattern): see `schema/workflow.schema.json` — read it before authoring.

## Knowledge base (suggestions)

This stage attaches real, existing helpers — Claude skills, plugins, and MCP servers from a curated Airtable knowledge base — to the nodes they would collapse. Run it once the nodes and edges are settled and **before** the validation loop; the suggestions belong in the same file (if you already wrote the file, update it in place).

**HARD RULES — no exceptions, no judgment calls:**

> Suggestions may ONLY reference rows that exist in the Airtable response. Never invent, remember, or import resources from anywhere else.

> At most ONE suggestion per Airtable row per graph — the same row must never be attached to two nodes. `airtableRecordId` is the viewer's identity key, so a repeat is not a cosmetic slip: the viewer disables the ENTIRE suggestion layer for the file (a SUGGESTIONS DISABLED notice), not just the duplicate cards.

A resource you know about from training, from another repo, from your own memory of this session, or from a web search is **not** eligible. If it is not in the response you fetched, it does not exist for this graph. (The reverse is fine: one node may carry several suggestions, as long as each comes from a different row.)

### 1. Which knowledge base? Four tiers, in order

There are four ways this stage can end up with rows. Try them strictly in order and stop at the first one that hands you rows — you never climb back up a tier.

| Tier | Condition | Source | `meta.kbSource` |
| --- | --- | --- | --- |
| 1 | `AIRTABLE_API_KEY` is set | Airtable REST, straight from the base (step 2 · tier 1) | `"airtable"` |
| 2 | tier 1 handed you no rows (no key set, **or** the key path failed) | the public feed — no token, no setup (step 2 · tier 2) | `"airtable"` |
| 2.5 | tier 2 handed you no rows (feed unreachable, non-200, or empty) | the bundled snapshot — this repo's `kb/kb.json` (step 2 · tier 2.5) | `"airtable"` |
| 3 | no source returned rows | nothing — the vanilla graph | `"none"` |

Tiers 1, 2, and 2.5 are the same table read three ways — live, mirrored, and mirrored to disk — so all three are `"airtable"`.

Start by checking the `AIRTABLE_API_KEY` environment variable. Probe it, don't assume — and print only whether it is there, never the key itself:

```powershell
if ($env:AIRTABLE_API_KEY) { 'set' } else { 'missing' }
```

```bash
echo ${AIRTABLE_API_KEY:+set}
```

(the bash form prints an empty line when the variable is unset or empty)

- **Set → tier 1**, fetch from Airtable (step 2 · tier 1). If that fetch fails (401, 404, network error) or returns zero rows, do not retry more than once and do not fabricate anything: drop to tier 2 and **say so in the report**. Tier 2 serves the *public* feed, not the base the key pointed at, so the mandated one-line failure report must name the substitution — `Airtable fetch failed (401); used the public feed instead`. Someone running their own base has to know the suggestions came from the default knowledge base rather than from their rows.
- **Unset or empty → tier 2**, fetch the public feed (step 2 · tier 2). A missing key does **not** end this stage and does **not** mean a vanilla graph — the feed needs no key at all.
- **Tier 2 unusable too → tier 2.5**, read the bundled snapshot (step 2 · tier 2.5) — a daily CI mirror of that same feed, committed to this repo, so it is on disk even when the network is not. Rows from it carry one extra duty: the report must state the snapshot's age (step 2 · tier 2.5 says how).
- **No snapshot either — missing, unparseable, or empty → tier 3.** Skip the rest of this stage: set `meta.kbSource: "none"`, leave `suggestions: []`, and tell the user "KB not linked" in the report. This is normal, not a failure: the vanilla graph is the deliverable.

### 2. Fetch every row

Three sources, one job: end up holding every row of the knowledge-base table. Read only the tier step 1 sent you to.

#### Tier 1 — straight from Airtable (`AIRTABLE_API_KEY` is set)

Resolve the base and table from the environment, with Tahir's base as the default so a fork can point elsewhere:

| Variable | Default |
| --- | --- |
| `UNTANGLE_AIRTABLE_BASE` | `appRSePRgk4jlaRUc` |
| `UNTANGLE_AIRTABLE_TABLE` | `tblOJzSLHAW7lbBWv` |

Endpoint: `https://api.airtable.com/v0/<base>/<table>` · Header: `Authorization: Bearer $AIRTABLE_API_KEY`

**Pagination is mandatory.** Airtable returns at most 100 records per request as `{ "records": [...], "offset": "..." }`. An `offset` in the response means more rows exist; request again with that exact `offset` value. Repeat until a response comes back with **no** `offset` key. Never stop after the first page.

Use whichever of these fits the session. All three do the same thing.

**Node (any platform, walks all pages by itself, prints `id` + fields per row):**

```bash
node -e "(async()=>{const B=process.env.UNTANGLE_AIRTABLE_BASE||'appRSePRgk4jlaRUc',T=process.env.UNTANGLE_AIRTABLE_TABLE||'tblOJzSLHAW7lbBWv';let out=[],offset;do{const u=new URL('https://api.airtable.com/v0/'+B+'/'+T);u.searchParams.set('pageSize','100');if(offset)u.searchParams.set('offset',offset);const r=await fetch(u,{headers:{Authorization:'Bearer '+process.env.AIRTABLE_API_KEY}});if(!r.ok){console.error('airtable',r.status,await r.text());process.exitCode=1;return}const j=await r.json();out=out.concat(j.records);offset=j.offset}while(offset);console.log(JSON.stringify(out.map(r=>Object.assign({id:r.id},r.fields)),null,1))})()"
```

**curl (bash / Git Bash) — page 1:**

```bash
curl -sS -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  "https://api.airtable.com/v0/${UNTANGLE_AIRTABLE_BASE:-appRSePRgk4jlaRUc}/${UNTANGLE_AIRTABLE_TABLE:-tblOJzSLHAW7lbBWv}?pageSize=100"
```

**curl — every page after the first** (paste the previous response's `offset` value verbatim; `-G` + `--data-urlencode` escapes it safely):

```bash
curl -sS -G -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  --data-urlencode "pageSize=100" \
  --data-urlencode "offset=PASTE_OFFSET_FROM_PREVIOUS_RESPONSE" \
  "https://api.airtable.com/v0/${UNTANGLE_AIRTABLE_BASE:-appRSePRgk4jlaRUc}/${UNTANGLE_AIRTABLE_TABLE:-tblOJzSLHAW7lbBWv}"
```

**PowerShell** (in PowerShell 5.1 `curl` is an alias for `Invoke-WebRequest`, so the bash flags above fail — use this instead; it walks all pages):

```powershell
$base = if ($env:UNTANGLE_AIRTABLE_BASE) { $env:UNTANGLE_AIRTABLE_BASE } else { 'appRSePRgk4jlaRUc' }
$table = if ($env:UNTANGLE_AIRTABLE_TABLE) { $env:UNTANGLE_AIRTABLE_TABLE } else { 'tblOJzSLHAW7lbBWv' }
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

#### Tier 2 — the public feed (tier 1 handed you no rows: no key set, **or** the key path failed)

A cached public mirror of that same Airtable table, served by tahirlone.com. Plain `GET`, **no authentication header of any kind**, and **no pagination** — one request returns the entire knowledge base.

This is the tier for both keyless runs and runs whose Airtable fetch broke. If you arrived here from a failed tier 1, the rows below come from the public base, not the one the key pointed at — the report must say so (step 1).

| Variable | Default |
| --- | --- |
| `UNTANGLE_KB_URL` | `https://tahirlone.com/api/untangle/kb` |

**curl (bash / Git Bash)** — body to a file, status to the terminal. Keep it that way: a failing feed answers with a full HTML error page, and dumping that into the session costs thousands of tokens for nothing.

```bash
curl -sS -o kb.json -w 'HTTP %{http_code}\n' "${UNTANGLE_KB_URL:-https://tahirlone.com/api/untangle/kb}"
```

Read `kb.json` **only** when that line printed `HTTP 200`; on any other status leave the file unopened (it holds an error body or a site error page) and go to tier 2.5. Delete `kb.json` once the suggestions are authored — it is scratch, not a repo artifact.

**PowerShell** (`Invoke-RestMethod` parses the JSON for you and *throws* on any non-200 — that throw is your signal to go to tier 2.5):

```powershell
$kbUrl = if ($env:UNTANGLE_KB_URL) { $env:UNTANGLE_KB_URL } else { 'https://tahirlone.com/api/untangle/kb' }
$feed = Invoke-RestMethod -Uri $kbUrl
$feed.records | ConvertTo-Json -Depth 6
```

A **200** response is this envelope and nothing else (the `recXXXX…` ids below are placeholders for shape only — never copy one into a graph):

```json
{
  "updatedAt": "2026-07-30T14:05:00.000Z",
  "recordCount": 2,
  "records": [
    {
      "id": "recXXXXXXXXXXXXXX",
      "name": "owner/example-mcp",
      "url": "https://github.com/owner/example-mcp",
      "category": "MCP Server",
      "description": "Runs SQL against a warehouse and returns typed results.",
      "language": "TypeScript",
      "stars": 1840,
      "dateFirstSeen": "2026-06-02",
      "capabilityTags": ["data-etl", "api-integration"],
      "stepArchetypes": ["data-etl", "research"],
      "improvementClaim": "Replaces hand-written export scripts with one query call.",
      "install": "claude mcp add example-mcp"
    },
    {
      "id": "recYYYYYYYYYYYYYY",
      "name": "owner/plain-repo",
      "url": "https://github.com/owner/plain-repo",
      "category": "GitHub Trending"
    }
  ]
}
```

- `updatedAt` — ISO 8601 timestamp of the mirror's last refresh from Airtable. Informational; never write it into the graph.
- `recordCount` — how many objects are in `records`.
- `records` — the rows themselves. This array **is** the whole knowledge base: there is no `offset`, no `next` link, and no second page to request.

**Anything else means tier 2 is unusable.** Do not retry more than once, do not fabricate rows — report the failure in one line and go to tier 2.5:

| Response | What it means |
| --- | --- |
| `503` `{ "error": "kb_unavailable" }` | the feed is not configured on the server |
| `502` `{ "error": "upstream_failed" }` | the feed could not reach Airtable |
| any other non-200 status, a network/DNS error, a timeout, or `records: []` | nothing usable came back |

**Record shape.** Each element of `records` is a flat object: the fields sit at the top level, *not* nested under a `fields` key, and their names are camelCase. **Absent fields are omitted entirely**, exactly as Airtable does it — an absent key means blank, not an error, and not something to guess at (see `owner/plain-repo` above, which carries no enrichment fields and is therefore not a candidate under step 3).

The omission spares nothing: `name`, `url`, and `category` can be missing too. `id` is the only key guaranteed on every record. So — **a candidate row with no `name` or no `url` cannot become a suggestion at all**: the schema requires both, and `url` must match `^https?://`. Skip such a row silently and never invent a value to fill the hole. (A missing `category` is harmless — step 5 already writes `Other` for anything outside the schema's enum.)

Steps 3–5 are written against the Airtable field names, and they apply here **unchanged**: this feed is that Airtable table, one feed record per Airtable row. Translate the names with this table; nothing else about those steps changes.

| Feed key | Airtable field | Type | Read by |
| --- | --- | --- | --- |
| `id` | the record id itself | string, `^rec[A-Za-z0-9]{14}$` | **the only legal source of `airtableRecordId`** — copy it verbatim, character for character |
| `name` | `Name` | string | step 5 → `name` |
| `url` | `URL` | string | step 5 → `url` |
| `category` | `Category` | string | step 3 candidate filter · step 5 → `category` |
| `description` | `Description` | string | step 4 matching · step 5 claim fallback |
| `capabilityTags` | `Capability Tags` | array of strings | step 3 candidate filter · step 4 matching |
| `stepArchetypes` | `Step Archetypes` | array of strings | step 4 matching (strongest signal) |
| `improvementClaim` | `Improvement Claim` | string | step 5 → `claim` |
| `install` | `Install` | string | step 5 → `install` |
| `language` | `Language` | string | nothing |
| `stars` | `Stars` | number | nothing |
| `dateFirstSeen` | `Date First Seen` | string | nothing |

One gap to hold on to: **the feed does not carry `Why Noteworthy`.** Step 5's claim fallback names `Description` / `Why Noteworthy`; on this tier only `description` exists, so a row with no `improvementClaim` gets its one line written from that row's own `description` alone — never from anywhere else.

The feed is a cached snapshot: an edit made in the source base reaches it typically within ~30 minutes (server cache + background refresh); during upstream outages the feed serves the last good copy and `updatedAt` shows its age. Neither case is a failure and neither needs working around: use exactly the rows the feed returned. Rows from tier 2 count fully as reading the knowledge base — `meta.kbSource` is `"airtable"`, same as tier 1 (step 7).

The knowledge-base table's fields and select choices are documented in `kb/airtable-template.md`. Read it if a row's shape surprises you, or if the user is setting up their own base.

#### Tier 2.5 — the bundled snapshot (tier 2 unusable)

`kb/kb.json`, resolved from the root of the repository this skill ships in — the same checkout this SKILL.md was read from. It is a daily CI mirror of the very feed tier 2 just failed to reach, committed by the `KB snapshot` workflow, so it is a tracked file that is always there: not tier 2's scratch `kb.json`, and never deleted. No network, no request — just read it from disk.

The file is the tier-2 envelope on disk with one addition: `fetchedAt`, the ISO 8601 timestamp of the run that took the snapshot. That field is the snapshot's age; hold on to it for the report.

**PowerShell** (an error from either line — no file, or a file that is not JSON — is your signal to go to tier 3):

```powershell
$snap = Get-Content kb/kb.json -Raw | ConvertFrom-Json
"mirrored $($snap.fetchedAt) — $($snap.records.Count) records"
$snap.records | ConvertTo-Json -Depth 6
```

**Node (any platform)** — same signal, a thrown error means tier 3:

```bash
node -e "const s=JSON.parse(require('fs').readFileSync('kb/kb.json','utf8'));console.log('mirrored '+s.fetchedAt+' — '+s.records.length+' records');console.log(JSON.stringify(s.records,null,1))"
```

Present, parseable, and `records` non-empty → those records **are** the rows: the same flat camelCase shape as tier 2, so the key-translation table above and steps 3–5 apply unchanged, and `meta.kbSource` is `"airtable"` (step 7). One extra duty comes with them: these rows are a mirror, not the live feed, so the report's knowledge-base line (`## Report`, item 4) must carry the staleness note — `KB snapshot — last mirrored <date>`, the date read from `fetchedAt`. (A hand-rolled snapshot might lack that field; then the file's last commit date stands in: `git log -1 --format=%cs -- kb/kb.json`.)

Missing, unparseable, or `records: []` → tier 3. Do not fetch anything to repair the file — the network already had its turn in tier 2.

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
| `promptFragment` | optional — the instructions for using this resource at this step, written by you. See "The optimized prompt" below; omit the key when you have nothing grounded to say |
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

Every effect must eliminate or replace at least one node. An effect that deletes nothing passes the schema and still fails on screen: with empty `removeNodes` and empty `mergeNodes` the user clicks APPLY and watches an identical graph, and adding a `replaceWith` on its own only makes it worse — the graph grows a node and `stepsSaved` computes negative. If a resource eliminates nothing, it is not load-bearing; drop the suggestion instead. A real effect takes one of two shapes:

- **Collapse:** `removeNodes` (and/or `mergeNodes`) with `newEdges` closing the gap — steps disappear entirely.
- **Substitute:** `mergeNodes` listing the painful steps plus a low-pain `replaceWith` and `newEdges` wiring it in — several manual steps become one helper-driven step.

Two traps to author around:

- **Rewire what you cut.** Because step 3 drops every edge touching a deleted node, removing a node from the middle of the flow leaves its upstream and downstream disconnected. Supply `newEdges` reconnecting them (upstream → `replaceWith` → downstream, or upstream → downstream directly). **Nothing downstream checks connectivity** — no validator and no reducer will catch a missed rewire; the patch applies happily and strands an orphaned node on screen. YOU are the only gate: after authoring the effect, re-walk every surviving node and confirm it still has a path from the input node.
- **Respect the size floor.** The schema requires **at least 3 nodes and at least 2 edges**, and the graph is re-validated AFTER the patch applies. Count it before you write it: `nodes − (removeNodes + mergeNodes) + (replaceWith ? 1 : 0) ≥ 3`, and surviving edges + `newEdges` ≥ 2. On a small graph, keep effects modest — one or two nodes. Never author an effect that would shrink the graph below the floor.

Metrics, estimated **conservatively** — this number is on screen next to a real resource, so it has to survive scrutiny:

- `stepsSaved` — the count of nodes this effect actually eliminates: `removeNodes + mergeNodes − (replaceWith ? 1 : 0)`. Never more than that.
- `estTimeSavedMin` — minutes the eliminated steps genuinely cost, read off their `painLevel` (a pain-2 node is a few minutes, not an hour).
- `estTokensSaved` — `0` unless you have a real basis for a number. `0` is honest; a rounded guess is not.
- `manualInterventionsRemoved` — count only eliminated `review` nodes and explicit human hand-offs. Usually `0` or `1`.

If two suggestions target overlapping nodes, that is allowed but understand the consequence: applying the first deletes the second's target, so the second disappears (step 4). Prefer suggestions with disjoint targets so the user can apply them all.

### 7. Set `meta.kbSource`

- `"airtable"` — you fetched the knowledge base, whatever the match count (including zero). Tiers 1, 2, and 2.5 all count: the public feed is Airtable data too, and the snapshot is that feed on disk.
- `"none"` — tier 3: no source returned rows. Then `suggestions` must be `[]`.

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
- [ ] every `promptFragment` is 2–4 imperative sentences that name the resource, say when in the flow to use it, and say what it replaces
- [ ] no `promptFragment` asserts a capability its row does not claim, and none leans on another suggestion being applied
- [ ] wherever a fragment mentions installing, the row's `Install` is quoted verbatim
- [ ] `meta.promptIntro` keeps every requirement the user stated, adds none, and names no resources
- [ ] neither prompt field is an empty string — the key is omitted instead

## The optimized prompt

The viewer assembles an **optimized prompt** the user can paste straight into Claude: `meta.promptIntro` first, then the `promptFragment` of every suggestion they applied, in flow order, then a closing line naming any `install` no fragment mentioned. Both fields are optional prose that you write — without them the viewer templates a serviceable line per suggestion out of `name` / `category` / `claim` / `install`, so a file that omits them still works. Author them last: after the suggestions and effects are settled, before the validation loop.

These fields are prose about rows you already fetched, so the HARD RULES above cover them unchanged — a fragment may not name a resource that is not a suggestion in this graph, and it may not describe a capability its row does not claim. **Never write an empty string:** the schema rejects `""`. Nothing grounded to say → omit the key.

### `meta.promptIntro` — the opening

One paragraph, 2–4 sentences, rewriting `meta.task` as the opening of a prompt addressed to Claude instead of a description of what the user wants.

- Imperative, second person: "Build the weekly issue…", never "The user would like…".
- Carry over every requirement the user actually stated, and add none. No stack, deadline, tone, or acceptance criterion they did not give you.
- One sentence may frame the shape of the work the graph found — the phases, the review gate, the delivered artifact. No more than one.
- Name **no** resources. The fragments introduce those one at a time, each at the step where it belongs.
- Write it whatever the knowledge base did: a vanilla graph with `kbSource: "none"` still deserves a clean opening.
- Can't beat `meta.task` verbatim? Omit the key — the viewer falls back to the user's own words, which is never wrong.

### `suggestions[].promptFragment` — one instruction per resource

Per suggestion, 2–4 sentences telling Claude to use THAT resource at THAT point in the work. Four things every fragment does:

1. **Names the resource** exactly as the suggestion's `name`.
2. **Says when in the flow** to reach for it — anchored to the work the target node describes, in the task's own vocabulary ("before you rank anything", "once the tests exist"), so the fragments read as a sequence when the viewer concatenates them.
3. **Says what it replaces** — the manual work this effect removes or merges, named as work rather than as node ids.
4. **Stays inside the row's claim.** Every capability it asserts must be supported by that row's `Improvement Claim`, `Description`, or `Capability Tags`. No flags, subcommands, config keys, or API shapes you have not seen in the row — inventing one is the same offence as inventing a resource.

And three things a fragment never does:

- **Install boilerplate by default.** Mention installing only when the resource must be added before that step can run, and then only by quoting the row's `Install` verbatim in one short closing sentence. Skip it for anything the session already has — nothing is lost, because the viewer closes the prompt with the installs no fragment mentioned.
- **Talk about the graph.** This is instruction for doing the work, not a tour of the diagram: no "this node", "the suggestion above", "as the graph shows".
- **Lean on its neighbours.** The user may apply this suggestion and no other, so the fragment has to read correctly as the only one in the prompt. Never refer to another fragment or another resource.

Grounded in a row named `example/rss-mcp`, claim *"Fetches and filters feeds in one tool call instead of manual parsing."*, install `claude mcp add rss -- npx rss-mcp`:

> **Write this** — "Use the example/rss-mcp server to gather the articles instead of fetching each feed and parsing the XML by hand. Call it once with the feed list and a 7-day window before you rank anything, then work from what it returns. Add it first with `claude mcp add rss -- npx rss-mcp`."

> **Not this** — "example/rss-mcp is a fast, powerful RSS tool that handles all your feed needs." It names no moment in the flow, replaces nothing the user can point at, and "handles all your feed needs" is a capability the row never claimed.

## Validation loop (mandatory)

1. From the repo root, run: `node scripts/validate.mjs <path-you-wrote>` (e.g. `out/<slug>.workflow.json` or `gallery/<slug>.workflow.json`).
2. If `REJECTED`, fix the listed errors and re-run. If it still fails after one fix attempt, STOP and show the user the errors instead of looping.
3. Only report success after seeing `OK:`.

## Report

After `OK:`, tell the user:

1. the file path and node count;
2. the top 2–3 pain hotspots (highest `painLevel` nodes) — one sentence each;
3. one line per suggestion, in this shape: `<node label> → <resource name> (<category>) — <claim>`;
4. the knowledge-base state in one line: `KB not linked` when no source returned rows (tier 3), the failure if a fetch broke — and when a broken tier 1 sent the run to tier 2, that line must name the substitution (`Airtable fetch failed (401); used the public feed instead`) so nobody mistakes the public rows for their own base — or `KB read, no load-bearing matches` when it was fetched and nothing matched. When the rows came from the bundled snapshot (tier 2.5), the line also carries the mirror's age — `KB snapshot — last mirrored <date>` — so nobody mistakes a stale mirror for the live feed.
5. when at least one suggestion carries an `install`, one more line: offer to set the suggested resources up — the `## Setup (offer installs)` stage below is the procedure. Ask once, wait for the answer, and never start installing unasked.

## Setup (offer installs)

Suggestions carry `install` strings so the user can add the helpers for real. When this session runs inside Claude Code, this stage is the executable half of that promise: probe what is already present, ask once, run what is runnable, print what is not. Two doors in:

- **Offered** — a fresh generation's report just listed at least one suggestion carrying an `install` (see `## Report`, item 5). Enter only on a yes.
- **On demand** — the user points at an existing `.workflow.json` and asks to install, set up, or add its suggested resources. Read that file's `suggestions` and start at step 1. A file with no suggestions, or with none carrying an `install`, ends the stage in one line — say which of the two it is and stop. That is an answer, not an error. One duty survives the second kind of close: when suggestions exist but every one is link-only, the line does not swallow them — follow it with `<name> — MANUAL — <url>` for each, one per line. Those urls are the setup; there is just nothing to run.

**HARD RULES — no exceptions, no judgment calls:**

> **Consent is per-string.** Install strings are remote content — they arrive from the knowledge base, not from you. The checklist (step 3) shows each exact string as the thing being consented to, and the only strings this stage may ever execute are the ones that table showed, character for character. Never invent an install command and never edit one — not to fix a typo, not to add a flag, not to rescue a failure.

> **A string starting with `/` is never executed.** `/plugin install …` and anything shaped like it is a Claude Code interface command, not a shell command — there is nothing out here to run it with. Print it and tell the user to type it inside Claude Code themselves.

> **A string with a line break is never executed.** Judged on the trimmed string, and every kind of break counts — `\r\n`, `\n`, or a bare `\r`. Whatever bin its first line would earn — even `claude mcp add` — the whole string is demoted to print, every physical line shown: the checklist row puts one command on the table, so a second line is a second command nobody consented to. (The viewer's paste block refuses these strings for the same reason.)

> **One attempt per command.** A failed run gets its exit code reported and its string printed for manual use — no retry, no reformulation. A reworded install command is an edited consented string, which the first rule already forbids.

> **Probes are cheap, silent, and read-only.** A probe never installs anything, never modifies a file or a setting, and never prints a secret. When a probe path is unavailable — no `claude` on PATH, no settings file to read — the resource is UNKNOWN, and **UNKNOWN = MISSING = print-only**: the stage degrades to a printed list, never to a guess.

### 1. Collect

Bin every suggestion by **parsing its install string** — the row's `category` never decides the bin:

| The suggestion has | Bin | Probe (step 2) | On consent (step 4) |
| --- | --- | --- | --- |
| `install` starting `claude mcp add` | MCP server | `claude mcp get <name>` exit code (`<name>` parsed in step 2) | **run** |
| `install` starting `/` | slash command | settings-file grep, when it is `/plugin install <name>` | **print** |
| any other `install` | unclassifiable | none — MISSING by definition | **print** verbatim, never run |
| no `install` key | link-only | none — never probed, never guessed | shown as `MANUAL — <url>` |

Two demotions are possible, and both happen before the checklist is drawn, so the table the user consents to already shows the row as `print:`. First, right here at binning: an install string still carrying a line break after trimming (`\r\n`, `\n`, or a bare `\r`) goes to the **print** bin whatever its first line says — the line-break HARD RULE above. Second, in step 2: a `claude mcp add` whose `<name>` will not parse moves there too.

Dedupe before going further: **identical install strings collapse to one row** — two suggestions sharing a resource get one checklist line, one consent, one run (name both resources on the line).

### 2. Probe

Establish what is already present before asking for anything.

**MCP servers.** The CLI's shape is `claude mcp add [flags] <name> <commandOrUrl> [args…]`, so parse for the name: starting at the token after `add`, drop each `-`-leading token together with the one token that follows it, and the first token left standing is `<name>` — `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` parses to `sentry`; `claude mcp add my-server -- npx my-mcp-server` to `my-server`. If no token survives, or the survivor does not read as a server name (an `=`, a `://`, a stray quote), or anything else leaves doubt, do not guess: **demote the row to the print bin** — step 3 writes it `print:`, step 4 prints it untouched, and the re-probe never asks after it. With a name in hand, check the exit code — it is stable where parsing `claude mcp list` text is not, and the probe command is identical in both shells:

```powershell
claude mcp get <name> *> $null; $LASTEXITCODE
```

```bash
claude mcp get <name> >/dev/null 2>&1; echo $?
```

(`0` = INSTALLED; anything else = MISSING. No `claude` on PATH → every MCP row is UNKNOWN = MISSING.)

**Plugins** — `/plugin install <name>` rows only. `<name>` is the token after `/plugin install`; if it carries an `@marketplace` suffix, probe with the part before the `@`. An enabled plugin appears as a `"<name>@<marketplace>"` key under `enabledPlugins` in the settings files — user-level and the project's — so ask, quietly, whether that key opening exists. The probe answers yes or no and never echoes the line it matched: a settings file's contents stay out of the transcript.

```powershell
(Get-ChildItem "$HOME\.claude\settings.json", ".claude\settings*.json" -ErrorAction SilentlyContinue | Select-String -Pattern '"<name>@' -SimpleMatch -Quiet) -contains $true
```

```bash
grep -q '"<name>@' ~/.claude/settings.json .claude/settings*.json 2>/dev/null; echo $?
```

(run from the project root; PowerShell answers `True`, bash answers `0`, when the plugin is enabled — anything else, including no output at all, is MISSING. The `Get-ChildItem` front end is load-bearing, not style: in PowerShell 5.1, `Select-String -Path` aborts loudly when the project has no `.claude` directory, `-ErrorAction` notwithstanding, and a probe that errors on screen is not silent. That key layout is observed, not a contract — one more reason a plugin is only ever printed, never run. No settings file at all → UNKNOWN = MISSING.)

Link-only rows, unclassifiable strings, and demoted rows — the line-break kind from step 1 and the unparseable-name kind from this step alike — are never probed. Their statuses are fixed: MANUAL for link-only, MISSING for all the rest.

### 3. Checklist — the consent gate

One table, one row per deduped install string plus one per link-only resource. The Action column carries the **exact string** — this table is the consent artifact, and step 4 may act on precisely what it shows, nothing else:

| Resource | Category | Status | Action |
| --- | --- | --- | --- |
| the suggestion's `name` | its `category` | `INSTALLED` / `MISSING` / `MANUAL` | `run:` or `print:` followed by the verbatim install string — `print: (2 lines, below)` for a line-break demotion — or `MANUAL — <url>` |

That `(2 lines, below)` cell is the medium bowing to the rule, not the rule bending: a markdown cell cannot carry a line break, and the line-break-demoted string is exactly the one whose every physical line must be on this table. So the cell states the true line count and points down, and the string itself stands directly beneath the table in a fenced code block — verbatim, every line, one fence per demoted row, introduced by the resource's `name` so row and fence cannot be mismatched. The fence is part of the consent artifact: what step 4 prints for that row is what its fence showed.

Count the table — N is every row, K the INSTALLED rows, M the MISSING rows (MANUAL rows are neither: they carry nothing to install) — and ask:

> N suggested, K already installed — install the remaining M? **all / pick / none**

When the table carries MANUAL rows, N alone would not reconcile with K + M — so the question gains one clause naming where the difference went, count and pointer both:

> N suggested, K already installed — 2 link-only, listed above — install the remaining M? **all / pick / none**

- **Act only on an answer.** No answer, an ambiguous answer, a changed subject: nothing runs and nothing is printed as done. Silence is never consent, and there are no "obvious ones" to pre-run.
- `all` = every MISSING row · `pick` = exactly the rows the user names · `none` = close; the checklist itself already delivered every string and url.
- M = 0 → nothing to ask. Say the K resources are already in place (and that the MANUAL urls are on the table), then close.

### 4. Execute & print

Consented rows only, in checklist order:

- **Run rows** (the MCP-server bin, and only it — no runnable string starts with `/`, but lacking the `/` is not what makes a string runnable: anything unrecognized stayed a print row in step 1, any string still carrying a line break after trimming was demoted to one there too, and a `claude mcp add` whose name would not parse followed in step 2): run the string **verbatim, once**, and capture the exit code. Non-zero → one line naming the code, the string printed back for manual use, and straight on to the next row — no retry, no rewording. Worth one passing note to the user: `claude mcp add` installs at **local scope by default**, so the server lands in this project unless the string itself says otherwise.
- **Print rows** (slash commands, unclassifiable strings, and both classes of demoted row — line-break and unparseable-name): print the string verbatim — every physical line of it, when it has more than one — plus one line of instruction. A slash command is typed inside Claude Code by the user; an unclassifiable string is handed over as-is, for the user to run where it belongs; a line-break demotion says why nothing ran: a second line is a second command nobody consented to.

### 5. Re-probe what ran, then report

Re-probe **only the strings that actually ran** — the same probes as step 2, nothing new, nothing broader. A printed string is not re-probed (nothing has happened yet), a MANUAL row is not re-probed (there is nothing to probe), and rows the user declined are left alone. Then close with one line per consented row:

- `<name> — installed` · the run succeeded and the re-probe proves it.
- `<name> — still missing (exit <code>); run it yourself: <string>` · the run failed, or the re-probe still cannot see the result. On either path `<code>` is the exit code the run itself returned — on the second that is its `0`, reported as exactly that: the command exited 0 and the re-probe still cannot see it. The printed string is the fallback, and this line is the last thing the stage does about it.
- `<name> — printed for you: <string>` · a print row the user consented to.

That is the whole close. No advice loop, no second pass, no "want me to try again?" — the one attempt happened and the honest state is on screen.

### 6. Self-check before closing

Walk the list; every miss here is a consent or honesty bug, not a formatting one:

- [ ] everything run or printed appeared in the checklist first, string-for-string — nothing acted on that the table, or a demoted row's fence beneath it, did not show
- [ ] no string starting with `/` was executed — slash rows were printed only
- [ ] no string with a line break (post-trim) was executed — demoted rows were printed whole, every line of them
- [ ] every run row got exactly one attempt — no retries, no reworded commands
- [ ] nothing ran before an explicit `all` / `pick` / `none`
- [ ] the re-probe covered only what actually ran
- [ ] link-only rows were never probed and never guessed at — `MANUAL — <url>` and nothing more
- [ ] no probe modified anything, and no output printed a secret
