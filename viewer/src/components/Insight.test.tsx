import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applyOn, cardFor, cardLabels, cardsOf, fixture, LAYOUT_WAIT } from '../test/harness';
import { backEdgePath, planBackEdges } from '../graph/backEdge';
import { edgeKey } from '../graph/insight';
import { GraphCanvas } from './GraphCanvas';

// The real routing, watched rather than replaced: the ghost has to plan its lanes
// ONCE per session, so the suite needs to count the calls without changing what
// any of them do.
vi.mock('../graph/backEdge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../graph/backEdge')>();
  return { ...actual, planBackEdges: vi.fn(actual.planBackEdges) };
});
const planned = vi.mocked(planBackEdges);

beforeEach(() => {
  planned.mockClear();
});

/**
 * The two read-only overlays: the original held under the live graph, and the
 * most painful route through whatever is on screen. Neither changes the session
 * — which is why they get their own suite: everything here is about what the
 * canvas SHOWS, not about what it does to the graph.
 */

const enriched = fixture(enrichedDoc, 'enriched');

/** Consolidates the scaffold step away outright — V1 is a card shorter than V0. */
const CODE = 'Write the feature, one slice at a time';
const SCAFFOLD = 'Scaffold the module & wire it up';

/**
 * A graph with two ways through it: a hand-run pair of steps, and a nightly job
 * that does the same work for less. The painful route is the one worth pointing
 * at — and the suggestion on it consolidates BOTH hand steps, which moves the
 * route onto the other branch rather than merely shortening this one.
 */
const BRANCHED = {
  meta: {
    task: 'reconcile the ledger every morning',
    title: 'Reconcile the Ledger',
    generatedAt: '2026-07-30T09:00:00Z',
    model: 'claude-fable-5',
    kbSource: 'airtable',
  },
  nodes: [
    { id: 'intake', label: 'Take the day’s ledger', kind: 'input', description: 'Pull the file.', painLevel: 1 },
    { id: 'manual-a', label: 'Copy the rows by hand', kind: 'process', description: 'Row by row into the sheet.', painLevel: 5 },
    { id: 'manual-b', label: 'Check the copy by hand', kind: 'review', description: 'Read both columns back.', painLevel: 4 },
    { id: 'auto', label: 'Let the nightly job run', kind: 'process', description: 'It already does this.', painLevel: 2 },
    { id: 'ship', label: 'Post the reconciliation', kind: 'output', description: 'File it.', painLevel: 1 },
  ],
  edges: [
    { from: 'intake', to: 'manual-a', kind: 'sequence' },
    // labelled so the suite has a tag ON the route to hold against the ones off it
    { from: 'manual-a', to: 'manual-b', kind: 'sequence', label: 'row by row' },
    { from: 'manual-b', to: 'ship', kind: 'sequence' },
    { from: 'intake', to: 'auto', kind: 'branch', label: 'overnight' },
    { from: 'auto', to: 'ship', kind: 'branch' },
    // spans the whole graph right-to-left, so its return run has to clear every
    // row between the two ends — the case the lane plan exists for
    { from: 'ship', to: 'intake', kind: 'retry', label: 'breaks' },
  ],
  suggestions: [
    {
      nodeId: 'manual-a',
      airtableRecordId: 'recZ9yX8wV7uT6sR5',
      name: 'ledger-reconcile skill',
      url: 'https://github.com/anthropics/skills',
      category: 'Claude Skill',
      claim: 'Copies the rows and reads them back in one pass.',
      effect: {
        removeNodes: ['manual-a', 'manual-b'],
        mergeNodes: [],
        replaceWith: {
          id: 'assisted',
          label: 'Reconcile in one pass',
          kind: 'process',
          description: 'The copy and the read-back happen together.',
          painLevel: 1,
        },
        newEdges: [
          { from: 'intake', to: 'assisted', kind: 'sequence' },
          { from: 'assisted', to: 'ship', kind: 'sequence' },
        ],
        metrics: { stepsSaved: 1, estTimeSavedMin: 45, estTokensSaved: 0, manualInterventionsRemoved: 2 },
      },
    },
  ],
};

const branched = fixture(BRANCHED, 'branched');

/**
 * Three steps in a ring, so the sweep can settle none of them: a graph whose
 * logical edges form a cycle has no longest path, and `criticalPath` answers
 * NO_PATH rather than inventing one. The canvas has nothing to point at — which
 * is exactly the case where stepping the rest of the graph back would dim the
 * WHOLE picture with nothing left lit to explain why.
 */
const CYCLIC = {
  meta: {
    task: 'chase the approval round and round',
    title: 'Approval Merry-Go-Round',
    generatedAt: '2026-07-30T09:00:00Z',
    model: 'claude-fable-5',
    kbSource: 'airtable',
  },
  nodes: [
    { id: 'draft', label: 'Draft the note', kind: 'process', description: 'Write it up.', painLevel: 3 },
    { id: 'review', label: 'Send it for review', kind: 'review', description: 'Wait on a reply.', painLevel: 4 },
    { id: 'revise', label: 'Revise and resend', kind: 'process', description: 'Round we go.', painLevel: 5 },
  ],
  edges: [
    { from: 'draft', to: 'review', kind: 'sequence' },
    { from: 'review', to: 'revise', kind: 'sequence' },
    // a BRANCH, not a retry: retries are excluded from the logical graph, so this
    // is what actually leaves the sweep with a cycle it cannot answer about
    { from: 'revise', to: 'draft', kind: 'branch', label: 'again' },
  ],
  suggestions: [],
};

const cyclic = fixture(CYCLIC, 'cyclic');

const HAND_COPY = 'Copy the rows by hand';
const NIGHTLY = 'Let the nightly job run';

/**
 * How far off-path elements step back — the value tokens.css states.
 *
 * jsdom loads no stylesheet, so the token has to be installed by hand for the
 * edge to resolve it at render time. Installed for the whole suite because
 * nothing else reads it: a graph with no route up asks for it and gets nothing
 * back, exactly as it does in a browser.
 */
const DIM = '0.35';

beforeEach(() => {
  document.documentElement.style.setProperty('--critpath-dim-opacity', DIM);
});
afterEach(() => {
  document.documentElement.style.removeProperty('--critpath-dim-opacity');
});

const labelsOf = (els: Element[]) =>
  els.map((el) => el.querySelector('.sg-label')?.textContent ?? '');

/** The steps the glow is on, whatever version is drawn. */
const criticalLabels = () => labelsOf([...document.querySelectorAll('.sg-node--critical')]);
/** The steps the glow is NOT on, which is what steps back while it is up. */
const offPathLabels = () => labelsOf([...document.querySelectorAll('.sg-node-shell--offpath')]);
/** The copies of the original held under the live graph. */
const ghostLabels = () => labelsOf(screen.getAllByTestId('sg-xray-card'));

/** What the stepped-back tags say — the conditions hanging off the dimmed edges. */
const offPathTagText = () =>
  [...document.querySelectorAll('.sg-edge-tag--offpath')].map((el) => el.textContent ?? '');

const xrayBtn = () => screen.getByTestId('xray-btn');
const critBtn = () => screen.getByTestId('critpath-btn');

// ---------------------------------------------------------------------------
// X-ray: the original, held under what it became
// ---------------------------------------------------------------------------

// Comparing V0 with V0 is a picture of one graph drawn twice. The button only
// means something once there is a difference to see.
it('offers no comparison while the original is what is on screen', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  expect(screen.queryByTestId('xray-btn')).not.toBeInTheDocument();

  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  expect(xrayBtn()).toHaveTextContent('VS ORIGINAL');
  expect(xrayBtn()).toHaveAttribute('aria-pressed', 'false');
});

it('holds the original under the live graph for as long as the button is held', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());

  expect(xrayBtn()).toHaveAttribute('aria-pressed', 'true');
  // every card the graph started with, including the one the patch consumed
  expect(screen.getAllByTestId('sg-xray-card')).toHaveLength(enriched.nodes.length);
  expect(ghostLabels()).toContain(SCAFFOLD);
  expect(cardLabels()).not.toContain(SCAFFOLD);
  // it is a picture, not a graph: nothing here answers a pointer or a reader
  expect(screen.getByTestId('xray-layer')).toHaveAttribute('aria-hidden', 'true');
  // and the live graph steps back so the difference reads
  expect(container.querySelector('.react-flow')).toHaveClass('sg-live--xray');

  fireEvent.pointerUp(xrayBtn());
  await waitFor(() => expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument());
  expect(xrayBtn()).toHaveAttribute('aria-pressed', 'false');
  expect(container.querySelector('.react-flow')).not.toHaveClass('sg-live--xray');
});

// A press that slides off the button never gets its pointerup: without this the
// original would be stuck on screen with nothing left to release it.
it('drops the comparison when the pointer leaves the button', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());

  fireEvent.pointerLeave(xrayBtn());
  await waitFor(() => expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument());
});

// And a gesture the browser takes over — a scroll, a system swipe, a touch the OS
// decides was something else — never gets its pointerup either. Same ending, a
// different way of losing the press.
it('drops the comparison when the browser takes the gesture over', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());

  fireEvent.pointerCancel(xrayBtn());
  await waitFor(() => expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument());
  expect(xrayBtn()).toHaveAttribute('aria-pressed', 'false');
});

// A hold is not a gesture a keyboard has. Space and Enter toggle instead — the
// same control, reached the only way it can be reached without a pointer.
it('toggles from the keyboard, where holding is not a gesture', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  fireEvent.keyDown(xrayBtn(), { key: ' ' });
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());
  expect(xrayBtn()).toHaveAttribute('aria-pressed', 'true');

  // the auto-repeat a held key produces must not flap the state
  fireEvent.keyDown(xrayBtn(), { key: ' ', repeat: true });
  expect(screen.getByTestId('xray-layer')).toBeInTheDocument();

  fireEvent.keyDown(xrayBtn(), { key: ' ' });
  await waitFor(() => expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument());

  fireEvent.keyDown(xrayBtn(), { key: 'Enter' });
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());
});

// The button goes when the cursor walks back to V0 — and a toggle held on by the
// keyboard would otherwise be left on with nothing on screen to turn it off.
it('takes the comparison away when the cursor walks back to the original', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);
  await applyOn(CODE);
  await waitFor(() => expect(screen.getAllByTestId('sg-node')).toHaveLength(5), LAYOUT_WAIT);

  fireEvent.keyDown(xrayBtn(), { key: ' ' });
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());

  fireEvent.click(screen.getByTestId('undo-btn'));
  await waitFor(() => expect(cardLabels()).toContain(SCAFFOLD), LAYOUT_WAIT);

  expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument();
  expect(screen.queryByTestId('xray-btn')).not.toBeInTheDocument();
});

/** The spanning retry edge, keyed the way the layout keys it: position 5. */
const RETURN_RUN = edgeKey(5);

/** Puts the graph on V1 with the comparison held down. */
async function heldOverV1() {
  await cardsOf(branched);
  await applyOn(HAND_COPY);
  await waitFor(() => expect(cardLabels()).toContain('Reconcile in one pass'), LAYOUT_WAIT);
  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());
}

/** The original's geometry, read back off the picture the comparison drew. */
function ghostBoxes() {
  return screen.getAllByTestId('sg-xray-card').map((el) => ({
    id: el.getAttribute('data-id') ?? '',
    x: parseFloat(el.style.left),
    y: parseFloat(el.style.top),
    width: parseFloat(el.style.width),
    height: parseFloat(el.style.height),
  }));
}

// A back-edge that only clears the two rows it connects cuts through whatever
// stands between them — and, worse in a COMPARE tool, draws an unchanged edge
// hundreds of pixels away from where the live graph draws the same edge. The
// ghost plans its lanes the way the live graph does, off its own layout.
it('routes a ghost back-edge through the original’s own lane plan', async () => {
  render(<GraphCanvas workflow={branched} />);
  await heldOverV1();

  const boxes = ghostBoxes();
  const at = new Map(boxes.map((b) => [b.id, b]));
  const plan = planBackEdges(
    boxes,
    branched.edges.map((e, i) => ({ id: edgeKey(i), from: e.from, to: e.to })),
  );
  const lane = plan.get(RETURN_RUN);
  const ship = at.get('ship')!;
  const intake = at.get('intake')!;

  // the plan is doing real work on this graph: the run drops below a card that
  // belongs to neither end, which is exactly what the fallback cannot know
  expect(lane).toBeDefined();
  expect(lane!.floorY).toBeGreaterThan(
    Math.max(ship.y + ship.height, intake.y + intake.height),
  );

  const routed = backEdgePath({
    sx: ship.x + ship.width,
    sy: ship.y + ship.height / 2,
    tx: intake.x,
    ty: intake.y + intake.height / 2,
    ...lane,
  }).d;
  const drawn = [...document.querySelectorAll('.sg-xray-edge')].map((p) => p.getAttribute('d'));
  expect(drawn).toContain(routed);
});

// The plan belongs to a layout that never changes, so it is worked out with that
// layout and kept — not recomputed every time the button goes down.
it('plans the original’s lanes once per session, not once per render', async () => {
  render(<GraphCanvas workflow={branched} />);
  // the ghost plans against ELK's own nodes, which carry the workflow step; the
  // live graph plans against React Flow's boxes, which do not
  const ghostPlans = () =>
    planned.mock.calls.filter(([nodes]) => nodes.some((n) => 'node' in n)).length;

  await heldOverV1();
  expect(ghostPlans()).toBe(1);

  // release, hold again, and put the glow on top: three more renders of the layer
  fireEvent.pointerUp(xrayBtn());
  await waitFor(() => expect(screen.queryByTestId('xray-layer')).not.toBeInTheDocument());
  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());
  fireEvent.click(critBtn());
  await waitFor(() =>
    expect(document.querySelectorAll('.sg-node--critical').length).toBeGreaterThan(0),
  );

  expect(ghostPlans()).toBe(1);
});

// ---------------------------------------------------------------------------
// Critical path: the most painful way through
// ---------------------------------------------------------------------------

it('glows the most painful route and leaves the cheap branch alone', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  expect(critBtn()).toHaveTextContent('CRITICAL PATH');
  expect(critBtn()).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  expect(critBtn()).toHaveAttribute('aria-pressed', 'true');
  expect(criticalLabels()).toContain(HAND_COPY);
  expect(criticalLabels()).not.toContain(NIGHTLY);
  // the three hops along it, and neither of the two around the cheap branch
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(3);
  }, LAYOUT_WAIT);
});

it('takes the glow off again when the toggle is released', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0));
  expect(document.querySelectorAll('path.sg-edge--critical')).toHaveLength(0);
  // and the graph comes all the way back up with it: nothing is left standing at
  // the dim, in either the class or the attribute that carries it into a picture
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);
  expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-edge-tag--offpath')).toHaveLength(0);
  expect(container.querySelectorAll(`path.sg-edge[opacity="${DIM}"]`)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The inversion. The route keeps the treatment it has always had; what changes
// is the rest of the graph, which steps back out of its way — the same
// stepped-back grammar VS ORIGINAL already uses on the layer it holds down.
// ---------------------------------------------------------------------------

it('steps the off-path graph back — nodes, edges and the tags on them', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  // nothing steps back until there is a route to step back FROM
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  // the one step off the route, and only it
  await waitFor(() => expect(offPathLabels()).toEqual([NIGHTLY]));
  // the route's own cards keep exactly what they had: glow, and no dim
  expect(criticalLabels()).toContain(HAND_COPY);
  for (const card of document.querySelectorAll('.sg-node--critical')) {
    expect(card.closest('.sg-node-shell')!.classList.contains('sg-node-shell--offpath')).toBe(
      false,
    );
  }

  // the two branch hops around the cheap route and the retry that spans the
  // graph — every edge the route does not run along
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);
  expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(3);
  // and never both at once
  expect(container.querySelectorAll('path.sg-edge--critical.sg-edge--offpath')).toHaveLength(0);

  // the conditions hanging off those edges go with them; the one on the route stays
  expect(offPathTagText()).toEqual(expect.arrayContaining(['overnight', 'breaks']));
  expect(offPathTagText()).not.toContain('row by row');
});

/**
 * The T3 lesson, pinned at the level it actually bites: html-to-image does not
 * carry CSS-derived presentation onto cloned SVG children, so a dim that lived
 * only in a class would export as a graph where nothing stepped back — the
 * shared picture would contradict the screen about which run is expensive.
 */
it('states the off-path dim as an attribute, so an exported picture carries it', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);

  const dimmed = [...container.querySelectorAll('path.sg-edge--offpath')];
  expect(dimmed.map((p) => p.getAttribute('opacity'))).toEqual([DIM, DIM, DIM]);
  // the route is untouched — full strength, as it has always been
  for (const path of container.querySelectorAll('path.sg-edge--critical')) {
    expect(path.getAttribute('opacity')).toBe('1');
  }
});

// Stepped back is not switched off. The cheap branch is still a step you can ask
// about — dimming it says "not the expensive route", not "not available".
it('leaves a stepped-back card open to a pointer', async () => {
  render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(offPathLabels()).toEqual([NIGHTLY]));

  fireEvent.click(cardFor(NIGHTLY, screen.getAllByTestId('sg-node')));
  expect(await screen.findByTestId('detail-drawer')).toHaveTextContent(NIGHTLY);
});

// A graph the sweep cannot answer about points at nothing — and a dim with
// nothing lit beside it is a whole picture stepped back for no stated reason.
it('steps nothing back on a graph with no route to point at', async () => {
  const { container } = render(<GraphCanvas workflow={cyclic} />);
  await cardsOf(cyclic);

  fireEvent.click(critBtn());
  // the toggle is down and the canvas says so, but there is no answer to draw
  expect(critBtn()).toHaveAttribute('aria-pressed', 'true');
  // waited on a POSITIVE fact, so the absences below are read off a graph that
  // has actually drawn its edges rather than one that has not got to them yet
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge')).toHaveLength(cyclic.edges.length);
  }, LAYOUT_WAIT);

  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);
  expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-edge-tag--offpath')).toHaveLength(0);
});

// The payoff: consolidating the two hand steps makes the nightly branch the worst
// way through, and the glow moves onto it without the toggle being touched.
it('recomputes the route on the version that is on screen', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(criticalLabels()).toContain(HAND_COPY));

  await applyOn(HAND_COPY);
  await waitFor(() => expect(cardLabels()).toContain('Reconcile in one pass'), LAYOUT_WAIT);

  await waitFor(() => expect(criticalLabels()).toEqual(expect.arrayContaining([NIGHTLY])));
  expect(criticalLabels()).not.toContain('Reconcile in one pass');
  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(3);
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(2);
  }, LAYOUT_WAIT);

  // and the boundary moves with the glow: the step that used to BE the route is
  // now the cheap way through, so it is the one that steps back
  await waitFor(() => expect(offPathLabels()).toEqual(['Reconcile in one pass']));
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);
});

// ---------------------------------------------------------------------------
// Both at once
// ---------------------------------------------------------------------------

it('composes: the original underneath, the route glowing on the live graph', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  await applyOn(HAND_COPY);
  await waitFor(() => expect(cardLabels()).toContain('Reconcile in one pass'), LAYOUT_WAIT);

  fireEvent.click(critBtn());
  fireEvent.pointerDown(xrayBtn());
  await waitFor(() => expect(screen.getByTestId('xray-layer')).toBeInTheDocument());

  // the original, whole, including both steps the patch consolidated
  expect(ghostLabels()).toEqual(expect.arrayContaining([HAND_COPY, 'Check the copy by hand']));
  // and the glow reads the LIVE graph only — the picture underneath is not analysed
  expect(document.querySelectorAll('.sg-xray-card.sg-node--critical')).toHaveLength(0);
  expect(criticalLabels()).toContain(NIGHTLY);

  // The two overlays answer different questions, so they are stated separately:
  // the route's dim belongs to the LIVE layer and lands on it exactly once, and
  // the comparison underneath is a picture of the past — it has no route of its
  // own to be on or off, so nothing there steps back a second time.
  await waitFor(() => expect(offPathLabels()).toEqual(['Reconcile in one pass']));
  const ghost = screen.getByTestId('xray-layer');
  expect(ghost.querySelectorAll('.sg-xray-card').length).toBe(branched.nodes.length);
  expect(ghost.querySelectorAll('[class*="--offpath"]')).toHaveLength(0);
  expect(ghost.querySelectorAll('[opacity]')).toHaveLength(0);
  // one dim, not two multiplied together
  for (const path of container.querySelectorAll('path.sg-edge--offpath')) {
    expect(path.getAttribute('opacity')).toBe(DIM);
  }
});
