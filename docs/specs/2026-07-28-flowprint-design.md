# Flowprint — Design Specification

## Context

Tahir wants a new public tool: a user describes a task they'd give Claude, and the tool renders a sophisticated flowchart of how Claude would break it down **with no helpers** — then overlays, at each node, matched resources (Claude skills, plugins, connectors, MCP servers) drawn **exclusively** from his Airtable knowledge base ("Daily Trending — GitHub & Claude Ecosystem", `appRSePRgk4jlaRUc`, table `Trending Repos` `tblOJzSLHAW7lbBWv`), and lets the user *simulate* how much simpler the workflow becomes as each resource is applied. Public, forkable, usable with the forker's own Claude subscription. Brainstormed 2026-07-28; all decisions below were made interactively with Tahir.

**Working name:** Flowprint (rename anytime).

## Decisions (locked with Tahir)

| Decision | Choice |
|---|---|
| Home | Standalone public GitHub repo + demo showcased on tahirlone.com |
| Hosted demo | Precomputed gallery only — zero server cost, zero auth |
| Engine | A **Claude Code skill** (`/graph-my-task`) — no generation server, no auth code; forkers use their own Claude subscription via Claude Code itself |
| Knowledge base | Skill reads Airtable **live via REST** with the user's `AIRTABLE_API_KEY` at generation time. **No data-gathering/sync/backfill scripts in the repo.** Only repos present in Airtable may ever be suggested (each suggestion carries its Airtable record ID) |
| KB enrichment | Tahir extends his existing scheduled daily-scan task (outside this repo) to write enrichment fields into Airtable |
| Magic moment | Interactive per-node apply with live morph **plus** one-click "Optimize" cinematic |
| Visual identity | Blueprint / technical-drafting aesthetic, themeable via design tokens |
| Graph stack | React Flow (`@xyflow/react`) + ELK (`elkjs`) layout + Framer Motion, in a **Vite + React static SPA** (forkers get free GitHub Pages hosting) |

## Architecture

```
flowprint/                            (new standalone repo)
├── skill/graph-my-task/SKILL.md      # THE ENGINE — Claude Code skill
├── viewer/                           # Vite + React static SPA
│   └── src/
│       ├── graph/                    # schema types, ELK layout adapter, morph reducer
│       └── components/               # BlueprintSheet, TitleBlock, BlueprintNode, SuggestionDrawer,
│                                     # ImpactMeter, RevisionStrip, CinematicPlayer, ...
├── gallery/*.workflow.json           # precomputed examples = hosted demo content
├── kb/airtable-template.md           # documentation: base schema + daily-scan prompt for forkers' own KB
├── schema/workflow.schema.json       # JSON Schema — the contract
└── .github/workflows/                # CI (lint/test/build) + GitHub Pages deploy
```

### The contract — `*.workflow.json`

- `meta` — task prompt, title, generatedAt, model, kbSource (`airtable` | `none`)
- `nodes[]` — id, label, kind (`input|process|decision|loop|review|output`), description, `painLevel` (est. effort/tokens/time; drives complexity-heat tint)
- `edges[]` — from, to, label?, kind (`sequence|branch|retry`)
- `suggestions[]` — nodeId, `airtableRecordId` (**required** — enforces Airtable-only rule), name, url, category (Skill/Plugin/MCP/Connector), one-line improvement claim, install hint, and an **`effect` patch**: `{removeNodes[], mergeNodes[], replaceWith?, newEdges[], metrics: {stepsSaved, estTimeSaved, estTokensSaved, manualInterventionsRemoved}}`

The viewer applies effects with a **pure reducer** `applyEffect(graph, suggestion) → graph'` — offline simulation, deterministic undo/redo, directly unit-testable. No Claude call needed to explore what-ifs.

### The skill pipeline (`/graph-my-task "<task>"`)

1. Decompose the task into the vanilla graph (how Claude would do it with zero helpers).
2. Read the KB live from Airtable REST (`AIRTABLE_API_KEY`, base + table IDs from env/config). No key → still generate the vanilla graph, note "KB not linked" (`meta.kbSource: "none"`), skip suggestions.
3. Match KB records to nodes; author effect patches + metrics. Suggestions without a real Airtable record ID are invalid.
4. Self-validate against `schema/workflow.schema.json`; retry once on failure.
5. Write `gallery/<slug>.workflow.json` (or `out/` for non-gallery runs); tell the user to open the viewer.

### Airtable enrichment (Tahir's side, outside the repo)

Add fields to `Trending Repos`: `Capability Tags` (multipleSelects), `Step Archetypes` (multipleSelects: research, scaffold, code, test, browser-verify, deploy, document, data-etl, review, orchestrate), `Improvement Claim` (single line), `Install` (single line). Extend the scheduled daily-scan prompt to populate them per captured repo. Existing 27 rows: enrich via a one-off Claude chat with the Airtable MCP (not a repo script).

## Viewer experience (approved Section 2)

- **Drafting-sheet conceit**: blueprint grid, sheet border, corner **title block** (task, "DRAWN BY: CLAUDE", date, sheet no., **REV letter that increments per applied optimization**). Revision strip = time-travel scrubber between states.
- Nodes as schematic components (process blocks, decision diamonds, loop glyphs), architect lettering, ELK orthogonal routing; edges **draw on like a plotter pen** (stroke-dashoffset).
- **Complexity heat** from `painLevel`; red drains away as upgrades apply.
- Matched nodes get numbered **detail-callout markers** (①②) → **SuggestionDrawer** listing KB resources, color-coded by category using the Airtable select colors (Skill purple, MCP teal, Plugin pink, blue for trending/other).
- **Apply** = rubber-stamp animation ("UPGRADED — <name>") → morph: merge/collapse, ELK re-layout, FLIP animation; removed structure lingers as faint **erased-pencil ghosts**. **ImpactMeter** styled as the sheet's materials-schedule table counts up savings.
- **Optimize cinematic**: auto-pan node to node applying best suggestions, end on the final revved sheet + scorecard. **PNG export** of the sheet.
- Insight extras: hold-to-X-ray (vanilla ghost under optimized), critical-path glow.
- `prefers-reduced-motion` disables morph/cinematic animation paths.

## Phases (one at a time; each waits for Tahir's local test + approval)

1. **Contract + engine** — new repo scaffold; `schema/workflow.schema.json`; `/graph-my-task` skill producing valid *vanilla* graphs (no suggestions). Commit the design spec as `docs/specs/2026-07-28-flowprint-design.md` in the new repo.
2. **Viewer core** — Vite SPA; React Flow + ELK blueprint rendering of gallery JSON; sheet + title block; plotter edge animation; complexity heat; gallery index page.
3. **Suggestions end-to-end** — Tahir enriches Airtable + daily scan (his side); skill gains KB read + matching + effect patches; viewer gains callouts, drawer, apply-stamp morph, ImpactMeter, RevisionStrip. *The magic-moment phase.*
4. **Cinematic + insight polish** — Optimize auto-play, pencil ghosts, X-ray, critical path, PNG export.
5. **Public launch** — README fork story ("fork → add AIRTABLE_API_KEY → enable Pages → your own instance"), CI + Pages deploy workflow, 6–8 curated gallery workflows generated with the skill, tahirlone.com showcase entry linking to the live demo.

## Error handling

- Airtable unreachable/keyless → vanilla graph + visible "KB not linked" note (never a hard failure).
- Skill output schema-validated with one retry.
- Viewer: malformed JSON → on-theme "DRAWING REJECTED — see notes" error sheet; ELK failure → simple layered fallback layout.

## Verification

- **Unit**: morph reducer (apply/undo/idempotence, patch edge cases), schema fixtures (valid + deliberately broken).
- **E2E (Playwright)**: load gallery → open drawer → apply suggestion → assert morph result + meter values → run cinematic → export PNG.
- **Skill**: run `/graph-my-task` on 3 real prompts; validate outputs against the schema; confirm every suggestion's `airtableRecordId` exists in the base.
- **CI**: lint, test, build, Pages deploy on every PR. Keep Lighthouse a11y at 100 (reduced-motion respected).
- Per Tahir's workflow: he tests each phase locally before the next begins; nothing ships to tahirlone.com until phase 5.

## Notes

- Model floor: Fable 5 for major build tasks, Opus 4.8 minimum otherwise (standing rule).
- The tahirlone.com side of phase 5 follows the existing Lab/showcase pattern (`src/` nav + work entry) — link-out, not embed, keeping the site untouched until then.
