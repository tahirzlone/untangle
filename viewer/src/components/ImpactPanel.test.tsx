import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ImpactSummary } from '../graph/metrics';
import { reduceMotion } from '../test/harness';
import { ImpactPanel } from './ImpactPanel';

const ZERO = {
  stepsSaved: 0,
  estTimeSavedMin: 0,
  estTokensSaved: 0,
  manualInterventionsRemoved: 0,
};

/** A session's readout, stated as a literal: the numbers are pinned in metrics.test.ts. */
function summary(over: Partial<ImpactSummary> = {}): ImpactSummary {
  return {
    perVersion: [{ index: 0, pain: 16, complexity: { nodes: 6, edges: 6 } }],
    at: 0,
    totals: { ...ZERO },
    painBefore: 16,
    painNow: 16,
    painPct: 0,
    complexityBefore: { nodes: 6, edges: 6 },
    complexityNow: { nodes: 6, edges: 6 },
    ...over,
  };
}

/** A session two patches in: pain 16 → 7 over three versions, cursor at the newest. */
function optimized(): ImpactSummary {
  return summary({
    perVersion: [
      { index: 0, pain: 16, complexity: { nodes: 6, edges: 6 } },
      { index: 1, pain: 9, complexity: { nodes: 5, edges: 4 } },
      { index: 2, pain: 7, complexity: { nodes: 4, edges: 4 } },
    ],
    at: 2,
    totals: {
      stepsSaved: 3,
      estTimeSavedMin: 42,
      estTokensSaved: 4900,
      manualInterventionsRemoved: 3,
    },
    painNow: 7,
    painPct: 56,
    complexityNow: { nodes: 4, edges: 4 },
  });
}

const stats = () =>
  screen.queryAllByTestId('impact-metric').map((el) => [
    el.getAttribute('data-part'),
    el.querySelector('.sg-impact-value')?.textContent,
    el.querySelector('.sg-impact-unit')?.textContent,
  ]);

/**
 * The count-up's frames, stepped by hand.
 *
 * The tween reads `performance.now()` and asks for frames, so both are taken over
 * here: what the panel says a tenth of the way through a count is then a fact about
 * the component, not a race with the machine the suite is running on.
 */
function handCranked() {
  const queue: FrameRequestCallback[] = [];
  let clock = 0;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    queue.push(cb);
    return queue.length;
  });
  const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  return {
    /** Runs the frame the tween is waiting on, as if `ms` had passed since the start. */
    at(ms: number) {
      const next = queue.shift();
      if (!next) throw new Error('the tween asked for no frame');
      clock = ms;
      act(() => next(ms));
    },
    restore() {
      raf.mockRestore();
      caf.mockRestore();
      now.mockRestore();
    },
  };
}

it('states the components that moved, at the size the news deserves', () => {
  render(<ImpactPanel summary={optimized()} />);

  expect(stats()).toEqual([
    ['stepsSaved', '3', 'steps'],
    ['estTimeSavedMin', '42', 'min'],
    ['estTokensSaved', '4900', 'tok'],
    ['manualInterventionsRemoved', '3', 'manual'],
  ]);
  expect(screen.queryByTestId('impact-none')).not.toBeInTheDocument();
});

// An honest generation routinely claims no token saving. A numeral reading "0 tok"
// would turn that zero into a boast about nothing.
it('leaves out a component the applied patches did not move', () => {
  render(
    <ImpactPanel
      summary={summary({ at: 1, totals: { ...ZERO, stepsSaved: 1, estTimeSavedMin: 25 } })}
    />,
  );

  expect(stats()).toEqual([
    // one of a thing, in the singular
    ['stepsSaved', '1', 'step'],
    ['estTimeSavedMin', '25', 'min'],
  ]);
});

it('says so plainly when there is nothing to say yet', () => {
  const { rerender } = render(<ImpactPanel summary={summary()} />);
  expect(screen.getByTestId('impact-none')).toHaveTextContent('NOTHING APPLIED YET');

  // a patch CAN restructure the graph while claiming nothing at all — the panel is
  // then reporting a version that landed, not a session that has not started
  rerender(<ImpactPanel summary={summary({ at: 1, painNow: 14, painPct: 13 })} />);
  expect(screen.getByTestId('impact-none')).toHaveTextContent('NO SAVING CLAIMED');
  // and the pain it DID take out is stated all the same — the percentage beside it
  // is counting up to 13, which is the tween's business and pinned above
  expect(screen.getByTestId('impact-pain')).toHaveTextContent('16 → 14');
});

// A patch can put a step in place of one that hurt less. Captioning that as a
// reduction of −(−12)% would be the panel reading a loss out as a win.
it('says so when a patch left the graph hurting more', () => {
  const frames = handCranked();
  try {
    const { rerender } = render(<ImpactPanel summary={summary()} />);
    rerender(<ImpactPanel summary={summary({ at: 1, painNow: 18, painPct: -13 })} />);
    frames.at(400);

    const pain = screen.getByTestId('impact-pain');
    expect(pain).toHaveTextContent('PAIN ADDED');
    expect(pain).toHaveTextContent('+13%');
    expect(pain).not.toHaveTextContent('REDUCED');
    expect(pain.querySelector('.sg-impact-tile-num')?.className).toContain(
      'sg-impact-tile-num--worse',
    );
  } finally {
    frames.restore();
  }
});

it('holds the pain and the complexity either side of the applied patches', () => {
  render(<ImpactPanel summary={optimized()} />);

  const pain = screen.getByTestId('impact-pain');
  expect(pain).toHaveTextContent('−56%');
  expect(pain).toHaveTextContent('16 → 7');

  const shape = screen.getByTestId('impact-complexity');
  expect(shape).toHaveTextContent('nodes 6 → 4');
  expect(shape).toHaveTextContent('edges 6 → 4');
});

// Regression: the numerals used to be rounded, so a saving of one step spent the
// first half of its tween below 0.5 and read "0" — a falsehood held on screen at
// the one moment the user is watching this number.
it('never states a zero on the way up to a saving of one', () => {
  const frames = handCranked();
  try {
    const { rerender } = render(<ImpactPanel summary={summary()} />);
    rerender(
      <ImpactPanel
        summary={summary({
          at: 1,
          totals: { ...ZERO, stepsSaved: 1, estTimeSavedMin: 25, manualInterventionsRemoved: 1 },
          painNow: 9,
          painPct: 44,
        })}
      />,
    );

    // 40ms in — a tenth of the way, where the tween's own value is 0.1 steps
    frames.at(40);
    expect(stats()).toEqual([
      ['stepsSaved', '1', 'step'],
      ['estTimeSavedMin', '3', 'min'],
      ['manualInterventionsRemoved', '1', 'manual'],
    ]);

    // and it lands exactly on the totals, not a unit above them
    frames.at(400);
    expect(stats()).toEqual([
      ['stepsSaved', '1', 'step'],
      ['estTimeSavedMin', '25', 'min'],
      ['manualInterventionsRemoved', '1', 'manual'],
    ]);
    expect(screen.getByTestId('impact-pain')).toHaveTextContent('−44%');
  } finally {
    frames.restore();
  }
});

it('lands on the new totals with no count at all when motion is not wanted', () => {
  const restore = reduceMotion();
  const frames = handCranked();
  try {
    const { rerender } = render(<ImpactPanel summary={summary()} />);
    rerender(<ImpactPanel summary={optimized()} />);

    // no frame was ever asked for — the numbers are simply there
    expect(() => frames.at(0)).toThrow('the tween asked for no frame');
    expect(stats()).toEqual([
      ['stepsSaved', '3', 'steps'],
      ['estTimeSavedMin', '42', 'min'],
      ['estTokensSaved', '4900', 'tok'],
      ['manualInterventionsRemoved', '3', 'manual'],
    ]);
  } finally {
    frames.restore();
    restore();
  }
});

it('draws a bar per version, marking the one on the canvas and dimming the future', () => {
  render(<ImpactPanel summary={summary({ ...optimized(), at: 1 })} />);

  const bars = screen.getAllByTestId('impact-bar');
  expect(bars.map((b) => b.textContent)).toEqual(['V016', 'V19', 'V27']);
  // each drawn against the pain the graph arrived with: 16, 9 and 7 of 16
  expect(
    bars.map((b) => b.querySelector<HTMLElement>('.sg-impact-bar-fill')?.style.width),
  ).toEqual(['100%', '56%', '44%']);

  expect(bars[1]).toHaveAttribute('aria-current', 'true');
  expect(bars[1].className).toContain('sg-impact-bar--at');
  // the version the cursor stepped back out of — still measured, still one click
  // away on the strip, and dimmed the same 0.45 the strip dims its chip by
  expect(bars[2].className).toContain('sg-impact-bar--future');
  expect(bars[0].className).not.toContain('sg-impact-bar--future');
});

// A single version has nothing to compare itself to, and a chart of one full bar
// would be a picture of no progress rather than of none made yet.
it('waits for a second version before drawing the chart', () => {
  render(<ImpactPanel summary={summary()} />);
  expect(screen.queryAllByTestId('impact-bar')).toHaveLength(0);
});

it('collapses to a tab that says what it is, and opens again', () => {
  render(<ImpactPanel summary={optimized()} />);
  const toggle = screen.getByTestId('impact-toggle');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');

  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveTextContent('IMPACT');
  expect(screen.getByTestId('impact-panel').className).toContain('sg-impact--closed');
  expect(screen.queryAllByTestId('impact-metric')).toHaveLength(0);

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryAllByTestId('impact-metric')).toHaveLength(4);
});

// The totals change while focus is in the drawer, hundreds of pixels away — and
// they change while the panel is collapsed, too. Without a live region that
// outlives the body, the one thing an APPLY visibly does goes unannounced.
it('announces the totals politely, open or shut', () => {
  render(<ImpactPanel summary={optimized()} />);
  const live = screen.getByTestId('impact-live');

  expect(live).toHaveAttribute('aria-live', 'polite');
  expect(live).toHaveTextContent('−3 steps, −42 min, −4900 tok, −3 manual, pain −56%');

  fireEvent.click(screen.getByTestId('impact-toggle'));
  expect(screen.getByTestId('impact-live')).toHaveTextContent('pain −56%');
});

it('announces nothing to celebrate before the first patch lands', () => {
  render(<ImpactPanel summary={summary()} />);
  expect(screen.getByTestId('impact-live')).toHaveTextContent('nothing applied yet');
});
