import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applyOn, cardLabels, cardsOf, fixture, LAYOUT_WAIT } from '../test/harness';
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
    { from: 'manual-a', to: 'manual-b', kind: 'sequence' },
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

const HAND_COPY = 'Copy the rows by hand';
const NIGHTLY = 'Let the nightly job run';

const labelsOf = (els: Element[]) =>
  els.map((el) => el.querySelector('.sg-label')?.textContent ?? '');

/** The steps the glow is on, whatever version is drawn. */
const criticalLabels = () => labelsOf([...document.querySelectorAll('.sg-node--critical')]);
/** The copies of the original held under the live graph. */
const ghostLabels = () => labelsOf(screen.getAllByTestId('sg-xray-card'));

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
  render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0));
  expect(document.querySelectorAll('path.sg-edge--critical')).toHaveLength(0);
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
});

// ---------------------------------------------------------------------------
// Both at once
// ---------------------------------------------------------------------------

it('composes: the original underneath, the route glowing on the live graph', async () => {
  render(<GraphCanvas workflow={branched} />);
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
});
