# Flowprint Phase 2 — Viewer Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + React static SPA in `viewer/` that renders `*.workflow.json` files as blueprint drafting sheets — gallery index, ELK-laid-out graph with complexity heat, plotter-pen edge animation, title block, file-drop loader, and an on-theme rejection sheet.

**Architecture:** The viewer is a pure client of the Phase-1 contract. Validation logic is refactored into a platform-neutral module (`scripts/validate-pure.mjs`) consumed by both the Node CLI and the browser. ELK computes layered orthogonal layouts; React Flow renders custom blueprint nodes/edges at ELK positions (dragging disabled — the sheet is authoritative). All chrome (frame, zone rulers, title block) is overlay; the canvas pans/zooms beneath it.

**Tech Stack:** Vite ^6, React ^19, TypeScript ~5.8, @xyflow/react ^12.4, elkjs ^0.10 (bundled, no worker), ajv (shared with root), vitest + @testing-library/react + jsdom, @fontsource/barlow-condensed + @fontsource/ibm-plex-mono (self-hosted fonts, no runtime fetches).

## Global Constraints

- Repo: `C:\dev\flowprint`. The viewer lives in `viewer/` as its own npm package; root package stays as-is except where Task 2 and Task 8 say.
- **Phase-1 contract is frozen**: `schema/workflow.schema.json` and the CLI's OK/REJECTED behavior must not change. Root suite (19 tests) must stay green after every task.
- **No data-gathering/sync scripts.** Nothing fetches Airtable or the network at runtime; fonts are npm-vendored; the built site is fully static (GH Pages-ready, `base: './'`).
- **Suggestions UI is Phase 3.** `suggestions` arrays are ignored by the viewer in this phase (they're `[]` in all current files).
- `prefers-reduced-motion: reduce` must disable all plotting/stamp animations (final state shown immediately).
- Design tokens are LAW (Task 1). No hex values outside `tokens.css`; components use `var(--…)` only.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Windows environment: PowerShell-compatible commands (`cd viewer; npm test` style, no bash-isms).
- Library-version note: dependency majors are pinned below; if npm resolution or a lib API differs from the code shown, adapt minimally and record the deviation in your report — do not switch libraries.

## Design Tokens (authoritative reference)

Palette (real drafting-room vernacular — vellum, non-photo blue pencil, Prussian ink, checker's red):

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FAFAF7` | vellum sheet |
| `--paper-shade` | `#F0F0EA` | page background behind sheet |
| `--blue-nonphoto` | `#9EC9E4` | grid lines, construction marks |
| `--ink` | `#1D3A5C` | primary linework, node borders, edges |
| `--ink-strong` | `#16293F` | display type, frame rules |
| `--graphite` | `#5B6B7A` | secondary annotations, descriptions |
| `--red-checker` | `#C4372B` | pain heat, retry edges, rejection stamp |

Type: `--font-display: "Barlow Condensed", "Arial Narrow", sans-serif` (uppercase, tracked) for titles/labels; `--font-anno: "IBM Plex Mono", ui-monospace, Consolas, monospace` for annotations/data; `--font-body: system-ui, "Segoe UI", sans-serif` for descriptions.

Heat: painLevel n → node wash `color-mix(in srgb, var(--red-checker) calc(n * 9%), transparent)` capped at painLevel 5 = 45%, plus n red tally strokes in the node's corner.

## File Structure

```
viewer/
├── package.json, vite.config.ts, tsconfig.json, index.html
├── src/
│   ├── main.tsx, App.tsx, app.css
│   ├── tokens.css                      # ALL design tokens (Task 1)
│   ├── test/setup.ts                   # jsdom polyfills for React Flow (Task 1)
│   ├── types/validate-pure.d.ts        # TS face of the shared validator (Task 2)
│   ├── graph/
│   │   ├── types.ts                    # Workflow/WorkflowNode/... mirroring the schema (Task 2)
│   │   ├── load.ts                     # loadWorkflow() via shared validator (Task 2)
│   │   ├── layout.ts                   # layoutWorkflow() ELK adapter (Task 3)
│   │   └── path.ts                     # pointsToPath() (Task 5)
│   ├── components/
│   │   ├── BlueprintNode.tsx + node.css       (Task 4)
│   │   ├── PlotterEdge.tsx + edge.css         (Task 5)
│   │   ├── BlueprintSheet.tsx, TitleBlock.tsx, ZoneRuler.tsx + sheet.css  (Task 6)
│   │   ├── GalleryIndex.tsx + gallery.css     (Task 7)
│   │   └── RejectedSheet.tsx                  (Task 7)
│   └── gallery/galleryData.ts          # import.meta.glob of ../../gallery (Task 7)
scripts/validate-pure.mjs               # NEW: platform-neutral validator (Task 2)
scripts/validate-core.mjs               # THINNED: node fs wrapper (Task 2)
```

---

### Task 1: Viewer scaffold, tokens, test rig

**Files:**
- Create: `viewer/package.json`, `viewer/vite.config.ts`, `viewer/tsconfig.json`, `viewer/index.html`, `viewer/src/main.tsx`, `viewer/src/App.tsx`, `viewer/src/app.css`, `viewer/src/tokens.css`, `viewer/src/test/setup.ts`, `viewer/src/App.test.tsx`

**Interfaces:**
- Produces: a running Vite app (`cd viewer; npm run dev`), `npm test` (vitest/jsdom with React Flow polyfills), and the token system every later task consumes.

- [ ] **Step 1: Write `viewer/package.json`**

```json
{
  "name": "flowprint-viewer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@fontsource/barlow-condensed": "^5.2.0",
    "@fontsource/ibm-plex-mono": "^5.2.0",
    "@xyflow/react": "^12.4.0",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "elkjs": "^0.10.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.5.0",
    "jsdom": "^26.1.0",
    "typescript": "~5.8.0",
    "vite": "^6.3.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Write `viewer/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
});
```

(If `tsc` complains about the `test` key, add `/// <reference types="vitest/config" />` at the top.)

- [ ] **Step 3: Write `viewer/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowJs": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "../scripts/validate-pure.mjs"]
}
```

- [ ] **Step 4: Write `viewer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flowprint — Drawing Index</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `viewer/src/tokens.css`** (the complete token system — all later CSS uses only these)

```css
:root {
  /* drafting-room palette */
  --paper: #FAFAF7;
  --paper-shade: #F0F0EA;
  --blue-nonphoto: #9EC9E4;
  --ink: #1D3A5C;
  --ink-strong: #16293F;
  --graphite: #5B6B7A;
  --red-checker: #C4372B;

  /* type */
  --font-display: "Barlow Condensed", "Arial Narrow", sans-serif;
  --font-anno: "IBM Plex Mono", ui-monospace, Consolas, monospace;
  --font-body: system-ui, "Segoe UI", sans-serif;
  --track-caps: 0.08em;

  /* rules & weights */
  --rule-hair: 1px;
  --rule-pen: 1.5px;
  --rule-frame: 2px;

  /* motion */
  --plot-edge-dur: 0.6s;
  --plot-edge-stagger: 0.12s;
  --stamp-dur: 0.28s;

  /* grid */
  --grid-minor: 8px;
  --grid-major: 64px;
}
```

- [ ] **Step 6: Write `viewer/src/app.css`**

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--paper-shade);
  color: var(--ink-strong);
  font-family: var(--font-body);
}
.app-shell { height: 100%; display: flex; flex-direction: column; }
.app-masthead {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 20px;
  letter-spacing: var(--track-caps);
  text-transform: uppercase;
  color: var(--ink-strong);
  padding: 12px 20px;
  border-bottom: var(--rule-frame) solid var(--ink-strong);
  background: var(--paper);
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.app-masthead .masthead-sub {
  font-family: var(--font-anno);
  font-size: 11px;
  color: var(--graphite);
  text-transform: none;
  letter-spacing: 0;
}
.app-main { flex: 1; min-height: 0; position: relative; }
```

- [ ] **Step 7: Write `viewer/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './tokens.css';
import './app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Write placeholder `viewer/src/App.tsx`** (Task 7 replaces this)

```tsx
export default function App() {
  return (
    <div className="app-shell">
      <header className="app-masthead">
        Flowprint <span className="masthead-sub">drawing index</span>
      </header>
      <main className="app-main" />
    </div>
  );
}
```

- [ ] **Step 9: Write `viewer/src/test/setup.ts`** (React Flow needs these in jsdom — later tasks break without them)

```ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;

if (!window.matchMedia) {
  (window as any).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!(window as any).DOMMatrixReadOnly) {
  (window as any).DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(_transform?: string) {}
  };
}
```

- [ ] **Step 10: Write the failing smoke test** `viewer/src/App.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the drawing-index masthead', () => {
  render(<App />);
  expect(screen.getByText(/flowprint/i)).toBeInTheDocument();
  expect(screen.getByText(/drawing index/i)).toBeInTheDocument();
});
```

- [ ] **Step 11: Install and run** — `cd viewer; npm install; npm test` → 1 test PASS. Then `npm run build` → succeeds. Then run root suite from repo root: `npm test` → 19/19 still green.

- [ ] **Step 12: Commit**

```powershell
git add viewer; git commit -m "feat(viewer): scaffold Vite+React viewer with drafting design tokens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared validator refactor + typed loader

**Files:**
- Create: `scripts/validate-pure.mjs`, `viewer/src/types/validate-pure.d.ts`, `viewer/src/graph/types.ts`, `viewer/src/graph/load.ts`, `viewer/src/graph/load.test.ts`
- Modify: `scripts/validate-core.mjs` (thin to a Node wrapper)

**Interfaces:**
- Consumes: `schema/workflow.schema.json` (frozen), existing root tests.
- Produces: `createValidator(schema) → (doc) => { valid, errors }` from `scripts/validate-pure.mjs` (platform-neutral, no `node:` imports); `loadWorkflow(raw: unknown): LoadResult` and the `Workflow` types every later task uses.

- [ ] **Step 1: Write `scripts/validate-pure.mjs`** — move ALL logic out of validate-core, parameterizing the schema (this file must not import `node:fs`):

```js
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function createValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);

  return function validateWorkflow(doc) {
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
  };
}
```

- [ ] **Step 2: Thin `scripts/validate-core.mjs`** to exactly:

```js
import { readFileSync } from 'node:fs';
import { createValidator } from './validate-pure.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../schema/workflow.schema.json', import.meta.url), 'utf8')
);

export const validateWorkflow = createValidator(schema);
```

- [ ] **Step 3: Run root suite to prove the refactor is invisible** — from repo root: `npm test` → 19/19 PASS (these tests import `validateWorkflow` from validate-core and exercise the CLI; zero test edits allowed).

- [ ] **Step 4: Write `viewer/src/types/validate-pure.d.ts`**

```ts
declare module '../../../scripts/validate-pure.mjs' {
  export interface ValidationResult {
    valid: boolean;
    errors: string[];
  }
  export function createValidator(schema: object): (doc: unknown) => ValidationResult;
}
```

- [ ] **Step 5: Write `viewer/src/graph/types.ts`**

```ts
export type NodeKind = 'input' | 'process' | 'decision' | 'loop' | 'review' | 'output';
export type EdgeKind = 'sequence' | 'branch' | 'retry';

export interface WorkflowNode {
  id: string;
  label: string;
  kind: NodeKind;
  description: string;
  painLevel: 1 | 2 | 3 | 4 | 5;
  lane?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
}

export interface WorkflowMeta {
  task: string;
  title: string;
  generatedAt: string;
  model: string;
  kbSource: 'airtable' | 'none';
}

export interface Workflow {
  meta: WorkflowMeta;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  suggestions: unknown[];
}

export type LoadResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; errors: string[] };
```

- [ ] **Step 6: Write the failing tests** `viewer/src/graph/load.test.ts`

```ts
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from './load';

it('loads the committed gallery workflow', () => {
  const res = loadWorkflow(gallery);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.workflow.meta.title).toBeTruthy();
    expect(res.workflow.nodes.length).toBeGreaterThanOrEqual(3);
  }
});

it('rejects garbage with error strings', () => {
  const res = loadWorkflow({ meta: {} });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toMatch(/schema:/);
  }
});

it('rejects non-object input without throwing', () => {
  expect(loadWorkflow('not json at all').ok).toBe(false);
  expect(loadWorkflow(null).ok).toBe(false);
});
```

- [ ] **Step 7: Run to verify FAIL** — `cd viewer; npm test` → cannot resolve `./load`.

- [ ] **Step 8: Write `viewer/src/graph/load.ts`**

```ts
import schema from '../../../schema/workflow.schema.json';
import { createValidator } from '../../../scripts/validate-pure.mjs';
import type { LoadResult, Workflow } from './types';

const validate = createValidator(schema);

export function loadWorkflow(raw: unknown): LoadResult {
  const { valid, errors } = validate(raw);
  if (!valid) return { ok: false, errors };
  return { ok: true, workflow: raw as Workflow };
}
```

- [ ] **Step 9: Run to verify PASS** — `cd viewer; npm test` → 4 tests PASS (1 app + 3 load). Then root `npm test` → 19/19.

- [ ] **Step 10: Commit**

```powershell
git add scripts viewer; git commit -m "refactor: platform-neutral validator shared by CLI and viewer, typed loadWorkflow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ELK layout adapter

**Files:**
- Create: `viewer/src/graph/layout.ts`, `viewer/src/graph/layout.test.ts`

**Interfaces:**
- Consumes: `Workflow` from `./types` (Task 2).
- Produces: `layoutWorkflow(workflow: Workflow): Promise<LaidOutGraph>` with

```ts
export interface LaidOutNode { id: string; x: number; y: number; width: number; height: number; node: WorkflowNode; }
export interface LaidOutEdge { id: string; from: string; to: string; kind: EdgeKind; label?: string; points: { x: number; y: number }[]; }
export interface LaidOutGraph { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number; }
```

Tasks 5–6 rely on these exact names.

- [ ] **Step 1: Write the failing tests** `viewer/src/graph/layout.test.ts`

```ts
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from './load';
import { layoutWorkflow } from './layout';

async function laidOutGallery() {
  const res = loadWorkflow(gallery);
  if (!res.ok) throw new Error('fixture invalid');
  return layoutWorkflow(res.workflow);
}

it('positions every node with finite coordinates', async () => {
  const g = await laidOutGallery();
  expect(g.nodes).toHaveLength((gallery as any).nodes.length);
  for (const n of g.nodes) {
    expect(Number.isFinite(n.x)).toBe(true);
    expect(Number.isFinite(n.y)).toBe(true);
    expect(n.width).toBeGreaterThan(0);
    expect(n.height).toBeGreaterThan(0);
  }
  expect(g.width).toBeGreaterThan(0);
  expect(g.height).toBeGreaterThan(0);
});

it('routes every edge with at least two points', async () => {
  const g = await laidOutGallery();
  expect(g.edges).toHaveLength((gallery as any).edges.length);
  for (const e of g.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    for (const p of e.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  }
});

it('flows top-down: the input node sits above the output node', async () => {
  const g = await laidOutGallery();
  const input = g.nodes.find((n) => n.node.kind === 'input')!;
  const output = g.nodes.find((n) => n.node.kind === 'output')!;
  expect(input.y).toBeLessThan(output.y);
});

it('preserves edge kind and label through layout', async () => {
  const g = await laidOutGallery();
  const retry = g.edges.filter((e) => e.kind === 'retry');
  expect(retry.length).toBeGreaterThan(0);
  expect(retry.every((e) => typeof e.label === 'string' && e.label.length > 0)).toBe(true);
});
```

- [ ] **Step 2: Run to verify FAIL** — `cd viewer; npm test` → cannot resolve `./layout`.

- [ ] **Step 3: Write `viewer/src/graph/layout.ts`**

```ts
import ELK from 'elkjs/lib/elk.bundled.js';
import type { EdgeKind, Workflow, WorkflowNode } from './types';

export interface LaidOutNode { id: string; x: number; y: number; width: number; height: number; node: WorkflowNode; }
export interface LaidOutEdge { id: string; from: string; to: string; kind: EdgeKind; label?: string; points: { x: number; y: number }[]; }
export interface LaidOutGraph { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number; }

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 112;

const elk = new ELK();

export async function layoutWorkflow(workflow: Workflow): Promise<LaidOutGraph> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '48',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
    },
    children: workflow.nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: workflow.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
    })),
  };

  const res = await elk.layout(graph);

  const nodes: LaidOutNode[] = (res.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? NODE_WIDTH,
    height: c.height ?? NODE_HEIGHT,
    node: workflow.nodes.find((n) => n.id === c.id)!,
  }));

  const edges: LaidOutEdge[] = (res.edges ?? []).map((e, i) => {
    const src = workflow.edges[i];
    const section = (e as any).sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return {
      id: e.id,
      from: src.from,
      to: src.to,
      kind: src.kind,
      label: src.label,
      points: points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
    };
  });

  return { nodes, edges, width: res.width ?? 0, height: res.height ?? 0 };
}
```

(Note: ELK returns `res.edges` in input order, so indexing back into `workflow.edges` by `i` is safe — the edge ids `e${i}` encode it anyway.)

- [ ] **Step 4: Run to verify PASS** — `cd viewer; npm test` → 8 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add viewer/src/graph; git commit -m "feat(viewer): ELK layered layout adapter with orthogonal edge routing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: BlueprintNode — kinds, heat, tally strokes

**Files:**
- Create: `viewer/src/components/BlueprintNode.tsx`, `viewer/src/components/node.css`, `viewer/src/components/BlueprintNode.test.tsx`

**Interfaces:**
- Consumes: `WorkflowNode` type.
- Produces: React Flow custom node component registered as type `'blueprint'`; expects RF node `data` = `{ node: WorkflowNode; index: number }`. Exposes `data-kind` and `data-pain` attributes (tests and Phase 3 both key on these).

- [ ] **Step 1: Write the failing tests** `viewer/src/components/BlueprintNode.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { BlueprintNodeBody } from './BlueprintNode';
import type { WorkflowNode } from '../graph/types';

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: 'test-node',
  label: 'Debug flaky selectors',
  kind: 'process',
  description: 'Chase timing-dependent failures.',
  painLevel: 4,
  ...over,
});

it('renders label, kind eyebrow, and pain attributes', () => {
  render(<BlueprintNodeBody node={node()} />);
  expect(screen.getByText('Debug flaky selectors')).toBeInTheDocument();
  expect(screen.getByText('PROC')).toBeInTheDocument();
  const el = screen.getByTestId('bp-node');
  expect(el).toHaveAttribute('data-kind', 'process');
  expect(el).toHaveAttribute('data-pain', '4');
});

it('renders one tally stroke per pain level', () => {
  render(<BlueprintNodeBody node={node({ painLevel: 5 })} />);
  expect(screen.getAllByTestId('pain-tick')).toHaveLength(5);
});

it('marks decision nodes with the diamond modifier', () => {
  render(<BlueprintNodeBody node={node({ kind: 'decision' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--decision');
  expect(screen.getByText('DEC')).toBeInTheDocument();
});

it('uses terminal styling for input and output', () => {
  const { rerender } = render(<BlueprintNodeBody node={node({ kind: 'input' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--input');
  rerender(<BlueprintNodeBody node={node({ kind: 'output' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--output');
});
```

- [ ] **Step 2: Run to verify FAIL** — cannot resolve `./BlueprintNode`.

- [ ] **Step 3: Write `viewer/src/components/BlueprintNode.tsx`**

```tsx
import { Handle, Position } from '@xyflow/react';
import type { WorkflowNode } from '../graph/types';
import './node.css';

const KIND_ABBR: Record<WorkflowNode['kind'], string> = {
  input: 'IN',
  process: 'PROC',
  decision: 'DEC',
  loop: 'LOOP',
  review: 'REVW',
  output: 'OUT',
};

export function BlueprintNodeBody({ node }: { node: WorkflowNode }) {
  return (
    <div
      className={`bp-node bp-node--${node.kind}`}
      data-testid="bp-node"
      data-kind={node.kind}
      data-pain={node.painLevel}
      style={{ ['--pain' as string]: node.painLevel }}
      title={node.description}
    >
      <div className="bp-node-eyebrow">
        <span className="bp-node-kind">{KIND_ABBR[node.kind]}</span>
        <span className="bp-node-ticks" aria-label={`pain level ${node.painLevel} of 5`}>
          {Array.from({ length: node.painLevel }, (_, i) => (
            <i key={i} className="pain-tick" data-testid="pain-tick" />
          ))}
        </span>
      </div>
      <div className="bp-node-label">{node.label}</div>
      <div className="bp-node-desc">{node.description}</div>
    </div>
  );
}

export function BlueprintNode({ data }: { data: { node: WorkflowNode; index: number } }) {
  return (
    <div className="bp-node-shell" style={{ ['--i' as string]: data.index }}>
      <Handle type="target" position={Position.Top} className="bp-handle" />
      <BlueprintNodeBody node={data.node} />
      <Handle type="source" position={Position.Bottom} className="bp-handle" />
    </div>
  );
}
```

- [ ] **Step 4: Write `viewer/src/components/node.css`**

```css
.bp-node-shell {
  width: 248px;
  height: 112px;
  animation: bp-stamp var(--stamp-dur) ease-out backwards;
  animation-delay: calc(0.9s + var(--i, 0) * 0.06s);
}
.bp-handle { opacity: 0; pointer-events: none; }

.bp-node {
  width: 100%;
  height: 100%;
  background:
    linear-gradient(color-mix(in srgb, var(--red-checker) calc(var(--pain, 1) * 9%), transparent),
                    color-mix(in srgb, var(--red-checker) calc(var(--pain, 1) * 9%), transparent)),
    var(--paper);
  border: var(--rule-pen) solid var(--ink);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.bp-node-eyebrow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-anno);
  font-size: 9px;
  color: var(--graphite);
}
.bp-node-kind { letter-spacing: var(--track-caps); }
.bp-node-ticks { display: inline-flex; gap: 2px; }
.pain-tick {
  display: inline-block;
  width: 2px;
  height: 9px;
  background: var(--red-checker);
  transform: skewX(-24deg);
}

.bp-node-label {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.1;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-strong);
}
.bp-node-desc {
  font-family: var(--font-body);
  font-size: 10px;
  line-height: 1.3;
  color: var(--graphite);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* kind variants — structure is information */
.bp-node--input, .bp-node--output { border-radius: 56px; text-align: center; align-items: center; }
.bp-node--output { background: var(--ink-strong); }
.bp-node--output .bp-node-label { color: var(--paper); }
.bp-node--output .bp-node-desc, .bp-node--output .bp-node-kind { color: var(--blue-nonphoto); }
.bp-node--decision {
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  justify-content: center;
  text-align: center;
  align-items: center;
  padding: 14px 34px;
}
.bp-node--decision .bp-node-desc { display: none; }
.bp-node--loop { border-style: double; border-width: 4px; }
.bp-node--review { border-style: dashed; }

@keyframes bp-stamp {
  from { opacity: 0; transform: scale(1.12) rotate(-1deg); }
  to { opacity: 1; transform: scale(1) rotate(0); }
}
@media (prefers-reduced-motion: reduce) {
  .bp-node-shell { animation: none; }
}
```

- [ ] **Step 5: Run to verify PASS** — `cd viewer; npm test` → 12 tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add viewer/src/components; git commit -m "feat(viewer): blueprint node — kind shapes, checker-red heat, pain tally strokes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: PlotterEdge — orthogonal path + draw-on animation

**Files:**
- Create: `viewer/src/graph/path.ts`, `viewer/src/graph/path.test.ts`, `viewer/src/components/PlotterEdge.tsx`, `viewer/src/components/edge.css`, `viewer/src/components/PlotterEdge.test.tsx`

**Interfaces:**
- Consumes: `LaidOutEdge` points (Task 3).
- Produces: `pointsToPath(points: {x:number;y:number}[]): string`; React Flow custom edge type `'plotter'` expecting RF edge `data` = `{ points; kind; label?; index: number }`.

- [ ] **Step 1: Write the failing path tests** `viewer/src/graph/path.test.ts`

```ts
import { pointsToPath } from './path';

it('builds an SVG path visiting every point', () => {
  const d = pointsToPath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }]);
  expect(d).toBe('M 0 0 L 0 40 L 80 40');
});

it('returns empty string for fewer than two points', () => {
  expect(pointsToPath([])).toBe('');
  expect(pointsToPath([{ x: 1, y: 1 }])).toBe('');
});
```

- [ ] **Step 2: Run to verify FAIL**, then **Step 3: Write `viewer/src/graph/path.ts`**

```ts
export function pointsToPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  const [head, ...rest] = points;
  return `M ${head.x} ${head.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(' ');
}
```

- [ ] **Step 4: Write the failing edge component test** `viewer/src/components/PlotterEdge.test.tsx`

```tsx
import { render } from '@testing-library/react';
import { PlotterEdgePath } from './PlotterEdge';

const pts = [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }];

it('renders a retry edge dashed in checker red with its label', () => {
  const { container, getByText } = render(
    <svg><PlotterEdgePath points={pts} kind="retry" label="flaky - fix and rerun" index={2} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.getAttribute('d')).toBe('M 0 0 L 0 40 L 60 40');
  expect(path.classList.contains('bp-edge--retry')).toBe(true);
  expect(getByText('flaky - fix and rerun')).toBeInTheDocument();
});

it('renders sequence edges solid without a label element', () => {
  const { container } = render(
    <svg><PlotterEdgePath points={pts} kind="sequence" index={0} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.classList.contains('bp-edge--retry')).toBe(false);
  expect(container.querySelector('.bp-edge-label')).toBeNull();
});
```

- [ ] **Step 5: Run to verify FAIL**, then **Step 6: Write `viewer/src/components/PlotterEdge.tsx`**

```tsx
import type { EdgeProps } from '@xyflow/react';
import { pointsToPath } from '../graph/path';
import type { EdgeKind } from '../graph/types';
import './edge.css';

export function PlotterEdgePath({
  points,
  kind,
  label,
  index,
}: {
  points: { x: number; y: number }[];
  kind: EdgeKind;
  label?: string;
  index: number;
}) {
  const d = pointsToPath(points);
  if (!d) return null;
  const mid = points[Math.floor(points.length / 2)];
  return (
    <g className="bp-edge-group" style={{ ['--i' as string]: index }}>
      <path
        className={`bp-edge bp-edge--${kind}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
      />
      {label ? (
        <text className="bp-edge-label" x={mid.x + 6} y={mid.y - 6}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function PlotterEdge(props: EdgeProps) {
  const data = props.data as
    | { points: { x: number; y: number }[]; kind: EdgeKind; label?: string; index: number }
    | undefined;
  if (!data) return null;
  return <PlotterEdgePath points={data.points} kind={data.kind} label={data.label} index={data.index} />;
}
```

- [ ] **Step 7: Write `viewer/src/components/edge.css`**

```css
.bp-edge {
  stroke: var(--ink);
  stroke-width: var(--rule-pen);
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: bp-plot var(--plot-edge-dur) ease-in-out forwards;
  animation-delay: calc(0.5s + var(--i, 0) * var(--plot-edge-stagger));
}
.bp-edge--branch { stroke-dasharray: 1; }
.bp-edge--retry {
  stroke: var(--red-checker);
  animation-name: bp-plot-dashed;
}
.bp-edge-label {
  font-family: var(--font-anno);
  font-size: 9px;
  font-style: italic;
  fill: var(--graphite);
}
@keyframes bp-plot {
  to { stroke-dashoffset: 0; }
}
@keyframes bp-plot-dashed {
  to { stroke-dashoffset: 0; stroke-dasharray: 0.04 0.02; }
}
@media (prefers-reduced-motion: reduce) {
  .bp-edge { animation: none; stroke-dashoffset: 0; }
  .bp-edge--retry { stroke-dasharray: 6 4; }
}
```

(`pathLength={1}` normalizes every path so dash animations use 0–1 regardless of pixel length; the retry keyframe ends on a dashed pattern in normalized units.)

- [ ] **Step 8: Run to verify PASS** — `cd viewer; npm test` → 16 tests PASS.

- [ ] **Step 9: Commit**

```powershell
git add viewer/src/graph/path.ts viewer/src/graph/path.test.ts viewer/src/components; git commit -m "feat(viewer): plotter edges — normalized draw-on animation, dashed red retries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: BlueprintSheet, TitleBlock, ZoneRuler

**Files:**
- Create: `viewer/src/components/BlueprintSheet.tsx`, `viewer/src/components/TitleBlock.tsx`, `viewer/src/components/ZoneRuler.tsx`, `viewer/src/components/sheet.css`, `viewer/src/components/BlueprintSheet.test.tsx`

**Interfaces:**
- Consumes: `loadWorkflow`, `layoutWorkflow`, `LaidOutGraph`, `BlueprintNode`, `PlotterEdge`.
- Produces: `<BlueprintSheet workflow={Workflow} />` — self-laying-out full sheet. Task 7 mounts it.

- [ ] **Step 1: Write the failing test** `viewer/src/components/BlueprintSheet.test.tsx`

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from '../graph/load';
import { BlueprintSheet } from './BlueprintSheet';

const wf = (() => {
  const res = loadWorkflow(gallery);
  if (!res.ok) throw new Error('fixture invalid');
  return res.workflow;
})();

it('renders the full sheet: title block, every node, zone rulers', async () => {
  render(<BlueprintSheet workflow={wf} />);
  await waitFor(() => {
    expect(screen.getAllByTestId('bp-node')).toHaveLength(wf.nodes.length);
  });
  expect(screen.getByText(wf.meta.title.toUpperCase())).toBeInTheDocument();
  expect(screen.getByText(/drawn by/i)).toBeInTheDocument();
  expect(screen.getByText('REV A')).toBeInTheDocument();
  expect(screen.getByText('N.T.S.')).toBeInTheDocument();
  expect(screen.getByText('KB NOT LINKED')).toBeInTheDocument();
  expect(screen.getByTestId('zone-ruler-top')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify FAIL**, then **Step 3: Write `viewer/src/components/TitleBlock.tsx`**

```tsx
import type { WorkflowMeta } from '../graph/types';

export function TitleBlock({ meta, nodeCount }: { meta: WorkflowMeta; nodeCount: number }) {
  const date = meta.generatedAt.slice(0, 10);
  return (
    <div className="bp-titleblock" data-testid="title-block">
      <div className="bp-titleblock-title">{meta.title.toUpperCase()}</div>
      <dl className="bp-titleblock-grid">
        <div><dt>DRAWN BY</dt><dd>CLAUDE — {meta.model}</dd></div>
        <div><dt>DATE</dt><dd>{date}</dd></div>
        <div><dt>NODES</dt><dd>{nodeCount}</dd></div>
        <div><dt>SHEET</dt><dd>1 OF 1</dd></div>
        <div><dt>SCALE</dt><dd>N.T.S.</dd></div>
        <div><dt>REV</dt><dd>REV A</dd></div>
        <div className="bp-titleblock-kb">
          <dt>KB</dt>
          <dd>{meta.kbSource === 'airtable' ? 'AIRTABLE' : 'KB NOT LINKED'}</dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: Write `viewer/src/components/ZoneRuler.tsx`** (drawing-zone coordinates: numbers across the top, letters down the side — real drafting sheets use these to reference regions)

```tsx
export function ZoneRuler({ axis, count }: { axis: 'top' | 'side'; count: number }) {
  const cells = Array.from({ length: count }, (_, i) =>
    axis === 'top' ? String(i + 1) : String.fromCharCode(65 + i),
  );
  return (
    <div className={`bp-zones bp-zones--${axis}`} data-testid={`zone-ruler-${axis}`}>
      {cells.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `viewer/src/components/BlueprintSheet.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Workflow } from '../graph/types';
import { layoutWorkflow, type LaidOutGraph } from '../graph/layout';
import { BlueprintNode } from './BlueprintNode';
import { PlotterEdge } from './PlotterEdge';
import { TitleBlock } from './TitleBlock';
import { ZoneRuler } from './ZoneRuler';
import './sheet.css';

const nodeTypes = { blueprint: BlueprintNode };
const edgeTypes = { plotter: PlotterEdge };

export function BlueprintSheet({ workflow }: { workflow: Workflow }) {
  const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);

  useEffect(() => {
    let live = true;
    layoutWorkflow(workflow).then((g) => {
      if (live) setLaidOut(g);
    });
    return () => {
      live = false;
    };
  }, [workflow]);

  if (!laidOut) {
    return <div className="bp-sheet bp-sheet--plotting" data-testid="sheet-loading">PLOTTING…</div>;
  }

  const nodes: Node[] = laidOut.nodes.map((n, i) => ({
    id: n.id,
    type: 'blueprint',
    position: { x: n.x, y: n.y },
    data: { node: n.node, index: i },
    draggable: false,
    connectable: false,
    selectable: false,
  }));

  const edges: Edge[] = laidOut.edges.map((e, i) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'plotter',
    data: { points: e.points, kind: e.kind, label: e.label, index: i },
  }));

  return (
    <div className="bp-sheet" data-testid="sheet">
      <svg className="bp-defs" aria-hidden="true">
        <defs>
          <marker id="fp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="context-stroke" strokeWidth="1.5" />
          </marker>
        </defs>
      </svg>
      <div className="bp-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      <div className="bp-frame" aria-hidden="true" />
      <ZoneRuler axis="top" count={8} />
      <ZoneRuler axis="side" count={6} />
      <TitleBlock meta={workflow.meta} nodeCount={workflow.nodes.length} />
    </div>
  );
}
```

- [ ] **Step 6: Write `viewer/src/components/sheet.css`**

```css
.bp-sheet {
  position: absolute;
  inset: 12px;
  background:
    repeating-linear-gradient(0deg, transparent 0 calc(var(--grid-minor) - 1px), color-mix(in srgb, var(--blue-nonphoto) 36%, transparent) calc(var(--grid-minor) - 1px) var(--grid-minor)),
    repeating-linear-gradient(90deg, transparent 0 calc(var(--grid-minor) - 1px), color-mix(in srgb, var(--blue-nonphoto) 36%, transparent) calc(var(--grid-minor) - 1px) var(--grid-minor)),
    repeating-linear-gradient(0deg, transparent 0 calc(var(--grid-major) - 1px), color-mix(in srgb, var(--blue-nonphoto) 70%, transparent) calc(var(--grid-major) - 1px) var(--grid-major)),
    repeating-linear-gradient(90deg, transparent 0 calc(var(--grid-major) - 1px), color-mix(in srgb, var(--blue-nonphoto) 70%, transparent) calc(var(--grid-major) - 1px) var(--grid-major)),
    var(--paper);
  animation: bp-sheet-in 0.4s ease-out backwards;
}
.bp-sheet--plotting {
  display: grid;
  place-items: center;
  font-family: var(--font-anno);
  color: var(--graphite);
  letter-spacing: var(--track-caps);
}
.bp-defs { position: absolute; width: 0; height: 0; }
.bp-canvas { position: absolute; inset: 28px 16px 16px 28px; }
.bp-canvas .react-flow { background: transparent; }

.bp-frame {
  position: absolute;
  inset: 22px 10px 10px 22px;
  border: var(--rule-frame) solid var(--ink-strong);
  outline: var(--rule-hair) solid var(--ink-strong);
  outline-offset: 3px;
  pointer-events: none;
  animation: bp-sheet-in 0.4s ease-out 0.2s backwards;
}

.bp-zones {
  position: absolute;
  display: flex;
  font-family: var(--font-anno);
  font-size: 9px;
  color: var(--graphite);
  pointer-events: none;
}
.bp-zones--top { top: 6px; left: 22px; right: 10px; justify-content: space-around; }
.bp-zones--side { top: 22px; bottom: 10px; left: 5px; flex-direction: column; justify-content: space-around; }

.bp-titleblock {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 300px;
  background: var(--paper);
  border: var(--rule-frame) solid var(--ink-strong);
  padding: 0;
  pointer-events: none;
}
.bp-titleblock-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15px;
  letter-spacing: 0.03em;
  color: var(--ink-strong);
  padding: 6px 8px;
  border-bottom: var(--rule-hair) solid var(--ink-strong);
}
.bp-titleblock-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  margin: 0;
}
.bp-titleblock-grid > div {
  border-right: var(--rule-hair) solid var(--ink);
  border-bottom: var(--rule-hair) solid var(--ink);
  padding: 3px 6px;
}
.bp-titleblock-grid dt {
  font-family: var(--font-anno);
  font-size: 7px;
  color: var(--graphite);
  letter-spacing: var(--track-caps);
}
.bp-titleblock-grid dd {
  margin: 0;
  font-family: var(--font-anno);
  font-size: 10px;
  color: var(--ink-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-titleblock-kb { grid-column: span 3; }

@keyframes bp-sheet-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .bp-sheet, .bp-frame { animation: none; }
}
```

- [ ] **Step 7: Run to verify PASS** — `cd viewer; npm test` → 17 tests PASS. (If React Flow warns about missing dimensions in jsdom, that's noise — the assertion targets rendered node bodies, which RF mounts regardless.)

- [ ] **Step 8: Commit**

```powershell
git add viewer/src/components; git commit -m "feat(viewer): drafting sheet — grid, frame, zone rulers, title block with KB field

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Gallery index, file-drop, DRAWING REJECTED, App wiring

**Files:**
- Create: `viewer/src/gallery/galleryData.ts`, `viewer/src/components/GalleryIndex.tsx`, `viewer/src/components/gallery.css`, `viewer/src/components/RejectedSheet.tsx`, `viewer/src/App.test.tsx` (extend), `viewer/src/components/GalleryIndex.test.tsx`
- Modify: `viewer/src/App.tsx` (replace placeholder)

**Interfaces:**
- Consumes: everything above.
- Produces: the complete Phase-2 app: gallery → sheet navigation, drop-a-file loading, rejection sheet.

- [ ] **Step 1: Write `viewer/src/gallery/galleryData.ts`**

```ts
import { loadWorkflow } from '../graph/load';
import type { Workflow } from '../graph/types';

const modules = import.meta.glob('../../../gallery/*.workflow.json', {
  eager: true,
  import: 'default',
});

export interface GalleryEntry { slug: string; workflow: Workflow; }

export const galleryEntries: GalleryEntry[] = Object.entries(modules)
  .map(([path, raw]) => {
    const res = loadWorkflow(raw);
    if (!res.ok) return null;
    const slug = path.split('/').pop()!.replace('.workflow.json', '');
    return { slug, workflow: res.workflow };
  })
  .filter((e): e is GalleryEntry => e !== null)
  .sort((a, b) => a.workflow.meta.title.localeCompare(b.workflow.meta.title));
```

- [ ] **Step 2: Write the failing tests** `viewer/src/components/GalleryIndex.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { GalleryIndex } from './GalleryIndex';
import { galleryEntries } from '../gallery/galleryData';

it('lists every committed gallery drawing with node count and max pain', () => {
  const onOpen = vi.fn();
  render(<GalleryIndex entries={galleryEntries} onOpen={onOpen} onDropFile={vi.fn()} />);
  expect(galleryEntries.length).toBeGreaterThan(0);
  for (const e of galleryEntries) {
    expect(screen.getByText(e.workflow.meta.title.toUpperCase())).toBeInTheDocument();
  }
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  expect(onOpen).toHaveBeenCalledWith(galleryEntries[0].workflow);
});

it('shows the drop target invitation', () => {
  render(<GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={vi.fn()} />);
  expect(screen.getByText(/drop a \.workflow\.json/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify FAIL**, then **Step 4: Write `viewer/src/components/GalleryIndex.tsx`**

```tsx
import type { DragEvent } from 'react';
import type { GalleryEntry } from '../gallery/galleryData';
import type { Workflow } from '../graph/types';
import './gallery.css';

export function GalleryIndex({
  entries,
  onOpen,
  onDropFile,
}: {
  entries: GalleryEntry[];
  onOpen: (wf: Workflow) => void;
  onDropFile: (file: File) => void;
}) {
  function handleDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  }

  return (
    <div className="bp-gallery" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="bp-gallery-grid">
        {entries.map((e) => {
          const maxPain = Math.max(...e.workflow.nodes.map((n) => n.painLevel));
          return (
            <article key={e.slug} className="bp-card">
              <div className="bp-card-title">{e.workflow.meta.title.toUpperCase()}</div>
              <dl className="bp-card-meta">
                <div><dt>NODES</dt><dd>{e.workflow.nodes.length}</dd></div>
                <div><dt>MAX PAIN</dt><dd className="bp-card-pain" data-pain={maxPain}>{'/'.repeat(maxPain)}</dd></div>
                <div><dt>DATE</dt><dd>{e.workflow.meta.generatedAt.slice(0, 10)}</dd></div>
              </dl>
              <button className="bp-card-open" onClick={() => onOpen(e.workflow)}>
                OPEN DRAWING
              </button>
            </article>
          );
        })}
        <label className="bp-card bp-card--drop">
          <span>DROP A .WORKFLOW.JSON HERE</span>
          <span className="bp-card-drop-sub">or click to browse — files from out/ open too</span>
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              if (file) onDropFile(file);
              ev.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `viewer/src/components/gallery.css`**

```css
.bp-gallery { position: absolute; inset: 0; overflow: auto; padding: 24px; }
.bp-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  max-width: 1200px;
  margin: 0 auto;
}
.bp-card {
  background: var(--paper);
  border: var(--rule-pen) solid var(--ink-strong);
  display: flex;
  flex-direction: column;
}
.bp-card-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.03em;
  color: var(--ink-strong);
  padding: 10px 12px;
  border-bottom: var(--rule-hair) solid var(--ink-strong);
  min-height: 58px;
}
.bp-card-meta { display: grid; grid-template-columns: 1fr 1fr 1fr; margin: 0; }
.bp-card-meta > div { padding: 6px 12px; border-right: var(--rule-hair) solid var(--ink); }
.bp-card-meta > div:last-child { border-right: none; }
.bp-card-meta dt { font-family: var(--font-anno); font-size: 7px; color: var(--graphite); letter-spacing: var(--track-caps); }
.bp-card-meta dd { margin: 0; font-family: var(--font-anno); font-size: 11px; color: var(--ink-strong); }
.bp-card-pain { color: var(--red-checker); font-weight: 500; }
.bp-card-open {
  margin-top: auto;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: var(--track-caps);
  color: var(--paper);
  background: var(--ink-strong);
  border: none;
  padding: 8px;
  cursor: pointer;
}
.bp-card-open:hover { background: var(--ink); }
.bp-card-open:focus-visible { outline: 2px solid var(--red-checker); outline-offset: 2px; }
.bp-card--drop {
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  color: var(--graphite);
  font-family: var(--font-anno);
  font-size: 11px;
  letter-spacing: var(--track-caps);
  min-height: 140px;
  cursor: pointer;
  text-align: center;
  padding: 12px;
}
.bp-card-drop-sub { font-size: 9px; letter-spacing: 0; text-transform: none; }
```

- [ ] **Step 6: Write `viewer/src/components/RejectedSheet.tsx`**

```tsx
export function RejectedSheet({ errors, onBack }: { errors: string[]; onBack: () => void }) {
  return (
    <div className="bp-rejected" data-testid="rejected-sheet">
      <div className="bp-rejected-stamp">DRAWING REJECTED</div>
      <div className="bp-rejected-sub">RETURNED FOR CORRECTION — SEE NOTES</div>
      <ol className="bp-rejected-notes">
        {errors.slice(0, 12).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {errors.length > 12 ? <li>…and {errors.length - 12} more</li> : null}
      </ol>
      <button className="bp-card-open bp-rejected-back" onClick={onBack}>
        BACK TO DRAWING INDEX
      </button>
    </div>
  );
}
```

Add to `gallery.css`:

```css
.bp-rejected {
  position: absolute;
  inset: 12px;
  background: var(--paper);
  border: var(--rule-frame) solid var(--red-checker);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
}
.bp-rejected-stamp {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 44px;
  letter-spacing: 0.06em;
  color: var(--red-checker);
  border: 4px solid var(--red-checker);
  padding: 4px 22px;
  transform: rotate(-3deg);
}
.bp-rejected-sub { font-family: var(--font-anno); font-size: 11px; color: var(--graphite); letter-spacing: var(--track-caps); }
.bp-rejected-notes {
  font-family: var(--font-anno);
  font-size: 11px;
  color: var(--ink-strong);
  max-width: 560px;
  max-height: 40vh;
  overflow: auto;
}
.bp-rejected-back { max-width: 260px; }
```

- [ ] **Step 7: Extend `viewer/src/App.test.tsx`** (keep the masthead test; add these)

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

it('opens a gallery drawing into the sheet view and returns', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
  fireEvent.click(screen.getByText(/drawing index/i));
  expect(screen.getAllByText('OPEN DRAWING').length).toBeGreaterThan(0);
});

it('shows DRAWING REJECTED for an invalid dropped file', async () => {
  render(<App />);
  const input = document.querySelector('input[type="file"]')!;
  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-sheet')).toBeInTheDocument());
  expect(screen.getByText('DRAWING REJECTED')).toBeInTheDocument();
  fireEvent.click(screen.getByText('BACK TO DRAWING INDEX'));
  expect(screen.getAllByText('OPEN DRAWING').length).toBeGreaterThan(0);
});

it('opens a valid dropped file as a sheet', async () => {
  render(<App />);
  const galleryRaw = JSON.stringify((await import('../../gallery/add-e2e-tests.workflow.json')).default ?? {});
  const input = document.querySelector('input[type="file"]')!;
  const good = new File([galleryRaw], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [good] } });
  await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
});
```

(Note: the import path from `viewer/src/App.test.tsx` to the gallery is `../../gallery/…` — `src` → `viewer` → repo root's `gallery/` is `../../../gallery` from files inside `src/<dir>/`, but App.test.tsx sits directly in `src/`, so it's `../../gallery/…`. Verify against Task 2's `load.test.ts` which sits one level deeper and uses `../../../…`.)

- [ ] **Step 8: Run to verify FAIL**, then **Step 9: Replace `viewer/src/App.tsx`**

```tsx
import { useState } from 'react';
import { galleryEntries } from './gallery/galleryData';
import { loadWorkflow } from './graph/load';
import type { Workflow } from './graph/types';
import { BlueprintSheet } from './components/BlueprintSheet';
import { GalleryIndex } from './components/GalleryIndex';
import { RejectedSheet } from './components/RejectedSheet';

type View =
  | { mode: 'gallery' }
  | { mode: 'sheet'; workflow: Workflow }
  | { mode: 'rejected'; errors: string[] };

export default function App() {
  const [view, setView] = useState<View>({ mode: 'gallery' });

  function handleFile(file: File) {
    file.text().then((text) => {
      let raw: unknown;
      try {
        raw = JSON.parse(text.replace(/^\uFEFF/, ''));
      } catch (err) {
        setView({ mode: 'rejected', errors: [`file: not valid JSON (${(err as Error).message})`] });
        return;
      }
      const res = loadWorkflow(raw);
      if (res.ok) setView({ mode: 'sheet', workflow: res.workflow });
      else setView({ mode: 'rejected', errors: res.errors });
    });
  }

  return (
    <div className="app-shell">
      <header className="app-masthead">
        Flowprint{' '}
        <button className="masthead-sub masthead-link" onClick={() => setView({ mode: 'gallery' })}>
          drawing index
        </button>
      </header>
      <main className="app-main">
        {view.mode === 'gallery' && (
          <GalleryIndex
            entries={galleryEntries}
            onOpen={(workflow) => setView({ mode: 'sheet', workflow })}
            onDropFile={handleFile}
          />
        )}
        {view.mode === 'sheet' && <BlueprintSheet workflow={view.workflow} />}
        {view.mode === 'rejected' && (
          <RejectedSheet errors={view.errors} onBack={() => setView({ mode: 'gallery' })} />
        )}
      </main>
    </div>
  );
}
```

Add to `app.css`:

```css
.masthead-link {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.masthead-link:focus-visible { outline: 2px solid var(--red-checker); outline-offset: 2px; }
```

- [ ] **Step 10: Run to verify PASS** — `cd viewer; npm test` → 22 tests PASS.

- [ ] **Step 11: Commit**

```powershell
git add viewer/src; git commit -m "feat(viewer): gallery drawing index, file-drop loader, DRAWING REJECTED sheet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Build hardening, repo housekeeping, Tahir's checklist

**Files:**
- Create: `.gitattributes`, `viewer/README.md`
- Modify: root `package.json` (engines/license + viewer scripts), root `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: a buildable, documented Phase-2 deliverable; closes deferred Phase-1 minors (.gitattributes, engines/license, README gallery pointer).

- [ ] **Step 1: Create `.gitattributes`** (repo root — closes the deferred CRLF minor)

```
* text=auto eol=lf
```

- [ ] **Step 2: Modify root `package.json`** — add after `"private": true,`:

```json
  "license": "MIT",
  "engines": { "node": ">=20" },
```

and add to `"scripts"`:

```json
    "test:viewer": "npm --prefix viewer test",
    "dev:viewer": "npm --prefix viewer run dev",
    "build:viewer": "npm --prefix viewer run build"
```

- [ ] **Step 3: Update root `README.md`** — replace the "## Try it (Phase 1)" section with:

```markdown
## Try it

**Generate a graph** (Phase 1): open this repo in Claude Code and run `/graph-my-task "your task here"` — the validated graph lands in `out/`.

**View drawings** (Phase 2): `npm run dev:viewer`, then open the printed URL. The drawing index lists every graph in `gallery/`; drop any `*.workflow.json` (including files from `out/`) onto the page to view it as a drafting sheet.
```

- [ ] **Step 4: Write `viewer/README.md`**

```markdown
# Flowprint Viewer

Vite + React static SPA that renders `*.workflow.json` files as blueprint drafting sheets.

- `npm run dev` — dev server
- `npm test` — vitest (jsdom)
- `npm run build` — static build in `dist/` (relative base; deployable to GitHub Pages as-is)

Design tokens live in `src/tokens.css` — all colors and type come from there. The validator is shared with the CLI via `../scripts/validate-pure.mjs`; the schema in `../schema/` is the single source of truth.
```

- [ ] **Step 5: Full verification sweep**

Run each; all must succeed:
- root: `npm test` → 19/19
- `npm run test:viewer` → 22/22
- `npm run build:viewer` → tsc + vite build succeed, `viewer/dist/` produced
- `git status` → only intended files

- [ ] **Step 6: Commit**

```powershell
git add .gitattributes package.json README.md viewer/README.md; git commit -m "chore: build hardening, line-ending policy, viewer scripts + docs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 2 exit criteria (Tahir's local review)

1. `npm run dev:viewer` → drawing index shows the gallery card(s), styled as drafting cards.
2. Open the e2e drawing: grid + frame render, edges plot themselves in, nodes stamp in, retry edges dashed red with labels, heat visible on pain-4/5 nodes, title block shows TITLE / DRAWN BY CLAUDE / DATE / REV A / N.T.S. / KB NOT LINKED.
3. Drop `out/comic-story-webpage.workflow.json` onto the page → it renders as a sheet.
4. Drop a broken JSON → DRAWING REJECTED sheet with notes, and Back returns to the index.
5. OS-level reduced-motion on → no animations, final state immediate.
6. Both suites green (19 root + 22 viewer); `npm run build:viewer` clean.

## Verification notes for the executor

- React Flow renders custom node bodies in jsdom with the Task-1 polyfills; if an RF version bump changes an API (e.g. `EdgeProps` shape), adapt minimally and record it.
- ELK cycle handling: the gallery graph has 3 retry back-edges; `layered` breaks cycles automatically. If layout throws, the failing graph JSON goes in the report — do not swallow.
- Nothing in the viewer may import `node:` modules (browser build breaks) — `validate-pure.mjs` exists precisely to keep that boundary.
