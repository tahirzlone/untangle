import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import {
  applyOn,
  cardLabels,
  cardsOf,
  fixture,
  impactStats,
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

/**
 * Installs the one thing about `inert` that jsdom does not implement: a browser
 * REFUSES `focus()` on anything inside an inert subtree, and says nothing about
 * it. Without this the suite is blind to the whole class of bug where focus is
 * handed back before the attribute has come off — the call succeeds in jsdom and
 * fails in Chrome.
 *
 * Attribute-driven rather than a spy, so it stays true to what it is modelling:
 * the moment React commits the removal, focus starts working again.
 */
function refuseFocusInsideInert(): () => void {
  const real = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest('[inert]')) return;
    real.call(this, options);
  };
  return () => {
    HTMLElement.prototype.focus = real;
  };
}

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

    const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(card).toHaveTextContent('OPTIMIZED — 2 upgrades applied');
    // both patches swap one step for one replacement, so the counts hold and the
    // saving is in what the steps COST, not in how many there are — which is the
    // whole reason the report states the pain as well as the shape
    expect(screen.getByTestId('scorecard-count')).toHaveTextContent('6 → 6 nodes · 6 → 6 edges');
    expect(screen.getByTestId('scorecard-pain')).toHaveTextContent('pain 18 → 12 (−33%)');

    // the scorecard and the impact panel read off the same totals — 25+40 minutes,
    // 9000 tokens, 1+3 manual steps
    const shown = screen.getAllByTestId('scorecard-metric').map((el) => el.textContent);
    expect(shown).toEqual(['−2 steps', '−65 min', '−9000 tok', '−4 manual']);
    expect(impactStats()).toEqual({
      stepsSaved: '2',
      estTimeSavedMin: '65',
      estTokensSaved: '9000',
      manualInterventionsRemoved: '4',
    });

    // the export is live and has a suite of its own; what matters here is that
    // the panel's second action is an offer rather than a placeholder
    expect(screen.getByTestId('export-png')).toBeEnabled();
    expect(card).not.toHaveTextContent('EXPORT ARRIVES WITH');
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
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

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
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

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

// The close handler cannot hand focus back itself: dropping the report is a state
// change, so the canvas is still inert when it runs, and the browser refuses. This
// runs under that refusal, so it goes red the moment the restore stops waiting for
// the commit that releases the attribute.
it(
  'takes focus into the scorecard and hands it back to OPTIMIZE',
  async () => {
    const allowFocus = refuseFocusInsideInert();
    try {
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
    } finally {
      allowFocus();
    }
  },
  TOUR_BUDGET,
);

it(
  'takes Escape as CANCEL, and the next one as CLOSE',
  async () => {
    const allowFocus = refuseFocusInsideInert();
    try {
      render(<GraphCanvas workflow={enriched} />);
      await cardsOf(enriched);

      await tourToFirstApply();
      fireEvent.keyDown(window, { key: 'Escape' });

      // the keystroke that stopped the tour did not also dismiss its report
      const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
      expect(card).toHaveTextContent('OPTIMIZED — 1 upgrade applied');

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());
      // the keyboard route out lands where the pointer route does
      expect(document.activeElement).toBe(optimizeBtn());
    } finally {
      allowFocus();
    }
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
    const card = await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    expect(card).not.toHaveTextContent('browser-verify plugin');
    expect(card).toHaveTextContent('OPTIMIZED — 2 upgrades applied');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The scorecard is a report, not a live readout
// ---------------------------------------------------------------------------

/** Runs a whole tour without the pacing and hands back the scorecard. */
async function scorecardAfterInstantTour() {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  fireEvent.click(optimizeBtn());
  return screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
}

// The report is frozen at the moment the run stops. A session that moves under it
// afterwards — a version jump, an undo — does not get to rewrite what the user
// just watched happen into "0 upgrades applied".
it('holds its report still when the session moves underneath it', async () => {
  const restore = reduceMotion();
  try {
    const card = await scorecardAfterInstantTour();
    expect(card).toHaveTextContent('OPTIMIZED — 2 upgrades applied');

    // straight back to the original graph, behind the open panel
    fireEvent.click(screen.getAllByTestId('version-chip')[0]);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH), LAYOUT_WAIT);

    expect(screen.getByTestId('scorecard')).toHaveTextContent('OPTIMIZED — 2 upgrades applied');
    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    expect(screen.getAllByTestId('scorecard-metric').map((el) => el.textContent)).toEqual([
      '−2 steps',
      '−65 min',
      '−9000 tok',
      '−4 manual',
    ]);
    expect(screen.getByTestId('scorecard-count')).toHaveTextContent('6 → 6 nodes');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Nothing behind the backdrop is reachable
// ---------------------------------------------------------------------------

it('makes the canvas behind it inert, and gives it back on close', async () => {
  const restore = reduceMotion();
  const allowFocus = refuseFocusInsideInert();
  try {
    await scorecardAfterInstantTour();
    expect(screen.getByTestId('canvas')).toHaveAttribute('inert');

    // the third way out — the backdrop — through the same restore as the other two
    fireEvent.click(screen.getByTestId('scorecard-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());
    expect(screen.getByTestId('canvas')).not.toHaveAttribute('inert');
    // this tour spent every patch on offer, so OPTIMIZE went with them and the
    // graph takes the keyboard back instead — inside the canvas that was inert a
    // moment ago, which is the whole point of waiting for the commit
    expect(document.activeElement).toHaveClass('react-flow__node');
  } finally {
    allowFocus();
    restore();
  }
});

/**
 * Gives the pane and its cards real rectangles, which jsdom otherwise measures as
 * 0×0 for everything.
 *
 * `onScreen` is the set of card ids the pane is showing; every other card is put
 * far below it. The pane itself gets a plain 1000×700 box at the origin.
 */
function stageCards(onScreen: string[]): () => void {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('sg-viewport')) {
      return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 } as DOMRect;
    }
    if (this.classList.contains('react-flow__node')) {
      const seen = onScreen.includes(this.getAttribute('data-id') ?? '');
      const top = seen ? 100 : 4000;
      return { x: 40, y: top, left: 40, top, right: 292, bottom: top + 148, width: 252, height: 148 } as DOMRect;
    }
    return real.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = real;
  };
}

// A tour that spends every patch takes OPTIMIZE with it, so closing the report
// hands focus to the graph — and the camera is somewhere down the graph by then.
// First-in-the-DOM is wherever ELK put it, which scrolls the pane out from under
// the person who was watching. The card in front of them is the honest target.
it('hands focus to a card the pane is actually showing', async () => {
  const restore = reduceMotion();
  const allowFocus = refuseFocusInsideInert();
  // the last two steps of the fixture, which is where a left-to-right tour ends up
  const staged = stageCards(['ship-release']);
  try {
    await scorecardAfterInstantTour();

    fireEvent.click(screen.getByTestId('scorecard-close'));
    await waitFor(() => expect(screen.queryByTestId('scorecard')).not.toBeInTheDocument());

    expect(document.activeElement).toHaveClass('react-flow__node');
    expect(document.activeElement).toHaveAttribute('data-id', 'ship-release');
    // and it is not simply the first card in the document, which is the fallback
    // this replaces
    expect(document.querySelector('.react-flow__node')).not.toBe(document.activeElement);
  } finally {
    staged();
    allowFocus();
    restore();
  }
});

// Tab out of the panel would land on the masthead, which the backdrop does not
// cover — so the panel keeps the key rather than trusting the geometry.
it('keeps Tab inside the panel', async () => {
  const restore = reduceMotion();
  try {
    await scorecardAfterInstantTour();
    const promptCopy = screen.getByTestId('scorecard-prompt-copy');
    const close = screen.getByTestId('scorecard-close');
    expect(document.activeElement).toBe(close);

    // CLOSE is the last stop in the panel, so Tab comes round to the first —
    // the prompt section's COPY, which stands above the actions
    const forward = createEvent.keyDown(close, { key: 'Tab' });
    fireEvent(close, forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(promptCopy);

    // and that COPY is the first, so Shift+Tab comes round to the last
    const back = createEvent.keyDown(promptCopy, { key: 'Tab', shiftKey: true });
    fireEvent(promptCopy, back);
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  } finally {
    restore();
  }
});

// The drawer draws at z6 and the backdrop at z7, so a panel opened now would be a
// panel nobody can see holding the focus. The canvas declines to open one.
it('will not open the drawer while the scorecard is up', async () => {
  const restore = reduceMotion();
  try {
    const { container } = render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(optimizeBtn());
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);

    const wrapper = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="gather-brief"]',
    )!;
    fireEvent.click(wrapper.querySelector('[data-testid="sg-node"]')!);
    expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();

    wrapper.focus();
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
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
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});
