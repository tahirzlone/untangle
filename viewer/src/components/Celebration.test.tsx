import { render, screen, waitFor } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applyOn, cardsOf, fixture, LAYOUT_WAIT, reduceMotion } from '../test/harness';
import { GraphCanvas } from './GraphCanvas';
import { FLOAT_MS, FLOAT_STAGGER_MS } from './motion';

/** The KB-matched graph: the docs MCP saves a step, 25 minutes and a manual pass. */
const enriched = fixture(enrichedDoc, 'enriched');

const RESEARCH = 'Research the libraries & read the docs';

/** Long enough for the longest burst to have risen and been dropped. */
const FLOAT_GONE = { timeout: FLOAT_MS + 4 * FLOAT_STAGGER_MS + 2000 };

const lines = () =>
  [...document.querySelectorAll('.sg-float-line')].map((el) => el.textContent);

it('raises what the patch saved off the step it was applied to', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  expect(screen.queryByTestId('celebration-layer')).not.toBeInTheDocument();

  await applyOn(RESEARCH);

  await waitFor(() => expect(screen.getByTestId('celebration')).toBeInTheDocument(), LAYOUT_WAIT);
  // the row's own claim, in the same words every other surface writes a saving in —
  // and the token saving it honestly claims none of is not among them
  expect(lines()).toEqual(['−1 step', '−25 min', '−1 manual']);

  // never a target, and never announced: the panel's live region says this once,
  // in words, and a number rising past the cursor must not swallow the next click
  expect(screen.getByTestId('celebration-layer')).toHaveAttribute('aria-hidden', 'true');
});

it('takes the floats away again on their own', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  await applyOn(RESEARCH);
  await waitFor(() => expect(screen.getByTestId('celebration')).toBeInTheDocument(), LAYOUT_WAIT);

  await waitFor(
    () => expect(screen.queryByTestId('celebration-layer')).not.toBeInTheDocument(),
    FLOAT_GONE,
  );
});

it('raises nothing at all when motion is not wanted', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await applyOn(RESEARCH);
    // the patch still lands — it is the celebration that is skipped, not the work
    await waitFor(() => expect(screen.getByTestId('version-strip')).toBeInTheDocument());

    expect(screen.queryByTestId('celebration-layer')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});
