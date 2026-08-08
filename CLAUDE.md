# Untangle

The contract is `schema/workflow.schema.json` — every `*.workflow.json` in `out/`, `gallery/`, or `tests/fixtures/` must pass it, via either validator: `node scripts/validate.mjs <file>` (dev, needs the root npm install) or `node scripts/validate.bundle.mjs <file>` (committed, dependency-free).

- The engine is the `/graph-my-task` skill in `.claude/skills/graph-my-task/`.
- No data-gathering, sync, or backfill scripts belong in this repo — the knowledge base is read live from Airtable at generation time (Phase 3+).
- Run tests with `npm test` (vitest).
