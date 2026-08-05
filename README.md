# Flowprint

Map your Claude workflows. Describe a task → see the flowchart of how Claude would break it down with zero helpers → watch skills, plugins, connectors, and MCP servers from a curated knowledge base collapse it into something radically simpler → leave with the task rewritten as a prompt you can paste into Claude.

**Status: Phase 3 — suggestions + the magic morph.** The `/graph-my-task` Claude Code skill generates validated `*.workflow.json` graphs, matching each step against a live Airtable knowledge base of real skills, plugins, and MCP servers; the viewer renders them as Signal graphs — dark canvas, left→right flow, pain glowing ember — and applies a suggestion as an animated collapse of the flow it replaces.

## Try it

**Generate a graph:** open this repo in Claude Code and run `/graph-my-task "your task here"` — the validated graph lands in `out/`.

**Suggestions need no setup:** every run matches your steps against the curated knowledge base through a public feed — no account, no token, nothing to configure. Setting your own `AIRTABLE_API_KEY` overrides the feed and suggests from your base instead.

**Set the helpers up:** when the suggestions carry install commands, the skill offers to add them for real — it probes what is already on the machine, puts every exact command in a table and waits for `all` / `pick` / `none`, then runs the shell ones once each and prints the ones you type inside Claude Code yourself. Point it at any existing `*.workflow.json` and ask to install its resources to do the same later.

**View graphs:** `npm --prefix viewer install` (first time), then `npm run dev:viewer`, then open the printed URL. The graph index lists every graph in `gallery/`; drop any `*.workflow.json` (including files from `out/`) onto the page to open it on the canvas. Then, on the canvas:

- **Both ends are marked.** The first step wears START and takes a chevron into its left port; the last wears END and runs out of its right port to a terminal dot — so which way the work flows reads at a glance, at any zoom, and comes with the graph into an export.
- **Rest on a badged card** and its best match rises beside it — the name, what it claims, what it saves — without opening anything. Move off and it goes. Once the detail panel is open the peek stays down; the panel is already saying more than it could.
- **Click a node** for its detail panel — the whole step, unclamped, plus the resources the knowledge base matched to it. Badge pips on the cards show which steps have matches.
- **Press APPLY on a card** and watch the graph simplify: the steps it replaces collapse into one, the ember cools, what the patch saved rises off the step you pressed, and a new version lands on the version strip.
- **Read the impact panel** (right, under the toolbar) for what all of it came to: what the applied patches saved (steps, minutes, tokens, manual interventions), how much of the graph's pain is gone, the step and edge counts before and now, and a bar per version so the walk from the original reads as a shape. The chevron folds it away to a tab when you want the canvas back.
- **Press OPTIMIZE** to hand the whole graph over: the camera travels to each step worth upgrading, applies it, and moves on while the flow collapses behind it. It ends on a scorecard — how many upgrades landed, the four totals, the shape and the pain before→after, what was applied, and the rewritten prompt to take with you. CANCEL or ESC stops the run after the patch in flight.
- **Press PROMPT** for the thing you leave with: the task rewritten as a prompt to paste into Claude, with every upgrade you applied introduced at the step that needs it, in the order the flow runs them, and anything that still needs installing named the first time it is used. It follows the version you are on — apply, undo, or jump the strip and the text moves with you — and COPY takes it, from the panel or from the scorecard at the end of a run.
- **The install kit** is the pre-flight under that prompt: naming a helper in a prompt does not put it on the machine, so the kit shows the command that does — one row per upgrade, in the same order. Everything runnable starts ticked; clear what you already have and COPY hands you one block to paste, shell commands bare and Claude Code's own commented under a line saying where they are typed instead. A resource with nothing to run is listed too, as a link to its page. The kit covers the upgrades you've applied, so it follows the version you are on, and the scorecard keeps a frozen copy of the whole run's.
- **UNDO and REDO** walk the history both ways, and any chip on the version strip jumps straight to that version — the versions ahead stay dimmed but live until you apply from an earlier one, which branches and drops them.
- **VS ORIGINAL** opens a before/after wipe: the graph you started with — arranged the way you left it — on one side of a draggable divider, the graph you have now on the other, with the headline savings floating at the seam. Drag the handle (or arrow-key it; Home/End snap it to the edges), pan and zoom from the NOW side to move both halves as one world, and leave with ESC or the button.
- **CRITICAL PATH** glows the longest run of pain through the flow. It recomputes per version, so the chain visibly shortens as you apply.
- **EXPORT** (toolbar) or **EXPORT PNG** (scorecard) writes the graph as it stands to a shareable image, named for the graph and the version you are on.
- **Drag nodes** to reshape the flow; edges and return lanes follow live. **RESET LAYOUT** hands the graph back to the auto-layout engine.
- **Suggestions of your own:** the toolbar reads `AIRTABLE` when a graph was generated against a knowledge base and `KB NOT LINKED` when it wasn't. Set `AIRTABLE_API_KEY` before generating to suggest from your own base instead of the public feed — [`kb/airtable-template.md`](kb/airtable-template.md) has the table schema, the env vars, and how to make the token.
