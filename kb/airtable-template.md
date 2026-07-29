# The knowledge base — Airtable template

Flowprint's suggestions come from exactly one place: an Airtable table of real, existing resources. The `/graph-my-task` skill reads it live over the REST API at generation time and may only ever suggest rows it actually fetched — no invented tools, no remembered ones. There is no sync script and no cached copy in this repo; the table *is* the knowledge base.

This document is the contract. Replicate the table below and your fork suggests from your own curated list.

## Quick start for a fork

1. Create an Airtable base (any name) with one table (any name) shaped like [the schema below](#the-table).
2. Add rows: one resource per row, deduplicated by `URL`.
3. Fill `Capability Tags`, `Step Archetypes`, and `Improvement Claim` on the rows you want suggested — an unenriched row is invisible to the matcher (see [what makes a row a candidate](#what-flowprint-does-with-the-table)).
4. [Create a read-only personal access token](#creating-the-token) and export it as `AIRTABLE_API_KEY`.
5. Point the skill at your base with `FLOWPRINT_AIRTABLE_BASE` and `FLOWPRINT_AIRTABLE_TABLE` (see [environment variables](#environment-variables)).
6. Run `/graph-my-task "your task"`. The graph's `meta.kbSource` reads `"airtable"` and matched nodes carry suggestion cards.

No token? Nothing breaks — the skill produces the vanilla graph with `meta.kbSource: "none"` and reports "KB not linked".

## The table

The reference base is Tahir's *Daily Trending — GitHub & Claude Ecosystem*, table `Trending Repos`: one row per unique repo/project, deduplicated by URL, written by a scheduled daily scan. Thirteen fields, in order:

| # | Field | Airtable type | Read by the skill | What it holds |
| --- | --- | --- | --- | --- |
| 1 | `Name` | Single line text | yes → `suggestions[].name` | Full repo/project name, e.g. `owner/repo`. Primary field. |
| 2 | `URL` | URL | yes → `suggestions[].url` | Canonical link. **The dedupe key** — one row per URL. |
| 3 | `Category` | Single select | yes → `suggestions[].category` | What kind of item it is. Choices below. |
| 4 | `Description` | Long text | yes (matching + claim fallback) | What the project does, in plain language. |
| 5 | `Language` | Single line text | no | Primary language, capture metadata. |
| 6 | `Stars` | Number | no | Total stars at time of capture. |
| 7 | `Stars Gained` | Number | no | Approximate stars gained that day, if known. |
| 8 | `Why Noteworthy` | Long text | yes (claim fallback only) | Why it was trending / buzzing that day. |
| 9 | `Date First Seen` | Date | no | First capture date. |
| 10 | `Capability Tags` | Multiple select | yes (matching + candidate filter) | What the resource is good at. Choices below. |
| 11 | `Step Archetypes` | Multiple select | yes (matching — strongest signal) | Which workflow-step types it upgrades. Choices below. |
| 12 | `Improvement Claim` | Single line text | yes → `suggestions[].claim` | One plain-words line: what this makes dramatically better, or eliminates. |
| 13 | `Install` | Single line text | yes → `suggestions[].install` | One-line install/setup hint, e.g. `claude mcp add …`, `/plugin install …`. Blank is fine. |

Fields 10–13 are the **enrichment fields**. Without them a row can still be a candidate (if its `Category` is a Claude/MCP one), but the matcher has far less to work with and will usually pass it over.

### Select choices

`Category` — single select, exactly these five:

| Choice | Airtable color |
| --- | --- |
| `GitHub Trending` | blue bright |
| `Claude Skill` | purple bright |
| `Claude Plugin` | pink bright |
| `MCP Server` | teal bright |
| `Other` | gray bright |

`Capability Tags` — multiple select, fifteen options (add your own if nothing fits):

`browser-automation` · `code-search` · `code-generation` · `testing` · `deployment` · `documentation` · `data-etl` · `research` · `orchestration` · `memory` · `security` · `ui-design` · `api-integration` · `image-generation` · `review`

`Step Archetypes` — multiple select, ten options, one per workflow-step type Flowprint graphs produce:

`research` · `scaffold` · `code` · `test` · `browser-verify` · `deploy` · `document` · `data-etl` · `review` · `orchestrate`

Keep the archetype option names exactly as written — the matcher compares them against graph nodes by name.

### Optional extra fields

Tahir's live base carries five more fields the daily scan writes for his own reading: `Domain` (single select), `How It Works` (long text), `How To Run` (long text), `Wow Factor` (rating), `Source` (single line text). Flowprint ignores them. Add them if they are useful to you; leaving them out changes nothing.

## What Flowprint does with the table

**Candidate filter.** A row can be suggested only if *either* its `Category` is `Claude Skill`, `Claude Plugin`, or `MCP Server`, *or* its `Capability Tags` is non-empty (any category, including `GitHub Trending` and `Other`). Everything else is skipped — an unenriched trending row is not a defect, just not a candidate.

**Matching.** Each graph node's kind, label, and description are compared against each candidate's `Step Archetypes`, `Capability Tags`, and `Description`. Only load-bearing matches survive: the resource has to actually erase or collapse the work the node describes. Zero to three suggestions per graph is the normal range, and a forced match is worse than none.

**Category mapping.** The workflow schema's `category` enum is `Claude Skill`, `Claude Plugin`, `MCP Server`, `Connector`, `Other`. Airtable's `GitHub Trending` is not in it, so those rows are written as `Other`. If you add your own `Category` choices, they map to `Other` too — unless you name one `Connector`, which the schema accepts as-is.

**Blank fields.** The Airtable API omits empty fields from a record's `fields` object entirely. An absent key means blank: no `Install` means the suggestion simply carries no install hint, and no `Improvement Claim` means the skill writes one from that row's own `Description` / `Why Noteworthy` — never from anywhere else.

**Record ids.** Every suggestion carries the row's real record id (`rec` + 14 characters) in `airtableRecordId`. That field is the proof the resource exists, and it is the identity key the viewer uses to apply, undo, and dedupe. A graph must never attach the same row to two nodes.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AIRTABLE_API_KEY` | **yes** (no key → no suggestions) | — | Personal access token with read access to your base. |
| `FLOWPRINT_AIRTABLE_BASE` | no | `appRSePRgk4jlaRUc` | Your base id (`app` + 14 characters). |
| `FLOWPRINT_AIRTABLE_TABLE` | no | `tblOJzSLHAW7lbBWv` | Your table id (`tbl` + 14 characters) — a table name also works in the REST path, but the id never breaks when the table is renamed. |

Find both ids in the browser URL while the table is open: `https://airtable.com/appXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX/viwXXXXXXXXXXXXXX`.

Set them where the Claude Code session can see them — export before launching, or set them for your user account:

```bash
# bash / Git Bash — current shell
export AIRTABLE_API_KEY='patXXXXXXXXXXXXXX.XXXXXXXX…'
export FLOWPRINT_AIRTABLE_BASE='appYOUROWNBASEID'
export FLOWPRINT_AIRTABLE_TABLE='tblYOUROWNTABLEID'
```

```powershell
# PowerShell — current session
$env:AIRTABLE_API_KEY = 'patXXXXXXXXXXXXXX.XXXXXXXX…'
# PowerShell — persistent, for every future session
[Environment]::SetEnvironmentVariable('AIRTABLE_API_KEY', 'patXXXXXXXXXXXXXX.XXXXXXXX…', 'User')
```

## Creating the token

1. Go to <https://airtable.com/create/tokens> and click **Create new token**.
2. Name it something like `flowprint-read`.
3. **Scopes:** add `data.records:read` — and nothing else. The skill only ever reads; never grant a write scope for this.
4. **Access:** add the one base holding your knowledge-base table.
5. Create the token and copy it immediately (`pat…`) — Airtable shows it once.
6. Export it as `AIRTABLE_API_KEY` per the block above.

Verify it end to end before running the skill:

```bash
curl -sS -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  "https://api.airtable.com/v0/${FLOWPRINT_AIRTABLE_BASE:-appRSePRgk4jlaRUc}/${FLOWPRINT_AIRTABLE_TABLE:-tblOJzSLHAW7lbBWv}?pageSize=3"
```

Rows back means you are wired. `AUTHENTICATION_REQUIRED` means the token is wrong or lacks access to that base; `NOT_FOUND` means the base or table id is wrong. The API returns at most 100 records per request plus an `offset` — the skill pages through all of them.

## Keeping the table fed

The reference base is filled by a scheduled daily scan that lives outside this repo — a Claude task that captures the day's notable repos and Claude-ecosystem releases into the table. Any capture routine works; what matters is that the enrichment fields get filled, because those are what the matcher reads.

If you build your own capture automation, this is the enrichment block from Tahir's scan prompt, verbatim, as a starting point:

> For every row you create or update in Trending Repos, also fill the enrichment fields:
> - **Capability Tags**: pick 1–4 existing options that describe what the resource is good at (create a new option only if nothing fits).
> - **Step Archetypes**: which workflow-step types it upgrades — research, scaffold, code, test, browser-verify, deploy, document, data-etl, review, orchestrate.
> - **Improvement Claim**: one plain-words line: what does this make dramatically better or eliminate?
> - **Install**: the one-line install command if evident from the README (e.g. `claude mcp add …`, `/plugin install …`); leave blank if unknown.

Enriching rows by hand works just as well — the Airtable MCP server or the Airtable UI, whichever you prefer. Nothing in this repo writes to the table.
