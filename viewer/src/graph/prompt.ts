import type { GraphSession } from './apply';
import { hasInstall } from './installKit';
import type { Suggestion, Workflow } from './types';

/**
 * The optimized prompt: the deliverable the whole session builds toward.
 *
 * Every APPLY so far has been the viewer talking to itself — versions, metrics,
 * a morphing picture. This module is where that walk pays out as something the
 * user takes away: the task rewritten as a prompt they can paste straight into
 * Claude, with each applied resource introduced at the point in the work where
 * it belongs.
 *
 * Pure, and deliberately downstream of the reducer, the same bargain metrics.ts
 * struck: everything here is read off `appliedIds[0..cursor)` and versions[0],
 * so the prompt cannot disagree with the graph on screen. An undo, a redo, a
 * version jump — the prompt is a function of the session, so it answers for
 * wherever the cursor is standing, with no cache to go stale.
 *
 * The assembly contract is stated in `.claude/skills/graph-my-task/SKILL.md`
 * ("The optimized prompt") and implemented here verbatim. Contract v2:
 * `meta.promptIntro` first, then the `promptFragment` of every applied
 * suggestion in flow order — passed through as written, never edited — then the
 * SETUP BLOCK, one line per install the included resources rely on.
 *
 * What v2 moved is the installs. Under v1 a fragment quoted its own install and
 * the closing line swept up whatever no fragment had mentioned; the command was
 * therefore wherever its author happened to put it. That is unworkable the
 * moment a resource can be ticked out of the prompt: prose cannot be un-said one
 * row at a time, so an excluded resource would keep instructing the reader to
 * install it. Under v2 the assembler owns every install line, and SKILL.md tells
 * fragment authors to name no command at all.
 *
 * LEGACY PROSE IS NOT STRIPPED. Files written against v1 exist, and a fragment
 * of theirs still ends "Add it first with `…`". This module does not rewrite
 * them — an assembler that edited authored prose would be guessing at a sentence
 * it did not write, on a string the user is about to run. The install therefore
 * appears twice on those files: once in the fragment, once in the setup block.
 * The fix for that is content, not code — the fragments get rewritten.
 */

/** The text with a full stop it may already own — never two, never none. */
function ended(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The one sentence the fallback opening adds after the task's own words. The
 * task field is a description of what the user wants; this is what turns it
 * into an instruction without inventing a requirement they never stated.
 */
const FALLBACK_CHARGE = 'Take it from start to finish.';

/**
 * The opening paragraph: the generator's rewrite when it wrote one, the user's
 * own words otherwise. SKILL.md tells the generator to omit `promptIntro` when
 * it cannot beat `meta.task` verbatim — this is the other half of that bargain.
 */
function opening(wf: Workflow): string {
  return wf.meta.promptIntro ?? `${ended(wf.meta.task)} ${FALLBACK_CHARGE}`;
}

/**
 * One applied suggestion, as prompt prose: the fragment its author wrote, or a
 * line templated from the fields every suggestion carries.
 *
 * The template names no install, and that is v2 rather than an omission. This
 * line is the assembler's own prose, so it is the assembler's to keep honest:
 * a templated "Install: …" here would be an install line outside the setup
 * block, and a reader who excluded that resource would still be told to run it.
 * The command has exactly one home now, and it is below.
 */
function paragraphFor(s: Suggestion): string {
  return s.promptFragment ?? `Use ${s.name} (${s.category}) here: ${ended(s.claim)}`;
}

/** The setup block's own first line — the sentence every command stands under. */
const SETUP_LEAD = 'Before you start, install what the steps above rely on:';

/**
 * The setup block: every install the included resources rely on, gathered under
 * one line so nothing the prompt depends on arrives unannounced.
 *
 * One command per line, because the line is the unit the reader toggles: a row
 * ticked out of the prompt takes its whole line with it, and what is left is
 * still a list rather than a sentence with a hole in it. Backticked, so a
 * command reads as a command in the prose around it.
 *
 * Gated on `hasInstall`, which is the same predicate the paste block and the
 * rows on screen are drawn through — a field holding nothing but spaces is not
 * a command, and listing it would invite the reader to run a blank line. Deduped
 * by the exact string for the same reason the kit dedupes by it: the same MCP
 * suggested at two steps is one `mcp add`.
 *
 * EXCLUSION AND DEDUPE MEET HERE. Excluded rows are skipped before the string is
 * ever registered as seen, so a command two resources share survives while any
 * one of them is still included — the line belongs to the string, not to
 * whichever row reached it first. Only when the last includer goes does it go.
 *
 * Nothing to install — everything excluded, or nothing installable — and there
 * is no block: a heading with no list under it is the template showing through.
 */
function setupBlock(applied: Suggestion[], exclude: ReadonlySet<string>): string | null {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const s of applied) {
    if (exclude.has(s.airtableRecordId)) continue;
    if (!hasInstall(s)) continue;
    if (seen.has(s.install)) continue;
    seen.add(s.install);
    lines.push(`- \`${s.install}\``);
  }

  return lines.length === 0 ? null : [SETUP_LEAD, ...lines].join('\n');
}

/**
 * What the session has applied, in flow order — the sequence every surface that
 * speaks for the applied set reads off, so the prompt and the install kit can
 * never disagree about what is in it or what order it comes in.
 *
 * "Flow order" is the order the WORK runs in, not the order the patches were
 * applied: a fragment says "before you rank anything" and has to appear before
 * the fragment that ranks. The deterministic reading of that is the target
 * node's position in `versions[0].nodes` — V0 is the one graph every applied
 * suggestion's `nodeId` is guaranteed to name a node in (the loader checks
 * exactly that), and the generator writes `nodes` in the order the work runs.
 * Two suggestions on one node keep the order they were applied in — the sort is
 * stable, and there is nothing lefter than the same node.
 *
 * Read off `appliedIds[0..cursor)`, so an undo drops the last patch out of the
 * answer and a redo puts it back: the list is a function of where the cursor is
 * standing, never of how it got there.
 */
export function appliedInFlowOrder(session: GraphSession): Suggestion[] {
  const v0 = session.versions[0];
  const byId = new Map(v0.suggestions.map((s) => [s.airtableRecordId, s]));
  const flowAt = new Map(v0.nodes.map((n, i) => [n.id, i]));

  return session.appliedIds
    .slice(0, session.cursor)
    .map((id) => byId.get(id))
    .filter((s): s is Suggestion => s !== undefined)
    .sort(
      (a, b) =>
        (flowAt.get(a.nodeId) ?? v0.nodes.length) - (flowAt.get(b.nodeId) ?? v0.nodes.length),
    );
}

/**
 * How the caller shapes an assembly. One dial so far, and it names RESOURCES
 * rather than strings: the surface doing the excluding has a checkbox per
 * applied row, and `airtableRecordId` is the one thing that identifies a row
 * whatever its install says.
 */
export interface AssembleOptions {
  /** Applied resources whose install line the prompt leaves out. */
  excludeInstalls?: ReadonlySet<string>;
}

/** The default: nothing excluded, every applied install listed. */
const NOTHING_EXCLUDED: ReadonlySet<string> = new Set<string>();

/**
 * The whole prompt for the session as it stands: opening, one paragraph per
 * applied suggestion in flow order, then the setup block — blank lines between,
 * because the result is for pasting, not for parsing.
 *
 * Called with no options it lists every install the applied set carries, which
 * is the shape of the prompt anyone who never touches a checkbox gets. Pass
 * `excludeInstalls` and exactly those resources' commands drop out; nothing else
 * in the text moves, which is what makes the toggle safe to drive from a live
 * surface.
 *
 * Pure, and it caches nothing: two calls with different exclusions are two
 * assemblies of the same session, and neither can leave a trace on the other.
 *
 * At V0 the prompt is the opening alone. That is not an empty state: the task
 * as a prompt is a valid prompt, just one no upgrade has improved yet.
 */
export function assemblePrompt(session: GraphSession, opts?: AssembleOptions): string {
  const applied = appliedInFlowOrder(session);
  const setup = setupBlock(applied, opts?.excludeInstalls ?? NOTHING_EXCLUDED);

  return [
    opening(session.versions[0]),
    ...applied.map(paragraphFor),
    ...(setup ? [setup] : []),
  ].join('\n\n');
}
