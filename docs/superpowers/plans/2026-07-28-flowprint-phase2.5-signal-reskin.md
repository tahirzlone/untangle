# Flowprint Phase 2.5 — Signal Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rejected blueprint/drafting aesthetic with the Tahir-approved "Signal" theme — dark pro-dev-tool with lime signature glow, ember pain heat, horizontal left→right flow, n8n-style ported info cards — without touching the engine (schema, validator, skill, CLI).

**Architecture:** Same stack, new skin + flow direction. ELK switches to `RIGHT`; node ports move to left/right; edges become React Flow beziers between real ports (dropping the ELK bend-point plumbing); all drafting chrome (sheet frame, zone rulers, title block, paper tags) is deleted and replaced by a toolbar strip, dot-grid canvas, and chip-styled edge labels. **The approved mock `design/theme-variants.html` (VARIANT C — SIGNAL LIME) is the canonical visual spec** — when this plan and the mock disagree on a visual value, the mock wins.

**Tech Stack:** unchanged (Vite/React/TS, @xyflow/react, elkjs, vitest) + fonts swap to @fontsource/space-grotesk + @fontsource/jetbrains-mono (Barlow Condensed and IBM Plex Mono imports removed).

## Global Constraints

- Branch: continue on `feat/viewer-core` (Phase 2 is unmerged; the re-skin amends it before Tahir's approval gate).
- **Engine frozen**: nothing under `schema/`, `scripts/`, `.claude/`, `gallery/`, `tests/` (root) may change. Root suite stays 19/19.
- **Design feedback is LAW** (Tahir, 2026-07-28): techie/modern/futuristic, horizontal LR flow, no drafting/paper/stamp metaphors anywhere — including copy (no "drawing", "plotting", "sheet" language in user-facing text; use "graph", "compiling", "canvas").
- Tokens LAW continues: all colors/type via `tokens.css` custom properties; zero hex outside it.
- `prefers-reduced-motion: reduce` disables all animation.
- Keep: edge draw-in energy (re-themed), gallery card index (re-themed), themed error state (re-themed), KB NOT LINKED indicator, info-rich cards, pain glow+meter. Kill: kind shapes (uniform cards + kind badge), title block/REV, zone rulers, paper grid.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Windows/PowerShell commands.

## New Token System (Task 1 writes exactly this into tokens.css)

```css
:root {
  /* Signal palette — from approved mock VARIANT C */
  --bg: #0B0E14;
  --bg-deep: #06080D;
  --surface: #131721;
  --surface-2: #1A1F2E;
  --line: #232A3B;
  --text: #E6EAF2;
  --dim: #8A93A6;
  --accent: #A3E635;
  --accent-soft: rgba(163, 230, 53, 0.13);
  --ember: #F97316;
  --ember-hot: #EF4444;

  /* type */
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-anno: "JetBrains Mono", ui-monospace, Consolas, monospace;
  --font-body: system-ui, "Segoe UI", sans-serif;

  /* geometry */
  --radius-card: 12px;
  --radius-chip: 999px;

  /* motion */
  --flow-dur: 0.6s;
  --flow-stagger: 0.1s;
  --card-in-dur: 0.3s;
}
```

Pain rule (uniform across components): painLevel 5 = `--hot` treatment (ember-hot meter segments w/ glow, ember border mix, 34px ember outer glow); 4 = `--warm` (ember meter, soft ember glow); 3 = ember meter only; 1–2 = accent-tinted meter. Node icon chips use accent normally, ember on hot/warm nodes (mock shows both states).

## File Structure (change map)

```
viewer/src/
├── tokens.css                REPLACED (Signal system above)
├── main.tsx                  font imports swapped (space-grotesk 500/600/700, jetbrains-mono 400/500/400-italic)
├── app.css                   masthead re-skinned dark
├── graph/
│   ├── layout.ts             direction RIGHT; NODE_WIDTH=252, NODE_HEIGHT=148; spacing tuned LR
│   └── path.ts               UNCHANGED (labelAnchor/wrapLabel kept; pointsToPath/midpointOf may become test-only)
├── components/
│   ├── BlueprintNode.tsx     → SignalNode.tsx (card per mock: icon chip, label, desc, kind badge, PainMeter; Handles Left/Right; size from layout constants via inline style — kills the CSS/TS duplication)
│   ├── node.css              REPLACED per mock
│   ├── PlotterEdge.tsx       → SignalEdge.tsx (RF getBezierPath from port coords; EdgeTag at labelX/labelY; retry = dashed ember; draw-in + flow-dot energy)
│   ├── edge.css              REPLACED
│   ├── BlueprintSheet.tsx    → GraphCanvas.tsx (toolbar strip replaces TitleBlock/ZoneRuler — both files DELETED; dot-grid + accent-bloom background; "COMPILING GRAPH…" loading state)
│   ├── sheet.css             → canvas.css
│   ├── GalleryIndex.tsx      re-skin only (structure kept; dashboard cards, lime accents, pain dots ember)
│   ├── RejectedSheet.tsx     → diagnostic panel: "GRAPH REJECTED — failed validation", mono error list, no rotate/stamp
│   └── gallery.css           re-skinned
└── (tests updated alongside each component)
design/theme-variants.html    committed as the design record
```

---

### Task 1: Tokens, fonts, layout direction

**Files:** Modify `viewer/src/tokens.css` (replace with block above), `viewer/src/main.tsx` (imports: `@fontsource/space-grotesk/500.css|600.css|700.css`, `@fontsource/jetbrains-mono/400.css|500.css|400-italic.css`; remove barlow/plex-mono), `viewer/package.json` (swap font deps), `viewer/src/graph/layout.ts`, `viewer/src/graph/layout.test.ts`, `viewer/src/app.css` (dark masthead: `--bg-deep` background, `--line` border, accent logo mark), commit `design/theme-variants.html`.

**Interfaces:** `layoutWorkflow` signature unchanged. New constants stay `NODE_WIDTH = 252`, `NODE_HEIGHT = 148`. Layout options become:

```ts
'elk.algorithm': 'layered',
'elk.direction': 'RIGHT',
'elk.edgeRouting': 'SPLINES',
'elk.layered.spacing.nodeNodeBetweenLayers': '90',
'elk.spacing.nodeNode': '56',
```

(Edge sections are no longer consumed — SignalEdge uses port beziers — but keep returning `points` so the adapter API is stable.)

- [ ] Update `layout.test.ts` third test: replace `input.y < output.y` with `input.x < output.x` (flow is now LR). Run: fails. Apply layout change. Run: viewer suite green except any skin-coupled tests (note them). Root 19/19. Commit `feat(viewer): Signal tokens, fonts, left-to-right flow`.

### Task 2: SignalNode

**Files:** Rename/rewrite `BlueprintNode.tsx` → `SignalNode.tsx` + `node.css`; rewrite `BlueprintNode.test.tsx` → `SignalNode.test.tsx`.

Card per mock: head row (30px icon chip with 2-letter kind abbr — IN/PR/DC/LP/RV/OUT; label 13.5px Space Grotesk 600), desc (11px `--dim`, 3-line clamp), foot row (kind badge mono 9px uppercase letterspaced + `PainMeter`). Shell: `style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}` imported from layout.ts (single source of truth). Handles: `Position.Left` (target) / `Position.Right` (source), styled as 10px port rings (`--accent` border on `--bg`), visible (ports are part of the n8n look — no longer hidden). Pain treatments per Global rule (`node--hot`, `node--warm` classes). Card entrance: fade+slide-from-left stagger via `--i`, reduced-motion off.

- [ ] Tests (adapt existing 4): label renders; `data-kind`/`data-pain` attrs; meter has 5 segments with `data-pain` on container; pain-5 card has `node--hot` class; icon chip shows abbr; NO shape-variant classes remain. TDD, then commit `feat(viewer): Signal node cards with pain glow and meter`.

### Task 3: SignalEdge

**Files:** Rename/rewrite `PlotterEdge.tsx` → `SignalEdge.tsx` + `edge.css`; tests likewise.

Use RF's `getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })` — real port coords now exist (declared dimensions + left/right handles). `BaseEdge`-free custom `<path>` keeps `pathLength={1}` draw-in (re-themed: stroke `--accent` at 0.75 opacity; retry: `--ember`, `stroke-dasharray` normalized units as today). Add the **flow-dot**: an SVG `<circle r="3">` with `<animateMotion>` along the same path (sequence edges only, `--accent`, 3.2s loop; reduced-motion: not rendered — check via `window.matchMedia('(prefers-reduced-motion: reduce)')`). EdgeTag stays (HTML above nodes) restyled as chip per mock (`--radius-chip`... actually 6px radius, mono italic 9.5px, ember text/border for retry, `--dim`/`--line` for others), positioned at `labelX/labelY` from `getBezierPath` (drop `labelAnchor` usage; `wrapLabel` kept for >24-char labels rendering as stacked spans).

- [ ] Tests: bezier path rendered with `d` attribute non-empty; retry class + ember styling class; EdgeTag chip classes; long-label wrap still ≥2 spans; flow-dot absent when reduced-motion matchMedia mocked true (setup.ts's matchMedia stub returns false → dot present by default; add one test flipping the stub). TDD, then commit `feat(viewer): Signal bezier edges with flow-dot energy and chip labels`.

### Task 4: GraphCanvas (chrome swap)

**Files:** `BlueprintSheet.tsx` → `GraphCanvas.tsx` + `sheet.css` → `canvas.css`; DELETE `TitleBlock.tsx`, `ZoneRuler.tsx`; rewrite `BlueprintSheet.test.tsx` → `GraphCanvas.test.tsx`.

Canvas: dot-grid + accent bloom background per mock (`radial-gradient` dot 26px pitch + ellipse `--accent-soft` bloom at top-left), no frame/rulers. **Toolbar strip** (52px, blurred `--bg` at 82%, bottom `--line` border): workflow title (Space Grotesk 600 14px), chips: `<b>{n}</b> nodes`, `max pain ●×maxPain` (ember dots), `KB NOT LINKED` / `AIRTABLE`, right-aligned `generated by <b>{model}</b>`. Loading state: `COMPILING GRAPH…` mono, centered, with a subtle accent pulse. `#fp-arrow` marker: keep mechanism, restyle chevron `context-stroke` (unchanged markup OK). RF config unchanged (locked-down, fitView padding 0.12 — the reserved title-block band is removed since the toolbar is a top strip; `.bp-canvas` inset becomes `52px 0 0 0`).

- [ ] Tests: renders all nodes (waitFor), toolbar shows title + `KB NOT LINKED` + node count chip, no TitleBlock/ZoneRuler testids remain anywhere in src. TDD, then commit `feat(viewer): graph canvas with toolbar chrome replacing drafting sheet`.

### Task 5: Gallery, error state, app polish, sweep

**Files:** `GalleryIndex.tsx`/`gallery.css` (dashboard cards: `--surface` on `--bg-deep`, accent hover ring, ember pain dots ●●●●●, OPEN GRAPH button accent-filled dark-text; drop card dashed `--line` with accent focus ring — keep a11y overlay), `RejectedSheet.tsx` (diagnostic panel: mono header `GRAPH REJECTED — FAILED VALIDATION`, error list in `--surface-2` code-block style, `BACK TO GRAPHS` button; no rotation/stamp), `App.tsx`/`App.test.tsx` (copy: "drawing index" → "graph index"; drop-hint copy loses "drawing"), `README.md` + `viewer/README.md` (blueprint wording → Signal/graph wording).

- [ ] Update tests asserting old copy ("DRAWING REJECTED" → "GRAPH REJECTED", "OPEN DRAWING" → "OPEN GRAPH", masthead link text). Full sweep: viewer suite green (report exact count), root 19/19, `npm run build:viewer` clean, then a **screenshot pass in headless Chrome at 1600×1000 + 1100×700 against the mock for visual parity** (reviewer gate). Commit `feat(viewer): Signal gallery, diagnostic error panel, copy sweep`.

## Exit criteria (Tahir's re-review)

1. `npm run dev:viewer` → dark Signal graph index, lime accents.
2. Open the e2e graph: flows **left→right**, ported cards, flow-dots running, pain-4/5 glowing ember, retry edges dashed ember with chip labels, toolbar with KB NOT LINKED.
3. Drop `out/comic-story-webpage.workflow.json` → renders in the new theme (compare against the approved mock).
4. Broken JSON → diagnostic GRAPH REJECTED panel.
5. Reduced-motion: static render, no flow-dots.
6. Suites green; build clean; zero drafting-language copy anywhere.

## Verification notes

- Per-task reviewers MUST render in headless Chrome and compare against `design/theme-variants.html` VARIANT C — it is the approved spec.
- Watch seams: `getBezierPath` needs RF-computed port coords — the declared `width/height/handles` from the P2 fix (`BlueprintSheet` node mapping) must move to GraphCanvas intact, with `Position.Left/Right`.
- `labelAnchor`/`pointsToPath`/`midpointOf` may become unreferenced by production code — if so, delete them AND their tests in Task 3 (do not keep dead exports; note in report).
