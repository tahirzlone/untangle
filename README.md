# Flowprint

Map your Claude workflows. Describe a task → see the flowchart of how Claude would break it down with zero helpers → watch skills, plugins, connectors, and MCP servers from a curated knowledge base collapse it into something radically simpler.

**Status: Phase 3 — suggestions + the magic morph.** The `/graph-my-task` Claude Code skill generates validated `*.workflow.json` graphs, matching each step against a live Airtable knowledge base of real skills, plugins, and MCP servers; the viewer renders them as Signal graphs — dark canvas, left→right flow, pain glowing ember — and applies a suggestion as an animated collapse of the flow it replaces.

## Try it

**Generate a graph:** open this repo in Claude Code and run `/graph-my-task "your task here"` — the validated graph lands in `out/`.

**Suggestions need no setup:** every run matches your steps against the curated knowledge base through a public feed — no account, no token, nothing to configure. Setting your own `AIRTABLE_API_KEY` overrides the feed and suggests from your base instead.

**View graphs:** `npm --prefix viewer install` (first time), then `npm run dev:viewer`, then open the printed URL. The graph index lists every graph in `gallery/`; drop any `*.workflow.json` (including files from `out/`) onto the page to open it on the canvas. Then, on the canvas:

- **Click a node** for its detail panel — the whole step, unclamped, plus the resources the knowledge base matched to it. Badge pips on the cards show which steps have matches.
- **Press APPLY on a card** and watch the graph simplify: the steps it replaces collapse into one, the ember cools, the impact meter counts up what you got back (steps, minutes, tokens, manual interventions), and a new version lands on the version strip. **UNDO** — or a click on any earlier version — puts it back exactly.
- **Drag nodes** to reshape the flow; edges and return lanes follow live. **RESET LAYOUT** hands the graph back to the auto-layout engine.
- **Suggestions of your own:** the toolbar reads `AIRTABLE` when a graph was generated against a knowledge base and `KB NOT LINKED` when it wasn't. Set `AIRTABLE_API_KEY` before generating to suggest from your own base instead of the public feed — [`kb/airtable-template.md`](kb/airtable-template.md) has the table schema, the env vars, and how to make the token.
