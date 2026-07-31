# Flowprint

Map your Claude workflows. Describe a task → see the flowchart of how Claude would break it down with zero helpers → watch skills, plugins, connectors, and MCP servers from a curated knowledge base collapse it into something radically simpler.

**Status: Phase 3 — suggestions + the magic morph.** The `/graph-my-task` Claude Code skill generates validated `*.workflow.json` graphs, matching each step against a live Airtable knowledge base of real skills, plugins, and MCP servers; the viewer renders them as Signal graphs — dark canvas, left→right flow, pain glowing ember — and applies a suggestion as an animated collapse of the flow it replaces.

## Try it

**Generate a graph:** open this repo in Claude Code and run `/graph-my-task "your task here"` — the validated graph lands in `out/`.

**Suggestions need no setup:** every run matches your steps against the curated knowledge base through a public feed — no account, no token, nothing to configure. Setting your own `AIRTABLE_API_KEY` overrides the feed and suggests from your base instead.

**View graphs:** `npm --prefix viewer install` (first time), then `npm run dev:viewer`, then open the printed URL. The graph index lists every graph in `gallery/`; drop any `*.workflow.json` (including files from `out/`) onto the page to open it on the canvas. Then, on the canvas:

- **Click a node** for its detail panel — the whole step, unclamped, plus the resources the knowledge base matched to it. Badge pips on the cards show which steps have matches.
- **Press APPLY on a card** and watch the graph simplify: the steps it replaces collapse into one, the ember cools, what the patch saved rises off the step you pressed, and a new version lands on the version strip.
- **Read the impact panel** (right, under the toolbar) for what all of it came to: what the applied patches saved (steps, minutes, tokens, manual interventions), how much of the graph's pain is gone, the step and edge counts before and now, and a bar per version so the walk from the original reads as a shape. The chevron folds it away to a tab when you want the canvas back.
- **Press OPTIMIZE** to hand the whole graph over: the camera travels to each step worth upgrading, applies it, and moves on while the flow collapses behind it. It ends on a scorecard — how many upgrades landed, the four totals, the shape and the pain before→after, and what was applied. CANCEL or ESC stops the run after the patch in flight.
- **UNDO and REDO** walk the history both ways, and any chip on the version strip jumps straight to that version — the versions ahead stay dimmed but live until you apply from an earlier one, which branches and drops them.
- **VS ORIGINAL** opens a before/after wipe: the graph you started with — arranged the way you left it — on one side of a draggable divider, the graph you have now on the other, with the headline savings floating at the seam. Drag the handle (or arrow-key it; Home/End snap it to the edges), pan and zoom with both sides locked together, and leave with ESC or the button.
- **CRITICAL PATH** glows the longest run of pain through the flow. It recomputes per version, so the chain visibly shortens as you apply.
- **EXPORT** (toolbar) or **EXPORT PNG** (scorecard) writes the graph as it stands to a shareable image, named for the graph and the version you are on.
- **Drag nodes** to reshape the flow; edges and return lanes follow live. **RESET LAYOUT** hands the graph back to the auto-layout engine.
- **Suggestions of your own:** the toolbar reads `AIRTABLE` when a graph was generated against a knowledge base and `KB NOT LINKED` when it wasn't. Set `AIRTABLE_API_KEY` before generating to suggest from your own base instead of the public feed — [`kb/airtable-template.md`](kb/airtable-template.md) has the table schema, the env vars, and how to make the token.
