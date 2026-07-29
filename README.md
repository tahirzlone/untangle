# Flowprint

Map your Claude workflows. Describe a task → see the flowchart of how Claude would break it down with zero helpers → watch skills, plugins, connectors, and MCP servers from a curated knowledge base collapse it into something radically simpler.

**Status: Phase 2 — contract + engine + viewer.** The `/graph-my-task` Claude Code skill generates validated `*.workflow.json` graphs; the viewer renders them as live Signal graphs — dark canvas, left→right flow, pain glowing ember. Suggestions and the magic morph are coming in later phases.

## Try it

**Generate a graph** (Phase 1): open this repo in Claude Code and run `/graph-my-task "your task here"` — the validated graph lands in `out/`.

**View graphs** (Phase 2): `npm --prefix viewer install` (first time), then `npm run dev:viewer`, then open the printed URL. The graph index lists every graph in `gallery/`; drop any `*.workflow.json` (including files from `out/`) onto the page to open it on the canvas.
