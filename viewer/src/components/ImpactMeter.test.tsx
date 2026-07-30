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
    expect(meter).toHaveTextContent('−1 steps');
    expect(meter).toHaveTextContent('−1 manual');
    expect(meter).toHaveTextContent('−3 min');
    expect(meter).not.toHaveTextContent('−0');

    // and it lands exactly on the totals, not a unit above them
    frames.at(400);
    expect(meter).toHaveTextContent('−1 steps');
    expect(meter).toHaveTextContent('−25 min');
    expect(meter).toHaveTextContent('−1 manual');
    // the component whose total is zero never had a chip to count
    expect(meter).not.toHaveTextContent('tok');
    expect(screen.getAllByTestId('impact-part')).toHaveLength(3);
  } finally {
    frames.restore();
  }
});
