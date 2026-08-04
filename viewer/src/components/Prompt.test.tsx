import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import { applyOn, cardFor, cardLabels, cardsOf, fixture, LAYOUT_WAIT, reduceMotion } from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

/**
 * The PROMPT surface, driven through the whole canvas: the toolbar toggle, the
 * rail it shares with the impact panel, the regeneration on every session move,
 * and the scorecard's frozen copy of the same deliverable. The assembly itself
 * is pinned string-by-string in graph/prompt.test.ts — what is under test here
 * is the wiring.
 */

const plain = fixture(gallery, 'gallery');
const enriched = fixture(enrichedDoc, 'enriched');

const RESEARCH = 'Research the libraries & read the docs';
const RESEARCH_MCP = 'Pull the docs in-session';

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';

/** V0's prompt: the fixture's authored opening, alone. */
const INTRO = enriched.meta.promptIntro!;

const promptText = () => screen.getByTestId('prompt-text').textContent;

it('offers PROMPT exactly where the impact panel stands, and toggles it in the rail', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  const button = screen.getByTestId('prompt-btn');
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByTestId('prompt-panel')).not.toBeInTheDocument();

  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-pressed', 'true');

  // the rail holds both: the impact panel first, the prompt under it — a column,
  // not a swap
  const rail = screen.getByTestId('canvas-rail');
  expect(rail).toContainElement(screen.getByTestId('impact-panel'));
  expect(rail).toContainElement(screen.getByTestId('prompt-panel'));

  // at V0 the prompt is the opening alone, shown honestly and labelled
  expect(promptText()).toBe(INTRO);
  expect(screen.getByTestId('prompt-none')).toHaveTextContent('NO UPGRADES APPLIED YET');

  fireEvent.click(button);
  expect(screen.queryByTestId('prompt-panel')).not.toBeInTheDocument();
  expect(screen.getByTestId('impact-panel')).toBeInTheDocument();
});

// No optimization story, no deliverable: the same gate the impact rail and
// OPTIMIZE already keep, kept by the third control that tells that story.
it('offers no PROMPT on a graph with nothing to apply', async () => {
  render(<GraphCanvas workflow={plain} />);
  await cardsOf(plain);
  expect(screen.queryByTestId('prompt-btn')).not.toBeInTheDocument();
});

it('regenerates when the version changes — apply and undo both move it', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(screen.getByTestId('prompt-btn'));
    expect(promptText()).toBe(INTRO);

    // what the panel must say once firecrawl's patch is on: the reducer is the
    // same one the canvas drives, so the expectation is built through it
    const applied = assemblePrompt(applySuggestion(createSession(enriched), FIRECRAWL));

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    expect(promptText()).toBe(applied);
    expect(screen.queryByTestId('prompt-none')).not.toBeInTheDocument();

    // and back: undo re-assembles for the shorter prefix, label and all
    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH), LAYOUT_WAIT);
    expect(promptText()).toBe(INTRO);
    expect(screen.getByTestId('prompt-none')).toBeInTheDocument();
  } finally {
    restore();
  }
});

// The rail stands at z5 and the drawer at z6: opening a step's detail must not
// cost the prompt its place — both are up, the drawer in front.
it('keeps the panel up while the drawer is open over it', async () => {
  render(<GraphCanvas workflow={enriched} />);
  const all = await cardsOf(enriched);
  fireEvent.click(screen.getByTestId('prompt-btn'));

  fireEvent.click(cardFor(RESEARCH, all));
  await screen.findByTestId('detail-drawer');

  expect(screen.getByTestId('prompt-panel')).toBeInTheDocument();
  expect(screen.getByTestId('impact-panel')).toBeInTheDocument();
});

it('gives the scorecard the same prompt, frozen, with its own copy', async () => {
  const restore = reduceMotion();
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(screen.getByTestId('optimize-btn'));
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

    // the instant tour lands firecrawl then chrome-devtools — the same walk
    // through the same reducer builds what the section must hold
    const ended = applySuggestion(applySuggestion(createSession(enriched), FIRECRAWL), DEVTOOLS);
    const expected = assemblePrompt(ended);

    expect(screen.getByTestId('scorecard-prompt')).toHaveTextContent('YOUR OPTIMIZED PROMPT');
    expect(screen.getByTestId('scorecard-prompt-text').textContent).toBe(expected);

    fireEvent.click(screen.getByTestId('scorecard-prompt-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(expected));
  } finally {
    delete (navigator as { clipboard?: unknown }).clipboard;
    restore();
  }
});
