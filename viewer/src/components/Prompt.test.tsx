import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import {
  applyOn,
  cardFor,
  cardLabels,
  cardsOf,
  fixture,
  LAYOUT_WAIT,
  reduceMotion,
} from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

/**
 * The PROMPT surface, driven through the whole canvas: the toolbar button that
 * opens the Results Window at any cursor, the live re-assembly on every session
 * move, and the per-session life of the include ticks. The window's own
 * behaviour — rows, panes, focus trap — is pinned in ResultsWindow.test.tsx;
 * what is under test here is the wiring.
 */

/** A graph with no KB behind it: the gallery graph, suggestions stripped. */
const plain = fixture(
  { ...gallery, meta: { ...gallery.meta, kbSource: 'none' }, suggestions: [] },
  'gallery',
);
const enriched = fixture(enrichedDoc, 'enriched');

const RESEARCH = 'Research the libraries & read the docs';
const RESEARCH_MCP = 'Pull the docs in-session';

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';

/** V0's prompt: the fixture's authored opening, alone. */
const INTRO = enriched.meta.promptIntro!;

const afterText = () => screen.getByTestId('results-after').textContent;

const openWindow = () => fireEvent.click(screen.getByTestId('prompt-btn'));
const closeWindow = async () => {
  fireEvent.click(screen.getByTestId('results-close'));
  await waitFor(() => expect(screen.queryByTestId('results-window')).not.toBeInTheDocument());
};

it('opens the window from PROMPT at any cursor — V0 included, honestly', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  expect(screen.queryByTestId('results-window')).not.toBeInTheDocument();
  openWindow();

  // V0 is a valid state, said plainly: no upgrades, no resources, and the
  // panes are up anyway — the task as a prompt is a valid prompt
  const windowEl = screen.getByTestId('results-window');
  expect(windowEl).toBeInTheDocument();
  expect(screen.getByTestId('results-none')).toHaveTextContent('NO UPGRADES APPLIED YET');
  expect(screen.getByTestId('results-rows-none')).toHaveTextContent('NO RESOURCES APPLIED YET');
  expect(screen.getByTestId('results-before').textContent).toBe(enriched.meta.task);
  expect(afterText()).toBe(INTRO);

  await closeWindow();
});

/**
 * A panel open when PROMPT is pressed does not survive under the window.
 *
 * It would be invisible there — z6 under a z9 backdrop — and, worse, its Escape
 * listener sits on the window, where `inert` cannot reach it: inert stops focus
 * and pointers, not window listeners. Left mounted, ONE Escape aimed at the
 * results window would take the unseen panel down with it and try to hand focus
 * to a card the inert canvas refuses. So the window closes it on the way in, the
 * way OPTIMIZE does, and the keystroke has exactly one thing to close.
 */
it('closes a drawer left open, so one Escape closes only the window', async () => {
  render(<GraphCanvas workflow={enriched} />);
  const all = await cardsOf(enriched);

  // a step no patch touches, so nothing but the window itself shuts this panel
  fireEvent.click(cardFor('Gather the brief', all));
  await screen.findByTestId('detail-drawer');

  openWindow();
  expect(screen.getByTestId('results-window')).toBeInTheDocument();
  expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('results-window')).not.toBeInTheDocument());
  // the panel neither came back nor was closed behind the user's back — it was
  // already gone — and focus lands where every route out of the window sends it
  expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
  expect(document.activeElement).toBe(screen.getByTestId('prompt-btn'));
});

// No optimization story, no deliverable: the same gate the impact rail and
// OPTIMIZE already keep, kept by the third control that tells that story.
it('offers no PROMPT on a graph with nothing to apply', async () => {
  render(<GraphCanvas workflow={plain} />);
  await cardsOf(plain);
  expect(screen.queryByTestId('prompt-btn')).not.toBeInTheDocument();
});

it('reads the live session — apply and undo both move the AFTER pane', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    openWindow();
    expect(afterText()).toBe(INTRO);
    await closeWindow();

    // what the pane must say once firecrawl's patch is on: the reducer is the
    // same one the canvas drives, so the expectation is built through it
    const applied = assemblePrompt(applySuggestion(createSession(enriched), FIRECRAWL));

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    openWindow();
    expect(afterText()).toBe(applied);
    expect(screen.queryByTestId('results-none')).not.toBeInTheDocument();
    await closeWindow();

    // and back: undo re-assembles for the shorter prefix, empty state and all
    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH), LAYOUT_WAIT);
    openWindow();
    expect(afterText()).toBe(INTRO);
    expect(screen.getByTestId('results-none')).toBeInTheDocument();
  } finally {
    restore();
  }
});

/**
 * The ticks are per SESSION, not per viewing: a choice about a command survives
 * the window closing, and survives the cursor stepping away and back — the set
 * names resources by record id, an id names one resource carrying one command,
 * and an entry whose row the cursor stepped away from simply goes inert until a
 * redo brings the row back. Pinned as the decision the brief left open.
 */
it('keeps a cleared tick across close, reopen, and a cursor round trip', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

    openWindow();
    const excluded = assemblePrompt(applySuggestion(createSession(enriched), FIRECRAWL), {
      excludeInstalls: new Set([FIRECRAWL]),
    });
    fireEvent.click(screen.getByTestId('results-check'));
    expect(screen.getByTestId('results-check')).not.toBeChecked();
    expect(afterText()).toBe(excluded);
    await closeWindow();

    // reopen: the choice is still standing — the window did not forget it
    openWindow();
    expect(screen.getByTestId('results-check')).not.toBeChecked();
    expect(afterText()).toBe(excluded);
    await closeWindow();

    // step off the version and back: the row leaves and returns, and the
    // answer already given about its command returns with it
    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH), LAYOUT_WAIT);
    openWindow();
    expect(screen.getByTestId('results-rows-none')).toBeInTheDocument();
    await closeWindow();

    fireEvent.click(screen.getByTestId('redo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    openWindow();
    expect(screen.getByTestId('results-check')).not.toBeChecked();
    expect(afterText()).toBe(excluded);
  } finally {
    restore();
  }
});

// A new file is a new set of questions: nothing ticked about one workflow's
// rows may answer for another's.
it('starts the ticks fresh when a different workflow arrives', async () => {
  const restore = reduceMotion();
  try {
    const { rerender } = render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

    openWindow();
    fireEvent.click(screen.getByTestId('results-check'));
    expect(screen.getByTestId('results-check')).not.toBeChecked();
    await closeWindow();

    // another graph, then the same one again — a NEW object, as a fresh load is
    rerender(<GraphCanvas workflow={plain} />);
    await cardsOf(plain);
    const again = fixture(enrichedDoc, 'enriched-again');
    rerender(<GraphCanvas workflow={again} />);
    await cardsOf(again);

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    openWindow();
    expect(screen.getByTestId('results-check')).toBeChecked();
  } finally {
    restore();
  }
});

// The rail is the impact panel's alone now: the prompt and the kit live in the
// window, and nothing of the retired panels is left to render.
it('hosts only the impact panel in the rail', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

    const rail = screen.getByTestId('canvas-rail');
    expect(rail).toContainElement(screen.getByTestId('impact-panel'));
    expect(screen.queryByTestId('prompt-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('install-kit')).not.toBeInTheDocument();
    // PROMPT is an opener now, not a toggle: no pressed state to announce
    expect(screen.getByTestId('prompt-btn')).not.toHaveAttribute('aria-pressed');

    // and the window draws OVER the canvas rather than standing in the rail
    openWindow();
    expect(rail).not.toContainElement(screen.getByTestId('results-window'));
  } finally {
    restore();
  }
});
