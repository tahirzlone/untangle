# Flowprint Phase 3 — Suggestions + Magic Moment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The product's reason to exist: Airtable-matched suggestions appear on graph nodes; clicking a node opens a detail drawer; **Apply** morphs the graph (nodes merge/collapse, ember heat extinguishes) with an animated impact meter, undo, and version history. Plus Tahir's interactivity mandate: **click, drag, and reshape the flow with the mouse**.

**Architecture:** The contract already carries `suggestions[]` with declarative `effect` patches (Phase 1). This phase adds: (a) an interactive canvas (draggable nodes, live edge reshaping, click-to-open drawer); (b) a pure apply/undo reducer over the Workflow type; (c) the `/graph-my-task` skill's KB stage (live Airtable REST); (d) the suggestion UI + FLIP morph. Schema and validator stay FROZEN — everything rides on the existing contract. The Signal theme is LAW (see [[flowprint-design-direction]] memory: no drafting metaphors, techie/modern only).

**Tech Stack:** unchanged (Vite/React/TS, @xyflow/react 12, elkjs, vitest). No new dependencies.

## Global Constraints

- Branch: `feat/suggestions` off `main` @ `20aabf6`.
- FROZEN: `schema/`, `scripts/`, root `tests/` (root suite stays 19/19). `.claude/skills/graph-my-task/SKILL.md` is IN SCOPE this phase (the KB stage is its Phase-3 upgrade).
- Airtable-only rule is absolute: every suggestion carries a real `airtableRecordId`; the skill must instruct that suggestions come ONLY from Airtable rows (Tahir's hard rule).
- Airtable access in the skill: REST via `AIRTABLE_API_KEY` env var; base `appRSePRgk4jlaRUc`, table `tblOJzSLHAW7lbBWv` as DEFAULTS overridable via env (`FLOWPRINT_AIRTABLE_BASE`, `FLOWPRINT_AIRTABLE_TABLE`) so forkers can point at their own. Enrichment fields exist as of 2026-07-29: `Capability Tags`, `Step Archetypes`, `Improvement Claim`, `Install`.
- Tokens LAW; Signal vocabulary only; `prefers-reduced-motion` disables all new animation; commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; Windows/PowerShell commands.
- Viewer suite (55 at branch start) must never drop; report exact counts per task.

## Effect semantics (binding for reducer + skill + tests)

Applying suggestion S to workflow W:
1. Delete nodes in `S.effect.removeNodes` and `S.effect.mergeNodes`.
2. If `S.effect.replaceWith` exists, add it as a new node (kind/pain per its fields).
3. Drop every edge touching a deleted node; add `S.effect.newEdges` verbatim.
4. Remove S from `suggestions`; also remove any OTHER suggestion whose `nodeId` or effect references a deleted node (its target no longer exists).
5. Accumulate `S.effect.metrics` into the session totals.
Result must satisfy `validateWorkflow` (integrity: no dangling refs). The reducer throws on a structurally invalid patch (defense against bad generation) — the UI catches and shows the suggestion as un-appliable.

---

### Task 1: Interactive canvas — drag, click, reshape

**Files:** Modify `viewer/src/components/GraphCanvas.tsx`, `viewer/src/components/canvas.css`, `viewer/src/components/node.css`; Create `viewer/src/components/DetailDrawer.tsx` + `drawer.css`; Tests: `GraphCanvas.test.tsx` (extend), `DetailDrawer.test.tsx`.

**Interfaces produced:** GraphCanvas holds RF nodes in state (`useNodesState`); `onNodeClick` selects; `<DetailDrawer node={WorkflowNode} onClose />` slides from the right (360px, `--surface` panel, `--line` border-left): node label, kind badge, pain meter (reuse `.sg-meter` markup), full description, and an empty `data-testid="drawer-suggestions"` section Task 4 fills. Escape/close button/X dismiss.

Key changes:
- `nodesDraggable={true}`, `elementsSelectable={true}`; keep `nodesConnectable={false}` (users reshape layout, not workflow semantics).
- Nodes via `useNodesState(initialNodes)` + `onNodesChange={onNodesChange}` — RF then applies drag deltas; edges follow automatically (they derive from handle positions).
- **Back-edge lanes recompute live**: `planBackEdges` inputs come from current node positions — derive laid-out rects from RF node state (not the static ELK result) with `useMemo` over `nodes`; pass per-edge `floorY/lane` through edge `data` (recomputed on drag via onNodesChange — throttle with `requestAnimationFrame` if jittery; correctness first, silk later).
- Selection ring: `.sg-node--selected` (accent border + `0 0 0 2px var(--accent-soft)` + subtle glow) driven by RF's `selected` prop passed into SignalNode data or className.
- Toolbar gains `RESET LAYOUT` ghost-button (mono, `--dim`, border `--line`; hover accent) → re-runs ELK and resets positions.
- Drag + click coexist: RF fires `onNodeClick` only on non-drag clicks (built-in threshold) — verify, don't reimplement.

- [ ] Tests first (fail): clicking a node opens drawer with its label + description; Escape closes; drawer shows pain meter; RESET LAYOUT button renders; nodes carry draggable class (`.react-flow__node[draggable]`-equivalent: assert `nodesDraggable` via absence of the `nodrag`... simplest: assert RF wrapper has `nodes-draggable` pane class or node has `draggable` class per RF DOM contract — inspect and pin what RF 12 actually emits, then assert that).
- [ ] Implement; suites green; commit `feat(viewer): interactive canvas — drag to reshape, click for detail drawer`.

### Task 2: Suggestion types + apply/undo reducer

**Files:** Modify `viewer/src/graph/types.ts` (add `Suggestion`, `Effect`, `EffectMetrics` mirroring the schema; `Workflow.suggestions: Suggestion[]`); Create `viewer/src/graph/apply.ts` + `apply.test.ts`.

**Interfaces produced (exact — Tasks 4-5 consume):**
```ts
export interface SessionMetrics { stepsSaved: number; estTimeSavedMin: number; estTokensSaved: number; manualInterventionsRemoved: number; }
export interface GraphSession {
  versions: Workflow[];          // versions[0] = original; last = current
  appliedIds: string[];          // airtableRecordId per applied step, parallel to versions[1..]
  metrics: SessionMetrics;       // cumulative
}
export function createSession(wf: Workflow): GraphSession;
export function applySuggestion(session: GraphSession, airtableRecordId: string): GraphSession;  // throws InvalidEffectError on structural breakage
export function undo(session: GraphSession): GraphSession;      // no-op at version 0
export function reset(session: GraphSession): GraphSession;
export function current(session: GraphSession): Workflow;
```
Implement effect semantics exactly per the binding block above. Pure, immutable (fresh objects, no mutation — FLIP diffing depends on it).

- [ ] Tests first (~15): apply removes/merges/adds replaceWith/drops touching edges/adds newEdges; cascading suggestion cleanup (other suggestion pointing at a removed node disappears); metrics accumulate across two applies; undo returns exact prior workflow (deep-equal) and rolls metrics back; reset returns versions[0] with zeroed metrics; result of every apply passes `validateWorkflow` (import from scripts/validate-pure via the existing load path); InvalidEffectError on a patch whose newEdges reference a node the same patch removes (Phase-1 deferred integrity — enforced HERE in the reducer); idempotence guard (applying same id twice throws — it's gone after first).
- [ ] Implement; commit `feat(viewer): pure apply/undo reducer over suggestion effects`.

### Task 3: Skill Phase-3 upgrade + forker KB docs

**Files:** Modify `.claude/skills/graph-my-task/SKILL.md`; Create `kb/airtable-template.md`.

SKILL.md changes:
- Description: replace the stale "blueprint" trigger word with "workflow"/"pipeline" (Signal vocabulary; triggers stay functional: graph, flowchart, map, workflow).
- New "## Knowledge base (suggestions)" section between Output and Validation loop:
  - If `AIRTABLE_API_KEY` is set: fetch all rows via REST (`https://api.airtable.com/v0/{base}/{table}` with pagination; base/table from `FLOWPRINT_AIRTABLE_BASE`/`FLOWPRINT_AIRTABLE_TABLE`, defaulting to Tahir's IDs) — use curl or a short node -e snippet, whichever the session prefers.
  - Candidate filter: Category ∈ {Claude Skill, Claude Plugin, MCP Server} OR (Other with non-empty Capability Tags). Match candidates to nodes via Step Archetypes/Capability Tags vs node kind + description; only genuinely load-bearing matches (0-3 suggestions per graph is normal; forced matches are worse than none).
  - Author each suggestion per the schema: real `airtableRecordId` (the row's `id`), name/url/category from the row, `claim` from Improvement Claim (write one if the row's is empty — but never invent a repo), `install` from Install, and an honest `effect` patch obeying the Effect-semantics block (metrics estimated conservatively).
  - `meta.kbSource: "airtable"`. No key → vanilla graph, `kbSource: "none"`, note "KB not linked" to the user (existing behavior).
  - HARD RULE stated verbatim: "Suggestions may ONLY reference rows that exist in the Airtable. Never invent, remember, or import resources from anywhere else."
- Report section gains: per-suggestion one-liner (node → resource → claim).

kb/airtable-template.md: document the table schema (all 13 fields incl. the 4 enrichment fields + select choices) so forkers can replicate the base, plus the env vars, plus a copy of the daily-scan prompt block (Tahir's scheduled-task snippet — see plan appendix) they can adapt.

- [ ] Verify: SKILL.md self-consistent with schema (field names, category enum); run `/graph-my-task`-as-written mentally against a keyless env (must still produce vanilla). Suites untouched but run anyway. Commit `feat(skill): Airtable knowledge-base stage — matched suggestions with effect patches`.

### Task 4: Suggestion UI — badges, drawer list, KB chip

**Files:** Modify `viewer/src/components/SignalNode.tsx` + `node.css` (badge), `DetailDrawer.tsx` + `drawer.css` (suggestion list), `GraphCanvas.tsx` (wire suggestions per node into node data + drawer; toolbar KB chip reads meta.kbSource — already does), plus tests.

- Badge: nodes with ≥1 suggestion get a `--accent` pip at top-right: small circle, count inside (mono 9px, `--bg-deep` text), subtle pulse (reduced-motion static). `data-testid="sg-badge"`.
- Drawer suggestions section: per suggestion a card — category chip (color per category: Skill purple `#`… NO raw hex: add tokens `--cat-skill: #C084FC; --cat-plugin: #F472B6; --cat-mcp: #2DD4BF; --cat-other: #94A3B8;` to tokens.css — sanctioned addition mirroring Airtable's select colors), name (mono, links to url, target _blank rel noopener), claim (body text), install hint in a `--surface-2` code line with the text selectable, and an **APPLY** button (accent-filled, like OPEN GRAPH). Un-appliable (reducer InvalidEffectError, checked via dry-run try/catch) renders the button disabled with mono note "PATCH INVALID".
- Fixture: create `viewer/src/test/fixtures/enriched.workflow.json` — a small 6-node workflow with 2 valid suggestions + 1 structurally-broken one (for the disabled state), used by Tasks 4-5 tests. Must pass `validateWorkflow` except by design the broken effect passes schema but fails the reducer.

- [ ] Tests first: badge count renders only on nodes with suggestions; drawer lists suggestion name/claim/category; APPLY enabled/disabled per dry-run; url link has rel=noopener. Implement; commit `feat(viewer): suggestion badges and drawer cards with apply affordance`.

### Task 5: The magic moment — apply morph, impact meter, versions

**Files:** Modify `GraphCanvas.tsx`, `canvas.css`, `DetailDrawer.tsx`; tests extend `GraphCanvas.test.tsx`.

- GraphCanvas owns a `GraphSession` (Task 2). APPLY in the drawer → `applySuggestion` → new current workflow → re-run ELK → **FLIP**: before swap, snapshot each surviving node's screen position; after layout, set each RF node to its new position but apply a CSS class `.sg-node-shell--flip` with `transition: transform 480ms cubic-bezier(.2,.8,.2,1)` from inverted delta (standard FLIP: apply inverse transform, force reflow, remove). Removed/merged nodes: render 400ms ghosts (absolute overlay, scale .9 + fade to 0, `--ember` tint draining). replaceWith node: enters with the standard card entrance. Reduced-motion: instant swap.
- Impact meter: toolbar gains an accent-bordered chip cluster `data-testid="impact-meter"` — `-{stepsSaved} steps · -{estTimeSavedMin} min · -{estTokensSaved} tok` counting up with a 400ms numeric tween (reduced-motion: instant). Hidden at zero.
- Version strip: below toolbar left, chips `V0 V1 V2…` (mono; current = accent-filled; click = jump to that version — implement jump as reset+replay of appliedIds prefix, trivial with the pure reducer). UNDO button beside it (ghost style). All Signal-styled, no drafting words.
- Drawer stays open on the surviving node; if its node was consumed by the apply, drawer closes.
- Heat story: applying a suggestion that removes a hot node visibly extinguishes the ember glow (falls out naturally — assert it: post-apply, no `.sg-node--hot` for removed node's replacement unless replaceWith painLevel ≥4… fixture's replaceWith is pain 1).

- [ ] Tests first: APPLY on fixture → node count drops per effect, badge gone, impact meter shows summed metrics, version strip shows V0+V1, UNDO restores node count and hides meter, version-chip click jumps, applying the broken suggestion impossible (button disabled — covered T4). Implement; suites green; commit `feat(viewer): apply morph with FLIP, impact meter, version strip`.

### Task 6: Real enriched exemplar + final sweep

**Files:** Create `gallery/<new>.workflow.json` (controller supplies — see note), modify `README.md` (Phase 3 blurb: suggestions + interactivity), full verification.

- The controller (not you) generates the real enriched exemplar from Tahir's live Airtable and hands you the path; validate it (`npm run validate gallery/<file>`), confirm it renders with badges and a working APPLY end-to-end in a browser pass, screenshot.
- README: update "Try it" — mention clicking nodes for suggestions, dragging to reshape, AIRTABLE_API_KEY setup pointer to kb/airtable-template.md.
- Sweep: viewer suite green (report exact), root 19/19, build clean, headless-Chrome pass over: interactive drag (drag a node 200px — edges follow, lanes recompute), click→drawer→APPLY→morph→undo cycle, reduced-motion. Screenshots in report.
- [ ] Commit `feat: Phase 3 exemplar + docs — suggestions live end-to-end`.

## Verification (exit criteria for Tahir)

1. Drag any node — edges and return lanes follow live; RESET LAYOUT restores.
2. Click a node — drawer with description; on matched nodes, suggestion cards with category colors and install hints.
3. APPLY — graph morphs (FLIP), ember cools, impact meter counts, V1 appears; UNDO/V0 restores.
4. `/graph-my-task` with `AIRTABLE_API_KEY` set produces a graph whose suggestions reference only real Airtable rows.
5. Suites green (root 19 + viewer ≥55+new), build clean, reduced-motion clean.

## Appendix — Tahir's daily-scan prompt extension (his scheduled task, outside this repo)

Add to the scheduled trending-scan prompt, after the existing capture instructions:

> For every row you create or update in Trending Repos, also fill the enrichment fields:
> - **Capability Tags**: pick 1–4 existing options that describe what the resource is good at (create a new option only if nothing fits).
> - **Step Archetypes**: which workflow-step types it upgrades — research, scaffold, code, test, browser-verify, deploy, document, data-etl, review, orchestrate.
> - **Improvement Claim**: one plain-words line: what does this make dramatically better or eliminate?
> - **Install**: the one-line install command if evident from the README (e.g. `claude mcp add …`, `/plugin install …`); leave blank if unknown.
