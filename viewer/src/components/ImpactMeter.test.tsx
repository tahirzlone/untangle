import { act, render, screen } from '@testing-library/react';
import type { SessionMetrics } from '../graph/apply';
import { ImpactMeter } from './ImpactMeter';

const ZERO: SessionMetrics = {
  stepsSaved: 0,
  estTimeSavedMin: 0,
  estTokensSaved: 0,
  manualInterventionsRemoved: 0,
};

/**
 * The count-up's frames, stepped by hand.
 *
 * The tween reads `performance.now()` and asks for frames, so both are taken over
 * here: what the meter says a tenth of the way through a count is then a fact about
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

// Regression: the display used to be rounded, so a saving of one step spent the first
// half of its 400ms tween below 0.5 and the meter read "−0 steps" — a falsehood held on
// screen at the one moment the user is watching this number.
it('never states a zero on the way up to a saving of one', () => {
  const frames = handCranked();
  try {
    const { rerender } = render(<ImpactMeter metrics={ZERO} />);
    rerender(
      <ImpactMeter
        metrics={{ ...ZERO, stepsSaved: 1, estTimeSavedMin: 25, manualInterventionsRemoved: 1 }}
      />,
    );

    // 40ms in — a tenth of the way, where the tween's own value is 0.1 steps
    frames.at(40);
    const meter = screen.getByTestId('impact-meter');
    expect(meter).toHaveTextContent('−1 step');
    expect(meter).toHaveTextContent('−1 manual');
    expect(meter).toHaveTextContent('−3 min');
    expect(meter).not.toHaveTextContent('−0');

    // and it lands exactly on the totals, not a unit above them
    frames.at(400);
    expect(meter).toHaveTextContent('−1 step');
    expect(meter).toHaveTextContent('−25 min');
    expect(meter).toHaveTextContent('−1 manual');
    // the component whose total is zero never had a chip to count
    expect(meter).not.toHaveTextContent('tok');
    expect(screen.getAllByTestId('impact-part')).toHaveLength(3);
  } finally {
    frames.restore();
  }
});

// "−1 steps" is the number the eye lands on first and it is simply wrong. Only
// that unit has a singular: a saving of one minute is "−1 min", not "−1 mins".
it('writes one of a thing in the singular, and only where there is one', () => {
  const parts = () => screen.getAllByTestId('impact-part').map((el) => el.textContent);

  // A first mount carries the totals straight through — nothing to count up from —
  // so each of these is the finished chip, not a frame of a tween.
  const one = render(
    <ImpactMeter
      metrics={{ ...ZERO, stepsSaved: 1, estTimeSavedMin: 1, manualInterventionsRemoved: 1 }}
    />,
  );
  expect(parts()).toEqual(['−1 step', '−1 min', '−1 manual']);
  one.unmount();

  render(
    <ImpactMeter
      metrics={{ ...ZERO, stepsSaved: 2, estTimeSavedMin: 2, manualInterventionsRemoved: 2 }}
    />,
  );
  expect(parts()).toEqual(['−2 steps', '−2 min', '−2 manual']);
});

// The totals change while focus is in the drawer, hundreds of pixels away. Without
// this the one thing an APPLY visibly does goes unannounced.
it('announces the running total politely', () => {
  render(<ImpactMeter metrics={{ ...ZERO, stepsSaved: 2 }} />);
  expect(screen.getByTestId('impact-meter')).toHaveAttribute('aria-live', 'polite');
});
