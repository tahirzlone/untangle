import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import {
  applyOn,
  cardLabels,
  cardsOf,
  fixture,
  impactStats,
  LAYOUT_WAIT,
  press,
  reduceMotion,
} from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

/** A graph with no KB behind it: the gallery graph, suggestions stripped — nothing to optimize. */
const plain = fixture(
  { ...gallery, meta: { ...gallery.meta, kbSource: 'none' }, suggestions: [] },
  'gallery',
);
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
const viewResultsBtn = () => screen.getByTestId('view-results-btn');
const appliedNames = () =>
  screen.getAllByTestId('results-name').map((el) => el.textContent);

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
// What a finished run puts up: a way in, not an overlay
// ---------------------------------------------------------------------------

it('offers VIEW RESULTS after the run instead of auto-opening anything', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());

    // the graph settles and a button appears — no window opened itself
    const button = await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);
    expect(button).toHaveTextContent('VIEW RESULTS');
    expect(screen.queryByTestId('results-window')).not.toBeInTheDocument();

    // this tour spent every patch on offer, so OPTIMIZE went with them; PROMPT
    // stands beside the run's own button as the entry that will remain
    expect(screen.queryByTestId('optimize-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-btn')).toBeInTheDocument();
  } finally {
    restore();
  }
});

it('appears only after a completed run — never before, never for a hand apply', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    expect(screen.queryByTestId('view-results-btn')).not.toBeInTheDocument();

    // a hand-pressed APPLY is not a run: no button lands with the patch
    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
    expect(screen.queryByTestId('view-results-btn')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});

it('opens the window on the run the button speaks for, live off the session', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());
    fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));

    const windowEl = screen.getByTestId('results-window');
    expect(windowEl).toHaveTextContent('RESULTS — 2 upgrades applied');
    // both patches swap one step for one replacement, so the counts hold and the
    // saving is in what the steps COST, not in how many there are — which is the
    // whole reason the summary states the pain as well as the shape
    expect(screen.getByTestId('results-count')).toHaveTextContent('6 → 6 nodes · 6 → 6 edges');
    expect(screen.getByTestId('results-pain')).toHaveTextContent('pain 18 → 12 (−33%)');

    // the window and the impact panel read off the same totals — 25+40 minutes,
    // 9000 tokens, 1+3 manual steps
    const shown = screen.getAllByTestId('results-metric').map((el) => el.textContent);
    expect(shown).toEqual(['−2 steps', '−65 min', '−9000 tok', '−4 manual']);
    expect(impactStats()).toEqual({
      stepsSaved: '2',
      estTimeSavedMin: '65',
      estTokensSaved: '9000',
      manualInterventionsRemoved: '4',
    });

    // the button was the run's own way in, and the click spent it — PROMPT is
    // the standing entry from here on
    expect(screen.queryByTestId('view-results-btn')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});

// The button speaks for the session the run left behind. Any move off it — a
// version jump, an undo — is the user leaving the optimized state, and a button
// still offering "the run's results" would be offering a version nobody ran.
it('stands VIEW RESULTS down the moment the session leaves the optimized state', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());
    await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);

    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(cardLabels()).toContain(VERIFY), LAYOUT_WAIT);
    expect(screen.queryByTestId('view-results-btn')).not.toBeInTheDocument();

    // and it does not come back for a redo onto the same version: the state was
    // left, and PROMPT is the entry that remains
    fireEvent.click(screen.getByTestId('redo-btn'));
    await waitFor(() => expect(screen.getAllByTestId('version-chip')).toHaveLength(3), LAYOUT_WAIT);
    expect(screen.queryByTestId('view-results-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-btn')).toBeInTheDocument();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The run, without the pacing
// ---------------------------------------------------------------------------

// The two rows on the verify step are alternative futures for it: applying either
// consumes the step, and the other row goes with it. The tour must notice mid-run.
it('skips the sibling the apply before it consumed', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(optimizeBtn());
    fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));

    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    // the sibling and the two rows the first patch's cascade took are all absent
    expect(screen.getByTestId('results-window')).not.toHaveTextContent('browser-verify plugin');
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

/**
 * The window lists rows in FLOW order whatever order they were applied in, so
 * the tour's own order is read off the history instead: each undo removes the
 * LAST patch applied, and the time totals tell the three rows apart (near saves
 * 1 min, mid 2, far 3).
 */
it('walks the graph left to right, whatever order the KB answered in', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={ordered} />);
    await cardsOf(ordered);

    fireEvent.click(optimizeBtn());
    await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);
    expect(impactStats().estTimeSavedMin).toBe('6');

    // far-runner (3 min) landed last…
    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(impactStats().estTimeSavedMin).toBe('3'), LAYOUT_WAIT);
    // …mid-runner (2 min) second, leaving near-runner's 1 min first
    fireEvent.click(screen.getByTestId('undo-btn'));
    await waitFor(() => expect(impactStats().estTimeSavedMin).toBe('1'), LAYOUT_WAIT);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The run, with the pacing
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
  // and the standing entry stands down while the camera has the canvas
  expect(screen.getByTestId('prompt-btn')).toBeDisabled();
  await waitFor(() => expect(screen.getAllByTestId('version-chip')).toHaveLength(2), LAYOUT_WAIT);
}

it(
  'CANCEL stops after the patch in flight and offers what actually landed',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await tourToFirstApply();
    fireEvent.click(optimizeBtn());

    fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));
    expect(screen.getByTestId('results-window')).toHaveTextContent(
      'RESULTS — 1 upgrade applied',
    );
    expect(appliedNames()).toEqual(['firecrawl-mcp']);
    fireEvent.click(screen.getByTestId('results-close'));
    await waitFor(() => expect(screen.queryByTestId('results-window')).not.toBeInTheDocument());

    // exactly the applies that completed — one version off the original
    expect(screen.getAllByTestId('version-chip').map((c) => c.textContent)).toEqual(['V0', 'V1']);
    // the tour is over, so the slot is the way in again
    expect(optimizeBtn()).toHaveTextContent('OPTIMIZE');
  },
  TOUR_BUDGET,
);

// The close handler cannot hand focus back itself: dropping the window is a state
// change, so the canvas is still inert when it runs, and the browser refuses. This
// runs under that refusal, so it goes red the moment the restore stops waiting for
// the commit that releases the attribute.
it(
  'lands focus on VIEW RESULTS, takes it into the window, and hands it to PROMPT',
  async () => {
    const allowFocus = refuseFocusInsideInert();
    try {
      render(<GraphCanvas workflow={enriched} />);
      await cardsOf(enriched);

      await tourToFirstApply();
      fireEvent.click(optimizeBtn());

      // the run was started from a button and ran without the keyboard; the
      // button it puts up is where the keyboard lands on the way out
      const button = await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);
      await waitFor(() => expect(document.activeElement).toBe(button));

      fireEvent.click(button);
      expect(document.activeElement).toBe(screen.getByTestId('results-close'));

      fireEvent.click(screen.getByTestId('results-close'));
      await waitFor(() => expect(screen.queryByTestId('results-window')).not.toBeInTheDocument());
      // VIEW RESULTS was spent by the click, so the keyboard lands on the
      // standing entry instead
      expect(document.activeElement).toBe(screen.getByTestId('prompt-btn'));
    } finally {
      allowFocus();
    }
  },
  TOUR_BUDGET,
);

it(
  'takes Escape as CANCEL, and opens nothing on its own',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await tourToFirstApply();
    fireEvent.keyDown(window, { key: 'Escape' });

    // the keystroke stopped the tour; what landed is on offer, not on screen
    await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);
    expect(screen.queryByTestId('results-window')).not.toBeInTheDocument();

    // Escape with no window open is nobody's keystroke now — the offer stands
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('view-results-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('results-window')).not.toBeInTheDocument();
  },
  TOUR_BUDGET,
);

// ---------------------------------------------------------------------------
// What the window is describing
// ---------------------------------------------------------------------------

// A tour started from a version the cursor stepped back to branches, exactly as a
// hand-pressed APPLY does. The window has to describe the branch on the canvas —
// the abandoned future is still in the session, and it is not part of this story.
it('describes the branch the cursor is on, not the future it left behind', async () => {
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
    fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));

    const windowEl = screen.getByTestId('results-window');
    expect(appliedNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
    expect(windowEl).not.toHaveTextContent('browser-verify plugin');
    expect(windowEl).toHaveTextContent('RESULTS — 2 upgrades applied');
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Nothing behind the backdrop is reachable
// ---------------------------------------------------------------------------

/** Runs a whole tour without the pacing and opens the window off its button. */
async function windowAfterInstantTour() {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  fireEvent.click(optimizeBtn());
  fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));
  return screen.getByTestId('results-window');
}

it('makes the canvas behind it inert, and gives it back on close', async () => {
  const restore = reduceMotion();
  const allowFocus = refuseFocusInsideInert();
  try {
    await windowAfterInstantTour();
    expect(screen.getByTestId('canvas')).toHaveAttribute('inert');

    // the third way out — the backdrop — through the same restore as the other
    // two. Down and up both on the backdrop itself: closing is decided on the
    // pointer pair, so a selection drag overshooting the window cannot take it
    // down — see ResultsWindow.test.tsx for that pin.
    const backdrop = screen.getByTestId('results-backdrop');
    press('pointerDown', backdrop);
    press('pointerUp', backdrop);
    await waitFor(() => expect(screen.queryByTestId('results-window')).not.toBeInTheDocument());
    expect(screen.getByTestId('canvas')).not.toHaveAttribute('inert');
    // focus lands on the standing entry — inside the canvas that was inert a
    // moment ago, which is the whole point of waiting for the commit
    expect(document.activeElement).toBe(screen.getByTestId('prompt-btn'));
  } finally {
    allowFocus();
    restore();
  }
});

// The drawer draws at z6 and the backdrop at z9, so a panel opened now would be a
// panel nobody can see holding the focus. The canvas declines to open one — and
// `inert` blocks the session from moving at all while the window reads it live.
it('will not open the drawer while the window is up', async () => {
  const restore = reduceMotion();
  try {
    const { container } = render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(optimizeBtn());
    fireEvent.click(await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT));

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
    await screen.findByTestId('view-results-btn', {}, LAYOUT_WAIT);
    expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// How the button arrives
// ---------------------------------------------------------------------------

// jsdom loads no CSS, so the pulse contract is read off the stylesheet the way
// railHeight.test.ts reads its bounds: one iteration, and none at all when
// motion is not wanted — the button simply appears.
it('pulses once on arrival, and not at all under reduced motion', () => {
  const css = readFileSync('src/components/canvas.css', 'utf8');
  const pulse = css.match(/\.sg-view-results\s*\{([^}]*)\}/);
  expect(pulse).not.toBeNull();
  expect(pulse![1]).toMatch(/animation:\s*sg-results-pulse [^;]*\b1\b/);
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.sg-view-results \{ animation: none; \}/,
  );
});

// The window is the only surface — there is no frozen report left anywhere.
it('has retired the scorecard: no report overlay exists anywhere in the run', async () => {
  const restore = reduceMotion();
  try {
    const windowEl = await windowAfterInstantTour();
    expect(document.querySelector('[data-testid="scorecard"]')).toBeNull();
    expect(document.querySelector('.sg-scorecard')).toBeNull();
    expect(within(windowEl).queryByTestId('export-png')).not.toBeInTheDocument();
  } finally {
    restore();
  }
});
