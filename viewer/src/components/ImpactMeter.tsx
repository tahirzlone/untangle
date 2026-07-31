import { useEffect, useRef, useState } from 'react';
import type { SessionMetrics } from '../graph/apply';
// the canvas's own reader, not a second copy of the same media query
import { prefersReducedMotion } from './motion';
import './impact.css';

const TWEEN_MS = 400;
/** U+2212, not a hyphen: these are negative quantities set in a mono face. */
const MINUS = '−';

/** The four components, in the order they read as a sentence. */
const PARTS: { key: keyof SessionMetrics; unit: string }[] = [
  { key: 'stepsSaved', unit: 'steps' },
  { key: 'estTimeSavedMin', unit: 'min' },
  { key: 'estTokensSaved', unit: 'tok' },
  { key: 'manualInterventionsRemoved', unit: 'manual' },
];

/**
 * The components a set of totals actually moved, in reading order.
 *
 * Exported because the scorecard states the same four numbers at the end of a
 * cinematic, and two places deciding separately which of them count is two places
 * that can disagree about what the graph saved.
 */
export function impactParts(metrics: SessionMetrics): { key: keyof SessionMetrics; unit: string }[] {
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

/**
 * One component, written the way this theme writes a saving.
 *
 * The count-up is ceiled, so the word follows the number the chip is SHOWING
 * rather than the total it is heading for: a tween passing through 1 on its way to
 * 2 reads "−1 step" for those frames, which is what is on screen.
 */
export function impactLabel(value: number, unit: string): string {
  const shown = Math.ceil(value);
  const word = Math.abs(shown) === 1 ? SINGULAR[unit] ?? unit : unit;
  return `${MINUS}${shown} ${word}`;
}

function lerp(from: SessionMetrics, to: SessionMetrics, p: number): SessionMetrics {
  return {
    stepsSaved: from.stepsSaved + (to.stepsSaved - from.stepsSaved) * p,
    estTimeSavedMin: from.estTimeSavedMin + (to.estTimeSavedMin - from.estTimeSavedMin) * p,
    estTokensSaved: from.estTokensSaved + (to.estTokensSaved - from.estTokensSaved) * p,
    manualInterventionsRemoved:
      from.manualInterventionsRemoved +
      (to.manualInterventionsRemoved - from.manualInterventionsRemoved) * p,
  };
}

/**
 * Counts the totals up to their new values over 400ms — instant when motion is not
 * wanted.
 *
 * `fromRef` holds what is actually on screen, written from inside the frame loop
 * rather than during render: a second APPLY landing mid-count continues from the
 * number the user can see instead of snapping back to where the last one started.
 */
function useCountUp(target: SessionMetrics): SessionMetrics {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    // Nothing to count — the first mount, or a version whose totals match the last.
    // Bailing here matters beyond tidiness: a frame loop started for a change of
    // zero still re-renders the toolbar on every frame it runs.
    if (PARTS.every((p) => from[p.key] === target[p.key])) return;
    if (prefersReducedMotion()) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    // The elapsed time is measured here rather than taken from the timestamp the
    // frame hands over: the two are the same clock in a browser, but not in jsdom,
    // and a tween that reads the wrong origin either finishes instantly or never.
    const step = () => {
      const p = Math.min(1, (performance.now() - start) / TWEEN_MS);
      const at = p >= 1 ? target : lerp(from, target, p);
      fromRef.current = at;
      setShown(at);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The numbers are listed alongside the object they came from: every apply hands
    // over a fresh SessionMetrics, and the guard above is what makes an identity
    // change with identical totals cost nothing.
  }, [
    target,
    target.stepsSaved,
    target.estTimeSavedMin,
    target.estTokensSaved,
    target.manualInterventionsRemoved,
  ]);

  return shown;
}

/**
 * What the applied patches took out of the workflow, stated as it accumulates.
 *
 * Only components that actually moved get a chip. Honest generations routinely
 * claim no token saving or no manual step removed, and a chip reading "−0 tok"
 * would turn that zero into a boast about nothing.
 *
 * The count-up is CEILED, not rounded, for the same reason: a saving of one step
 * spends the first half of its tween below 0.5, and `Math.round` renders that as
 * "−0 steps" — a falsehood held on screen for 200ms at the one moment the user is
 * watching this number. Ceiling cannot invent a saving here, because a component
 * whose TOTAL is zero never gets a chip at all: every tween that runs is between
 * two numbers on the same side of zero, so the ceiling of any frame of it is a
 * value the chip will honestly reach.
 */
export function ImpactMeter({ metrics }: { metrics: SessionMetrics }) {
  const shown = useCountUp(metrics);
  // Visibility is decided by the TOTALS, not by the tweened numbers — a chip that
  // waited for its count-up to leave zero would pop in a frame late.
  const parts = impactParts(metrics);
  if (parts.length === 0) return null;

  return (
    <span
      className="sg-impact"
      data-testid="impact-meter"
      role="group"
      aria-label="impact"
      // A patch applied from the drawer changes these totals while focus is still
      // in the panel, several hundred pixels away — without this the one thing an
      // APPLY visibly does is the one thing a screen reader is never told about.
      // Polite, because the graph morphing is the headline and this is its receipt.
      aria-live="polite"
    >
      {parts.map((p) => (
        <span className="sg-impact-chip" data-testid="impact-part" key={p.key}>
          {impactLabel(shown[p.key], p.unit)}
        </span>
      ))}
    </span>
  );
}
