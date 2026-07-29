# Flowprint Viewer

Vite + React static SPA that renders `*.workflow.json` files as blueprint drafting sheets.

- `npm run dev` — dev server
- `npm test` — vitest (jsdom)
- `npm run build` — static build in `dist/` (relative base; deployable to GitHub Pages as-is)

Design tokens live in `src/tokens.css` — all colors and type come from there. The validator is shared with the CLI via `../scripts/validate-pure.mjs`; the schema in `../schema/` is the single source of truth.
