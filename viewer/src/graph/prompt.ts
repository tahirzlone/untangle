import type { GraphSession } from './apply';
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
 * ("The optimized prompt") and implemented here verbatim: `meta.promptIntro`
 * first, then the `promptFragment` of every applied suggestion in flow order,
 * then a closing line naming any install no fragment mentioned — with a
 * templated fallback wherever the generator omitted the optional prose.
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
 * line templated from the fields every suggestion carries. The Install clause
 * goes only where there is an install — "Install:" with nothing after it would
 * be the template showing through the prose.
 */
function paragraphFor(s: Suggestion): string {
  if (s.promptFragment) return s.promptFragment;
  const use = `Use ${s.name} (${s.category}) here: ${ended(s.claim)}`;
  return s.install ? `${use} Install: ${s.install}` : use;
}

/**
 * The closing line: every install the paragraphs above did NOT already state,
 * so nothing the prompt relies on arrives unannounced. An install quoted inside
 * an authored fragment — or templated into a fallback line — is mentioned, and
 * saying it twice would read as two tools where there is one. No unmentioned
 * installs, no line: a closing that listed nothing would be a heading with no
 * list under it.
 */
function closing(applied: Suggestion[], paragraphs: string[]): string | null {
  const seen = new Set<string>();
  const unmentioned: string[] = [];
  for (const s of applied) {
    const install = s.install;
    if (!install || seen.has(install)) continue;
    seen.add(install);
    if (!paragraphs.some((p) => p.includes(install))) unmentioned.push(install);
  }
  if (unmentioned.length === 0) return null;
  const list = unmentioned.map((install) => `\`${install}\``).join('; ');
  return `Before you start, install what the steps above rely on: ${list}.`;
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
 * The whole prompt for the session as it stands: opening, one paragraph per
 * applied suggestion in flow order, closing installs line — blank lines
 * between, because the result is for pasting, not for parsing.
 *
 * At V0 the prompt is the opening alone. That is not an empty state: the task
 * as a prompt is a valid prompt, just one no upgrade has improved yet.
 */
export function assemblePrompt(session: GraphSession): string {
  const applied = appliedInFlowOrder(session);
  const paragraphs = applied.map(paragraphFor);
  const close = closing(applied, paragraphs);
  return [opening(session.versions[0]), ...paragraphs, ...(close ? [close] : [])].join('\n\n');
}
