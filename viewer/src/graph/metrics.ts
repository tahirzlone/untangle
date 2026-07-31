import { current, type GraphSession, type SessionMetrics } from './apply';
import type { EffectMetrics, Workflow } from './types';

/**
 * What the session did to the graph, in numbers nobody had to invent.
 *
 * Pure, and deliberately downstream of the reducer: every figure here is read off
 * versions the reducer already built, so the panel cannot disagree with the graph
 * on screen. Nothing in this module knows what a component is.
 *
 * Two families live here. The COUNTS — pain, complexity, the per-version series —
 * are measured off the workflow itself. The WORDS — which components of a saving
 * moved, and how one is written — are the vocabulary every surface states a
 * saving in: the panel, the peek, the scorecard and the celebration floats all
 * read them from here, so the same saving cannot read two ways in two places.
 */

/** U+2212, not a hyphen: these are negative quantities set in a mono face. */
const MINUS = '−';

/** The four components, in the order they read as a sentence. */
const PARTS: { key: keyof EffectMetrics; unit: string }[] = [
  { key: 'stepsSaved', unit: 'steps' },
  { key: 'estTimeSavedMin', unit: 'min' },
  { key: 'estTokensSaved', unit: 'tok' },
  { key: 'manualInterventionsRemoved', unit: 'manual' },
];

/**
 * The components a set of totals actually moved, in reading order.
 *
 * Honest generations routinely claim no token saving or no manual step removed,
 * and a readout saying "−0 tok" would turn that zero into a boast about nothing.
 */
export function impactParts(metrics: EffectMetrics): { key: keyof EffectMetrics; unit: string }[] {
  return PARTS.filter((p) => metrics[p.key] !== 0);
}

/**
 * The units that have a singular, and what it is.
 *
 * Only one of the four does. "min", "tok" and "manual" are already the same word
 * at any count — a saving of one minute is "−1 min", not "−1 mins" — while "−1
 * steps" is simply wrong, and it is the number the eye lands on first.
 */
const SINGULAR: Record<string, string> = { steps: 'step' };

/** The word that goes with a count of this unit. */
export function impactUnit(value: number, unit: string): string {
  return Math.abs(value) === 1 ? SINGULAR[unit] ?? unit : unit;
}

/**
 * One component, written the way this theme writes a saving.
 *
 * The count-up is ceiled, so the word follows the number that is SHOWING rather
 * than the total it is heading for: a tween passing through 1 on its way to 2
 * reads "−1 step" for those frames, which is what is on screen.
 */
export function impactLabel(value: number, unit: string): string {
  const shown = Math.ceil(value);
  return `${MINUS}${shown} ${impactUnit(shown, unit)}`;
}

/**
 * The pain reduction, written the same way.
 *
 * A graph that got HARDER — a replacement step that hurts more than what it
 * replaced — reads "+12%", not a minus sign in front of a negative number. The
 * only percentage that gets no sign at all is the one that did not move.
 */
export function painLabel(pct: number): string {
  if (pct === 0) return '0%';
  return pct > 0 ? `${MINUS}${pct}%` : `+${-pct}%`;
}

/** Σ painLevel over a version's steps: how much the work hurts, in one number. */
export function painTotals(wf: Workflow): number {
  return wf.nodes.reduce((sum, n) => sum + n.painLevel, 0);
}

/**
 * How much graph there is.
 *
 * Two counts and not one score: steps and the connections between them are
 * different things, and any single number combining them would be a unit this
 * project made up. The panel states both.
 */
export interface Complexity {
  nodes: number;
  edges: number;
}

export function complexity(wf: Workflow): Complexity {
  return { nodes: wf.nodes.length, edges: wf.edges.length };
}

/**
 * How much of the original pain is gone, as a whole percent.
 *
 * Rounded, with one guard: only a graph with NO pain left may read 100. A
 * rounding that reached it while a painful step was still on the canvas would be
 * the panel claiming a finished job the graph can plainly be seen not to have
 * done. A graph that arrived painless — or with no steps at all — has nothing to
 * reduce and answers 0 rather than dividing by it.
 *
 * Negative is a legal answer: a patch may put a step in place of one that hurt
 * less. Reporting that as a reduction of zero would be the panel declining to say
 * what happened.
 */
export function painPercent(before: number, now: number): number {
  if (before <= 0) return 0;
  if (now <= 0) return 100;
  return Math.min(99, Math.round(((before - now) / before) * 100));
}

/** One version, measured. The panel's bar chart is this series. */
export interface VersionImpact {
  /** Position in `session.versions` — 0 is the graph as it arrived. */
  index: number;
  pain: number;
  complexity: Complexity;
}

export interface ImpactSummary {
  /** Every version the session holds, including the ones UNDO stepped back out of. */
  perVersion: VersionImpact[];
  /** Which of them is on the canvas. */
  at: number;
  /** The four saving totals for the applied prefix — the reducer's own figures. */
  totals: SessionMetrics;
  painBefore: number;
  painNow: number;
  painPct: number;
  complexityBefore: Complexity;
  complexityNow: Complexity;
}

/**
 * The whole readout for a session, at wherever its cursor is standing.
 *
 * Composed over the reducer rather than beside it: `current` decides which
 * version is live and `session.metrics` is already the totals for the prefix that
 * built it, so an UNDO moves every figure here at once and none of them can drift
 * from the graph. Nothing is accumulated as it goes — the summary is a function of
 * the session, so the cursor may land anywhere in the history and get an answer
 * that is true THERE.
 *
 * `perVersion` spans the redo-future too, because the version strip does: the
 * chart is the same walk the chips are, and a series that stopped at the cursor
 * would show a graph with no way forward while the strip offers one.
 */
export function impactSummary(session: GraphSession): ImpactSummary {
  const perVersion: VersionImpact[] = session.versions.map((wf, index) => ({
    index,
    pain: painTotals(wf),
    complexity: complexity(wf),
  }));
  const before = session.versions[0];
  const now = current(session);
  const painBefore = painTotals(before);
  const painNow = painTotals(now);

  return {
    perVersion,
    at: session.cursor,
    totals: session.metrics,
    painBefore,
    painNow,
    painPct: painPercent(painBefore, painNow),
    complexityBefore: complexity(before),
    complexityNow: complexity(now),
  };
}
