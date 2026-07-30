import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import {
  applyOn,
  cardLabels,
  cardsOf,
  fixture,
  LAYOUT_WAIT,
  reduceMotion,
} from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

/** A graph with no KB behind it: nothing to optimize. */
const plain = fixture(gallery, 'gallery');
/** The KB-matched graph: two siblings on one step, one patch the reducer refuses. */
const enriched = fixture(enrichedDoc, 'enriched');
/** Two cards carrying one Airtable row — the reducer opens no session at all. */
const twinned = fixture(
  {
    ...enrichedDoc,
    suggestions: [
      enrichedDoc.suggestions[0],
      { ...enrichedDoc.suggestions[1], airtableRecordId: enrichedDoc.suggestions[0].airtableRecordId },
    ],
  },
  'twinned',
);

const RESEARCH = 'Research the libraries & read the docs';
const VERIFY = 'Verify it by hand in the browser';
const RESEARCH_MCP = 'Pull the docs in-session';
const REPLAY = 'Replay the recorded walk-through';

/**
 * The tour runs in real time — a camera move, a held beat, an apply, a morph — so
 * a test that watches the whole of one needs more than the 5s default.
 */
const TOUR_BUDGET = 25000;

const optimizeBtn = () => screen.getByTestId('optimize-btn');
const appliedNames = () =>
  screen.getAllByTestId('scorecard-name').map((el) => el.textContent);

// ---------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------

it('offers OPTIMIZE only where there is a patch the reducer will take', async () => {
  const enrichedRender = render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  expect(optimizeBtn()).toHaveTextContent('OPTIMIZE');
  enrichedRender.unmount();

  // no KB behind this graph, so there is nothing on offer to apply
  const plainRender = render(<GraphCanvas workflow={plain} />);
  await cardsOf(plain);
  expect(screen.queryByTestId('optimize-btn')).not.toBeInTheDocument();
  plainRender.unmount();

  // and a graph the reducer will not open a session on offers no route in either
  render(<GraphCanvas workflow={twinned} />);
  await cardsOf(twinned);
  expect(screen.queryByTestId('optimize-btn')).not.toBeInTheDocument();
  expect(screen.getByTestId('suggestions-disabled')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// The run, without the pacing
// ---------------------------------------------------------------------------

it('applies every appliable patch at once when motion is not wanted', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());

    const card = await screen.findByTestId('scorecard');
    expect(card).toHaveTextContent('OPTIMIZED — 2 upgrades applied');
    // both patches swap one step for one replacement, so the count holds and the
    // saving is in what the steps cost, not in how many there are
    expect(card).toHaveTextContent('6 → 6 nodes');

    // the scorecard and the toolbar meter read off the same totals, formatted the
    // same way — 25+40 minutes, 9000 tokens, 1+3 manual steps
    const shown = screen.getAllByTestId('scorecard-metric').map((el) => el.textContent);
    expect(shown).toEqual(['−2 steps', '−65 min', '−9000 tok', '−4 manual']);
    expect(shown).toEqual(screen.getAllByTestId('impact-part').map((el) => el.textContent));

    // the export lands with its own task; the button says so rather than lying
    expect(screen.getByTestId('export-png')).toBeDisabled();
    expect(card).toHaveTextContent('EXPORT ARRIVES WITH T3');
  } finally {
    restore();
  }
});

// The two rows on the verify step are alternative futures for it: applying either
// consumes the step, and the other row goes with it. The tour must notice mid-run.
it('skips the sibling the apply before it consumed', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());
    await screen.findByTestId('scorecard');

    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    // the sibling and the two rows the first patch's cascade took are all absent
    expect(screen.getByTestId('scorecard')).not.toHaveTextContent('browser-verify plugin');
    // every row on offer is spent, so the way in is gone with them
    expect(screen.queryByTestId('optimize-btn')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});

/**
 * Three upgrades on one graph, listed in the KB's answer back to front.
 *
 * Each sits on its own branch of a fan-out, at a different depth, and names only
 * nodes no other patch touches — so nothing here cascades and the only thing that
 * can decide the order is where the steps are. The tour reads left to right, the
 * way the work itself runs.
 */
const ORDERED = {
  meta: {
    task: 'run three branches of a release',
    title: 'Three Branches',
    generatedAt: '2026-07-30T09:00:00Z',
    model: 'claude-fable-5',
    kbSource: 'airtable',
  },
  nodes: [
    { id: 'kickoff', label: 'Kick the release off', kind: 'input', description: 'Open the three branches.', painLevel: 1 },
    { id: 'near', label: 'Near branch, by hand', kind: 'process', description: 'The shallow one.', painLevel: 3 },
    { id: 'near-out', label: 'Near branch lands', kind: 'output', description: 'Done.', painLevel: 1 },
    { id: 'mid-lead', label: 'Set the middle branch up', kind: 'process', description: 'A step of runway.', painLevel: 1 },
    { id: 'mid', label: 'Middle branch, by hand', kind: 'process', description: 'The middle one.', painLevel: 3 },
    { id: 'mid-out', label: 'Middle branch lands', kind: 'output', description: 'Done.', painLevel: 1 },
    { id: 'far-lead', label: 'Set the far branch up', kind: 'process', description: 'A step of runway.', painLevel: 1 },
    { id: 'far-lead-two', label: 'Stage the far branch', kind: 'process', description: 'Another step of runway.', painLevel: 1 },
    { id: 'far', label: 'Far branch, by hand', kind: 'process', description: 'The deep one.', painLevel: 3 },
    { id: 'far-out', label: 'Far branch lands', kind: 'output', description: 'Done.', painLevel: 1 },
  ],
  edges: [
    { from: 'kickoff', to: 'near', kind: 'sequence' },
    { from: 'near', to: 'near-out', kind: 'sequence' },
    { from: 'kickoff', to: 'mid-lead', kind: 'sequence' },
    { from: 'mid-lead', to: 'mid', kind: 'sequence' },
    { from: 'mid', to: 'mid-out', kind: 'sequence' },
    { from: 'kickoff', to: 'far-lead', kind: 'sequence' },
    { from: 'far-lead', to: 'far-lead-two', kind: 'sequence' },
    { from: 'far-lead-two', to: 'far', kind: 'sequence' },
    { from: 'far', to: 'far-out', kind: 'sequence' },
  ],
  suggestions: [
    {
      nodeId: 'far',
      airtableRecordId: 'recZ0000000000001',
      name: 'far-runner',
      url: 'https://example.com/far-runner',
      category: 'MCP Server',
      claim: 'Runs the far branch.',
      effect: {
        removeNodes: ['far'],
        mergeNodes: [],
        replaceWith: { id: 'far-auto', label: 'Far branch, driven', kind: 'process', description: 'Driven.', painLevel: 1 },
        newEdges: [
          { from: 'far-lead-two', to: 'far-auto', kind: 'sequence' },
          { from: 'far-auto', to: 'far-out', kind: 'sequence' },
        ],
        metrics: { stepsSaved: 1, estTimeSavedMin: 3, estTokensSaved: 0, manualInterventionsRemoved: 1 },
      },
    },
    {
      nodeId: 'mid',
      airtableRecordId: 'recZ0000000000002',
      name: 'mid-runner',
      url: 'https://example.com/mid-runner',
      category: 'Claude Skill',
      claim: 'Runs the middle branch.',
      effect: {
        removeNodes: ['mid'],
        mergeNodes: [],
        replaceWith: { id: 'mid-auto', label: 'Middle branch, driven', kind: 'process', description: 'Driven.', painLevel: 1 },
        newEdges: [
          { from: 'mid-lead', to: 'mid-auto', kind: 'sequence' },
          { from: 'mid-auto', to: 'mid-out', kind: 'sequence' },
        ],
        metrics: { stepsSaved: 1, estTimeSavedMin: 2, estTokensSaved: 0, manualInterventionsRemoved: 1 },
      },
    },
    {
      nodeId: 'near',
      airtableRecordId: 'recZ0000000000003',
      name: 'near-runner',
      url: 'https://example.com/near-runner',
      category: 'Claude Plugin',
      claim: 'Runs the near branch.',
      effect: {
        removeNodes: ['near'],
        mergeNodes: [],
        replaceWith: { id: 'near-auto', label: 'Near branch, driven', kind: 'process', description: 'Driven.', painLevel: 1 },
        newEdges: [
          { from: 'kickoff', to: 'near-auto', kind: 'sequence' },
          { from: 'near-auto', to: 'near-out', kind: 'sequence' },
        ],
        metrics: { stepsSaved: 1, estTimeSavedMin: 1, estTokensSaved: 0, manualInterventionsRemoved: 1 },
      },
    },
  ],
};

const ordered = fixture(ORDERED, 'ordered');

it('walks the graph left to right, whatever order the KB answered in', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={ordered} />);
    await cardsOf(ordered);

    fireEvent.click(optimizeBtn());
    await screen.findByTestId('scorecard');

    // the KB listed them far, middle, near; the graph reads near, middle, far
    expect(appliedNames()).toEqual(['near-runner', 'mid-runner', 'far-runner']);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The run, with it
// ---------------------------------------------------------------------------

/**
 * Starts a tour and waits for its first patch to reach the session.
 *
 * Watched at the version strip rather than at the cards: the strip gains its chip
 * in the commit the apply makes, while a new card has a whole layout pass to wait
 * out first. Stopping the tour is a race against its next step, and this is the
 * earliest honest signal that its first one is done.
 */
async function tourToFirstApply() {
  fireEvent.click(optimizeBtn());
  // the same slot becomes the way out for as long as the tour is running
  await waitFor(() => expect(optimizeBtn()).toHaveTextContent('CANCEL'));
  await waitFor(() => expect(screen.getAllByTestId('version-chip')).toHaveLength(2), LAYOUT_WAIT);
}

it(
  'CANCEL stops after the patch in flight and reports what actually landed',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await tourToFirstApply();
    fireEvent.click(optimizeBtn());

    const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(card).toHaveTextContent('OPTIMIZED — 1 upgrade applied');
    expect(appliedNames()).toEqual(['firecrawl-mcp']);
    // exactly the applies that completed — one version off the original
    expect(screen.getAllByTestId('version-chip').map((c) => c.textContent)).toEqual(['V0', 'V1']);
    // the tour is over, so the slot is the way in again
    expect(optimizeBtn()).toHaveTextContent('OPTIMIZE');
  },
  TOUR_BUDGET,
);

it(
  'takes focus into the scorecard and hands it back to OPTIMIZE',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await tourToFirstApply();
    fireEvent.click(optimizeBtn());

    const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(card).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(screen.getByTestId('scorecard-close'));

    fireEvent.click(screen.getByTestId('scorecard-close'));
    await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(optimizeBtn());
  },
  TOUR_BUDGET,
);

it(
  'takes Escape as CANCEL, and the next one as CLOSE',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await tourToFirstApply();
    fireEvent.keyDown(window, { key: 'Escape' });

    // the keystroke that stopped the tour did not also dismiss its report
    const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(card).toHaveTextContent('OPTIMIZED — 1 upgrade applied');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());
  },
  TOUR_BUDGET,
);

// ---------------------------------------------------------------------------
// What the scorecard is describing
// ---------------------------------------------------------------------------

// A tour started from a version the cursor stepped back to branches, exactly as a
// hand-pressed APPLY does. The report has to describe the branch on the canvas —
// the abandoned future is still in the session, and it is not part of this story.
it('reports the branch the cursor is on, not the future it left behind', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    // the replay plugin — the sibling the tour would never have picked
    await applyOn(VERIFY, 1);
    await waitFor(() => expect(cardLabels()).toContain(REPLAY), LAYOUT_WAIT);

    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(VERIFY), LAYOUT_WAIT);

    fireEvent.click(optimizeBtn());
    const card = await screen.findByTestId('scorecard');

    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    expect(card).not.toHaveTextContent('browser-verify plugin');
    expect(card).toHaveTextContent('OPTIMIZED — 2 upgrades applied');
  } finally {
    restore();
  }
});

// The tour owns the canvas while it runs: OPTIMIZE closes whatever panel is open,
// and nothing reopens one over the camera.
it('closes the drawer to start, and keeps it closed for the run', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    const all = await cardsOf(enriched);

    // a step no patch touches, so nothing but OPTIMIZE itself can shut this panel
    fireEvent.click(all.find((el) => el.textContent?.includes('Gather the brief'))!);
    await screen.findByTestId('detail-drawer');

    fireEvent.click(optimizeBtn());
    await screen.findByTestId('scorecard');
    expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});
