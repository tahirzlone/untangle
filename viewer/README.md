# Flowprint Viewer

Vite + React static SPA that renders `*.workflow.json` files as Signal graphs — dark canvas, left→right flow, ported node cards, live edges.

- `npm install` — first-time setup
- `npm run dev` — dev server
- `npm test` — vitest (jsdom)
- `npm run build` — static build in `dist/` (relative base; deployable to GitHub Pages as-is)

Design tokens live in `src/tokens.css` — all colors and type come from there, and the approved look is `../design/theme-variants.html` VARIANT C. The validator is shared with the CLI via `../scripts/validate-pure.mjs`; the schema in `../schema/` is the single source of truth.
