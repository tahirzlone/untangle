import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession } from '../graph/apply';
import { impactSummary } from '../graph/metrics';
import { assemblePrompt } from '../graph/prompt';
import { applyOn, cardFor, cardLabels, cardsOf, fixture, LAYOUT_WAIT, mockClipboard, reduceMotion } from '../test/harness';
import { GraphCanvas } from './GraphCanvas';
import { Scorecard } from './Scorecard';

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
const VERIFY = 'Verify it by hand in the browser';
const VERIFY_DEVTOOLS = 'Verify in a driven browser';

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';

/** V0's prompt: the fixture's authored opening, alone. */
const INTRO = enriched.meta.promptIntro!;

const promptText = () => screen.getByTestId('prompt-text').textContent;
const kitNames = () =>
  screen.getAllByTestId('kit-row').map((el) => el.querySelector('label')?.textContent);

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

/**
 * The kit through the whole canvas: the PROMPT toggle is the only route to it,
 * and what it lists is read off the SESSION rather than off the order APPLY was
 * pressed in — the patches land verify-first here, and the kit still reads in the
 * order the prompt above it introduces them.
 */
it('reveals the install kit with the panel, holding the run\'s rows in flow order', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(screen.getByTestId('prompt-btn'));

    // at V0 there is nothing applied, so there is nothing to install
    expect(screen.queryByTestId('install-kit')).not.toBeInTheDocument();

    await applyOn(VERIFY);
    await waitFor(() => expect(cardLabels()).toContain(VERIFY_DEVTOOLS), LAYOUT_WAIT);
    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

    // a section of the panel, not a surface of its own
    expect(screen.getByTestId('prompt-panel')).toContainElement(screen.getByTestId('install-kit'));
    expect(kitNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    expect(screen.getAllByTestId('kit-check').every((box) => (box as HTMLInputElement).checked)).toBe(
      true,
    );

    // and it leaves with the panel it is a section of
    fireEvent.click(screen.getByTestId('prompt-btn'));
    expect(screen.queryByTestId('install-kit')).not.toBeInTheDocument();
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
  const clip = mockClipboard(() => Promise.resolve());
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
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(expected));
  } finally {
    clip.restore();
    restore();
  }
});

// The pre-flight for the prompt above it, frozen with the rest of the report: the
// reader this panel is written for takes both and leaves.
it('adds the whole run\'s install kit to the scorecard, with its own copy', async () => {
  const restore = reduceMotion();
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(screen.getByTestId('optimize-btn'));
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

    // both of the tour's rows install from a shell, so the kit is two bare lines
    const block =
      '# Untangle install kit\n' +
      'claude mcp add firecrawl -- npx -y firecrawl-mcp\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n';

    expect(screen.getByTestId('scorecard-kit')).toHaveTextContent('INSTALL KIT');
    expect(screen.getByTestId('scorecard-kit-text').textContent).toBe(block);
    // a snapshot, not a control surface: nothing in the report to tick or clear
    expect(screen.queryByTestId('kit-check')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scorecard-kit-copy'));
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(block));
  } finally {
    clip.restore();
    restore();
  }
});

/**
 * The report's kit and the panel's are one block on the run the demo makes: the
 * same applied rows through the same builder, one frozen and one live. Read off
 * both surfaces rather than off a literal — the claim is that the reader who
 * takes the report and the reader who takes the panel install the same things,
 * and a literal in the middle would let the two drift past each other.
 */
it('hands the report the same block the panel has ticked by default', async () => {
  const restore = reduceMotion();
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(screen.getByTestId('optimize-btn'));
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    const frozen = screen.getByTestId('scorecard-kit-text').textContent!;
    expect(frozen).toContain('# Untangle install kit');

    // the report leaves the canvas standing on the version the run ended on, so
    // the panel is being asked about exactly the same applied set
    fireEvent.click(screen.getByTestId('scorecard-close'));
    await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId('prompt-btn'));

    fireEvent.click(screen.getByTestId('kit-copy'));
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(frozen));
  } finally {
    clip.restore();
    restore();
  }
});

// A heading over an empty block would be the template showing through — and the
// reader would be told to install a kit with nothing in it.
it('leaves the kit out of the report entirely when the run applied nothing runnable', () => {
  const replay = enriched.suggestions.find((s) => s.airtableRecordId === 'recC9tS5uH1zXfM7e')!;

  render(
    <Scorecard
      report={{
        applied: [replay],
        impact: impactSummary(createSession(enriched)),
        prompt: INTRO,
      }}
      onClose={() => {}}
      onExport={() => {}}
      exportFailed={false}
    />,
  );

  // the row is still reported — it is what the run applied — but there is no kit
  expect(screen.getByTestId('scorecard-name')).toHaveTextContent('browser-verify plugin');
  expect(screen.getByTestId('scorecard-prompt')).toBeInTheDocument();
  expect(screen.queryByTestId('scorecard-kit')).not.toBeInTheDocument();
});
