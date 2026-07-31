import { useEffect, useMemo, useRef, useState } from 'react';
import {
  impactLabel,
  impactParts,
  impactUnit,
  painLabel,
  type ImpactSummary,
} from '../graph/metrics';
// the canvas's own reader, not a second copy of the same media query
import { prefersReducedMotion } from './motion';
import './impact.css';

/** How long the numerals take to reach a new total. */
const TWEEN_MS = 400;

/** Every number the panel counts up, in one object so one tween drives them all. */
type Readout = Record<string, number>;

function lerp(from: Readout, to: Readout, p: number): Readout {
  const at: Readout = {};
  for (const key of Object.keys(to)) at[key] = from[key] + (to[key] - from[key]) * p;
  return at;
}

function same(a: Readout, b: Readout): boolean {
  return Object.keys(b).every((key) => a[key] === b[key]);
}

/**
 * Counts the readout up to its new values over 400ms — instant when motion is not
 * wanted.
 *
 * `fromRef` holds what is actually on screen, written from inside the frame loop
 * rather than during render: a second APPLY landing mid-count continues from the
 * number the user can see instead of snapping back to where the last one started.
 *
 * The effect keys on the target's IDENTITY, which is why the caller memoizes it on
 * the values: the loop re-renders the panel on every frame, and a target rebuilt
 * per render would start a second loop from each of those frames.
 */
function useCountUp(target: Readout): Readout {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    // Nothing to count — the first mount, or a version whose figures match the
    // last. Bailing here matters beyond tidiness: a frame loop started for a
    // change of zero still re-renders the panel on every frame it runs.
    if (same(from, target)) return;
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
  }, [target]);

  return shown;
}

/** The share of the tallest bar this version's pain fills. */
function barWidth(pain: number, peak: number): string {
  return `${peak > 0 ? Math.round((pain / peak) * 100) : 0}%`;
}

/**
 * What the applied patches have done to the workflow, stated at the size the news
 * deserves.
 *
 * The panel is the metrics' home: the numbers used to be four chips in a toolbar
 * beside the graph's title, which is where a caption goes, not a result. Here they
 * are the second thing on the screen after the graph itself — large numerals for
 * what was saved, the pain the work started with against the pain it costs now,
 * and a bar per version so the walk from the original is a shape rather than a
 * number that changed while you were looking elsewhere.
 *
 * Only components that actually MOVED are stated, which is the same honesty rule
 * the chips were built on: an honest generation routinely claims no token saving,
 * and a numeral reading "0 tok" would turn that zero into a boast about nothing.
 *
 * Collapsible, because it stands over the right side of the graph and a step
 * underneath it is a step you cannot read. Collapsed it is a slim tab with the
 * same title on it — the way back is where the way out was.
 */
export function ImpactPanel({ summary }: { summary: ImpactSummary }) {
  const [open, setOpen] = useState(true);
  const { totals, perVersion } = summary;

  // Memoized on the values, not rebuilt per render: see the note on `useCountUp`.
  const target = useMemo<Readout>(
    () => ({ ...totals, painPct: summary.painPct }),
    [totals, summary.painPct],
  );
  const shown = useCountUp(target);

  // Which numerals appear is decided by the TOTALS, not by the tweened numbers — a
  // numeral that waited for its count-up to leave zero would pop in a frame late.
  const parts = impactParts(totals);
  const painPct = Math.ceil(shown.painPct);
  const peak = perVersion.reduce((m, v) => Math.max(m, v.pain), 0);

  /**
   * The announcement, and the only part of the panel a screen reader is TOLD about
   * rather than left to find.
   *
   * Off-screen and always mounted, collapsed or not: the totals change while focus
   * is in the drawer, hundreds of pixels away, and a live region that unmounted
   * with the body would go quiet exactly when the panel is out of the way. Polite,
   * because the graph morphing is the headline and this is its receipt.
   *
   * It states the TOTALS rather than the numerals on screen — the tween is a thing
   * to watch, not a thing to hear counted.
   */
  const spoken =
    summary.at === 0
      ? 'nothing applied yet'
      : [
          ...parts.map((p) => impactLabel(totals[p.key], p.unit)),
          `pain ${painLabel(summary.painPct)}`,
        ].join(', ');

  return (
    <section
      className={`sg-impact${open ? '' : ' sg-impact--closed'}`}
      data-testid="impact-panel"
      aria-label="impact"
    >
      <span className="sg-impact-live" data-testid="impact-live" aria-live="polite">
        {spoken}
      </span>
      <button
        type="button"
        className="sg-impact-tab"
        data-testid="impact-toggle"
        aria-expanded={open}
        aria-controls="sg-impact-body"
        aria-label={open ? 'collapse impact' : 'expand impact'}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="sg-impact-title">IMPACT</span>
        <span className="sg-impact-chev" aria-hidden="true">
          {open ? '›' : '‹'}
        </span>
      </button>

      {open ? (
        <div className="sg-impact-body" id="sg-impact-body">
          {parts.length > 0 ? (
            <div className="sg-impact-stats">
              {parts.map((p) => {
                const value = Math.ceil(shown[p.key]);
                return (
                  <div
                    className="sg-impact-stat"
                    data-testid="impact-metric"
                    data-part={p.key}
                    key={p.key}
                  >
                    <span className="sg-impact-num">
                      {/* The direction, said once. The numeral itself carries no
                          minus: an arrow and a sign in front of the same figure is
                          the same fact stated twice. */}
                      <span className="sg-impact-arrow" aria-hidden="true">
                        ↓
                      </span>
                      <span className="sg-impact-value">{value}</span>
                    </span>
                    <span className="sg-impact-unit">{impactUnit(value, p.unit)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="sg-impact-none" data-testid="impact-none">
              {summary.at === 0 ? 'NOTHING APPLIED YET' : 'NO SAVING CLAIMED'}
            </p>
          )}

          <div className="sg-impact-tiles">
            <div className="sg-impact-tile" data-testid="impact-pain">
              {/* A patch may put a step in place of one that hurt less, and the
                  summary reports that as a negative reduction — so the tile says
                  what actually happened rather than captioning it as a win. */}
              <span className="sg-impact-cap">{painPct < 0 ? 'PAIN ADDED' : 'PAIN REDUCED'}</span>
              <span
                className={`sg-impact-tile-num${painPct < 0 ? ' sg-impact-tile-num--worse' : ''}`}
              >
                {painLabel(painPct)}
              </span>
              <span className="sg-impact-tile-sub">
                {summary.painBefore} → {summary.painNow}
              </span>
            </div>
            <div className="sg-impact-tile" data-testid="impact-complexity">
              <span className="sg-impact-cap">COMPLEXITY</span>
              {/* Two counts, never one score: a single number combining steps and
                  the connections between them would be a unit nobody uses. */}
              <span className="sg-impact-tile-sub">
                nodes {summary.complexityBefore.nodes} → {summary.complexityNow.nodes}
              </span>
              <span className="sg-impact-tile-sub">
                edges {summary.complexityBefore.edges} → {summary.complexityNow.edges}
              </span>
            </div>
          </div>

          {/* One bar per version, each drawn against the pain the graph arrived
              with: the accent is what the work still costs and the track behind it
              is what the applied patches took off. A single version has nothing to
              compare itself to, so the chart waits for the first apply. */}
          {perVersion.length > 1 ? (
            <div className="sg-impact-chart">
              <span className="sg-impact-cap">PAIN BY VERSION</span>
              <ul className="sg-impact-bars">
                {perVersion.map((v) => (
                  <li
                    className={`sg-impact-bar${v.index === summary.at ? ' sg-impact-bar--at' : ''}${
                      v.index > summary.at ? ' sg-impact-bar--future' : ''
                    }`}
                    data-testid="impact-bar"
                    aria-current={v.index === summary.at ? 'true' : undefined}
                    key={v.index}
                  >
                    <span className="sg-impact-bar-label">V{v.index}</span>
                    <span className="sg-impact-bar-track">
                      <span
                        className="sg-impact-bar-fill"
                        style={{ width: barWidth(v.pain, peak) }}
                      />
                    </span>
                    <span className="sg-impact-bar-value">{v.pain}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
