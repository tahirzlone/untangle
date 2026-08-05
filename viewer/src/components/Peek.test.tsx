import { act, fireEvent, render, screen } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { cardFor, cardsOf, fixture, mouse } from '../test/harness';
import { GraphCanvas } from './GraphCanvas';
import { PeekCard, peekAnchor, PEEK_DELAY_MS, PEEK_GAP, PEEK_WIDTH } from './PeekCard';
import type { Suggestion } from '../graph/types';

/** The KB-matched graph: two rows on one step, one on another, three steps with none. */
const enriched = fixture(enrichedDoc, 'enriched');

const RESEARCH = 'Research the libraries & read the docs';
const VERIFY = 'Verify it by hand in the browser';
/** A step the KB matched nothing to. */
const BRIEF = 'Gather the brief & acceptance criteria';

const rows = (nodeId: string): Suggestion[] =>
  enriched.suggestions.filter((s) => s.nodeId === nodeId);

const card = (label: string) => cardFor(label, screen.getAllByTestId('sg-node'));

/**
 * Rests the pointer on a card and waits out the intent delay.
 *
 * `mouseOver`, not `mouseEnter`: React synthesizes enter and leave from the
 * bubbling over/out pair, so a fired `mouseenter` reaches no handler at all.
 */
function rest(el: HTMLElement) {
  fireEvent.mouseOver(el);
  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS);
  });
}

/**
 * The canvas, painted, with the clock in hand from that point on.
 *
 * The layout pass runs on the REAL clock first: ELK is async, and a suite that
 * takes the timers away before it answers waits for a graph that never arrives.
 */
async function canvas() {
  const view = render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  vi.useFakeTimers();
  return view;
}

/**
 * Moves the world under the pointer, the way a wheel does.
 *
 * A real wheel event on React Flow's own pane: d3-zoom answers it, React Flow
 * reports the new viewport through `onMove`, and that is the handler under test.
 * Nothing here reaches past the pane — the whole route is React Flow's.
 */
function zoomPane(container: HTMLElement) {
  fireEvent.wheel(container.querySelector('.react-flow__renderer')!, { deltaY: -120 });
}

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Where it stands
// ---------------------------------------------------------------------------

it('stands ahead of the card, on the side the work runs toward', () => {
  const at = peekAnchor({ left: 300, right: 552, top: 180 }, 1400);
  expect(at).toEqual({ x: 552 + PEEK_GAP, y: 180 });
});

// A card near the right edge would put the peek half off the screen, so it takes
// the space behind the card instead — the graph is still readable either side.
it('flips behind the card when there is no room ahead of it', () => {
  const at = peekAnchor({ left: 900, right: 1152, top: 40 }, 1200);
  expect(at).toEqual({ x: 900 - PEEK_GAP - PEEK_WIDTH, y: 40 });
});

it('holds at the window margin when neither side fits', () => {
  const at = peekAnchor({ left: 10, right: 262, top: 0 }, 300);
  expect(at.x).toBe(PEEK_GAP);
});

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

it('states the row: what it is, what it claims, and what it saves', () => {
  const [row] = rows('research-docs');
  render(<PeekCard suggestions={[row]} at={{ x: 0, y: 0 }} />);

  const peek = screen.getByTestId('sg-peek');
  expect(peek).toHaveTextContent(row.name);
  expect(peek).toHaveTextContent(row.claim);
  // the chip is the drawer's own, so a row reads the same colour wherever it is named
  expect(screen.getByTestId('sg-sug-cat')).toHaveTextContent(row.category);
  // the first component the row actually moved, in the impact meter's own order
  expect(screen.getByTestId('sg-peek-metric')).toHaveTextContent('−1 step');
  expect(peek).toHaveTextContent('CLICK FOR DETAILS');
  // pointer-only: the drawer is what a screen reader is told about
  expect(peek).toHaveAttribute('aria-hidden', 'true');
});

// Two rows on one step is two futures for the same moment, and there is room for
// one of them — the count is what keeps the silence from reading as "that's all".
it('says how many rows it is not showing', () => {
  const two = rows('verify-browser');
  expect(two).toHaveLength(2);

  const { rerender } = render(<PeekCard suggestions={two} at={{ x: 0, y: 0 }} />);
  expect(screen.getByTestId('sg-peek-more')).toHaveTextContent('+1 more');
  expect(screen.getByTestId('sg-peek-name')).toHaveTextContent(two[0].name);

  rerender(<PeekCard suggestions={[two[0]]} at={{ x: 0, y: 0 }} />);
  expect(screen.queryByTestId('sg-peek-more')).not.toBeInTheDocument();
});

it('states no saving for a row that claims none', () => {
  const [row] = rows('research-docs');
  render(
    <PeekCard
      suggestions={[
        {
          ...row,
          effect: {
            ...row.effect,
            metrics: {
              stepsSaved: 0,
              estTimeSavedMin: 0,
              estTokensSaved: 0,
              manualInterventionsRemoved: 0,
            },
          },
        },
      ]}
      at={{ x: 0, y: 0 }}
    />,
  );
  expect(screen.queryByTestId('sg-peek-metric')).not.toBeInTheDocument();
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();
});

it('raises nothing at all for a step the KB matched nothing to', () => {
  render(<PeekCard suggestions={[]} at={{ x: 0, y: 0 }} />);
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// When it opens
// ---------------------------------------------------------------------------

it('opens only once the pointer has rested the intent delay out', async () => {
  await canvas();

  fireEvent.mouseOver(card(RESEARCH));
  // a pointer crossing the graph passes over cards in a few frames each — one
  // frame short of the delay is still a pass-through
  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS - 1);
  });
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByTestId('sg-peek')).toHaveTextContent(rows('research-docs')[0].name);
});

it('drops the peek the moment the pointer leaves — no delay on the way out', async () => {
  await canvas();

  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();

  fireEvent.mouseOut(card(RESEARCH));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

it('cancels a peek the pointer left before it opened', async () => {
  await canvas();

  fireEvent.mouseOver(card(RESEARCH));
  fireEvent.mouseOut(card(RESEARCH));
  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS * 4);
  });
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

// The pip is the whole claim on an unmatched card: there is nothing behind it,
// so a peek would be a panel about nothing.
it('never opens on a step the KB matched nothing to', async () => {
  await canvas();

  rest(card(BRIEF));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

// The keyboard route is the drawer, unchanged: a peek raised by focus would talk
// over the panel a Tab-and-Enter is on its way to opening.
it('is not raised by the keyboard', async () => {
  await canvas();

  const wrapper = card(RESEARCH).closest('.react-flow__node') as HTMLElement;
  act(() => wrapper.focus());
  // the keyboard really is on the card the KB matched — this is the case a focus
  // handler would have raised a peek for
  expect(document.activeElement).toBe(wrapper);

  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS * 4);
  });
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// When it stays out of the way
// ---------------------------------------------------------------------------

/**
 * The panel is the commit path and it states the same row in full — the peek
 * standing beside it would be that row said twice, and at z8 over the drawer's
 * z6 it would stand ON it.
 *
 * The second half is the case a hide at the click cannot answer, and the reason
 * the drawer is in `peekSuppressed` rather than handled at the press: opening the
 * panel re-frames the canvas, the cards slide out from under a pointer that never
 * moved, and the browser dispatches genuine boundary events for whichever card
 * arrives under it. That enter is indistinguishable from a real one, so the only
 * honest answer is a mode that keeps refusing for as long as the panel is open.
 */
it('gives way to the drawer the click opens, and stays away while it is open', async () => {
  await canvas();

  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();

  fireEvent.click(card(RESEARCH));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
  expect(screen.getByTestId('detail-drawer')).toHaveTextContent(RESEARCH);

  // the boundary events the re-frame produces, arriving on the panel's own step
  rest(card(RESEARCH));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  // and on any other step the cards slid under the pointer
  rest(card(VERIFY));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  // the panel closed, the canvas is a graph to browse again
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
  rest(card(VERIFY));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();
});

// While the tour drives the canvas it owns it: the camera is travelling and the
// cards are mid-morph, and a panel popping up under the pointer would be a
// second thing moving. A peek already open when the run starts goes with it.
it('stays down while the tour has the canvas', async () => {
  await canvas();

  rest(card(VERIFY));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();

  fireEvent.click(screen.getByTestId('optimize-btn'));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  rest(card(VERIFY));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();
});

/**
 * The one gesture that moves the graph without moving the pointer.
 *
 * The anchor is a one-shot snapshot in screen coordinates, taken when the pointer
 * settled and never re-measured — so a wheel zoom scales the card out from under
 * a panel still pointing at where the step used to be, and because the pointer
 * itself never moved there is no boundary event coming to take it down.
 */
it('goes when the viewport moves under it', async () => {
  const { container } = await canvas();

  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();

  zoomPane(container);
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  // and the one still waiting out its delay goes with it: the pointer rested on
  // a card that is no longer where it rested
  fireEvent.mouseOver(card(VERIFY));
  zoomPane(container);
  act(() => {
    vi.advanceTimersByTime(PEEK_DELAY_MS * 4);
  });
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  // the canvas is still a graph to ask about — the pointer settling again after
  // the move is a new question, and it gets an answer
  rest(card(VERIFY));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();
});

/**
 * A second file dropped on the viewer replaces the graph without unmounting the
 * canvas, and the selection was made on the graph that left. The drawer's own
 * subject is derived per version, so the panel goes — but an id left standing
 * suppresses the peek across the WHOLE canvas, with nothing on screen to explain
 * the silence.
 */
it('answers again on a graph that replaced the one a step was selected on', async () => {
  const { rerender } = render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  fireEvent.click(card(RESEARCH));
  expect(screen.getByTestId('detail-drawer')).toHaveTextContent(RESEARCH);

  // the same document, PARSED again: a drop hands the canvas a fresh object
  // rather than the one it is already holding, and the swap is keyed on that
  // identity. Same content, so the new graph still HAS the selected step — which
  // leaves the swap itself as the only thing that can drop the selection.
  const dropped = fixture(structuredClone(enrichedDoc), 'enriched again');
  rerender(<GraphCanvas workflow={dropped} />);
  await cardsOf(dropped);
  expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();

  vi.useFakeTimers();
  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toHaveTextContent(rows('research-docs')[0].name);
});

// A pointer on a card mid-drag is doing something, not asking something — and a
// panel that followed the card would be a second thing moving under the hand.
it('stays down while a card is being dragged, and comes back after', async () => {
  await canvas();

  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();

  const wrapper = card(RESEARCH).closest('.react-flow__node') as HTMLElement;
  act(() => {
    mouse('mouseDown', wrapper, 100);
    mouse('mouseMove', window, 260);
  });
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  // resting on the card mid-drag raises nothing either
  rest(card(RESEARCH));
  expect(screen.queryByTestId('sg-peek')).not.toBeInTheDocument();

  act(() => {
    mouse('mouseUp', window, 260);
  });
  rest(card(RESEARCH));
  expect(screen.getByTestId('sg-peek')).toBeInTheDocument();
});
