import { readFileSync } from 'node:fs';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import {
  applyOn,
  cardFor,
  cardLabels,
  cardsOf,
  fixture,
  LAYOUT_WAIT,
  reduceMotion,
} from '../test/harness';
import { createSession } from '../graph/apply';
import { layoutWorkflow } from '../graph/layout';
import { impactSummary } from '../graph/metrics';
import { dotCentre, entryPath, exitPath } from './EndpointMarks';
import { GraphCanvas } from './GraphCanvas';
import { WipeCompare } from './WipeCompare';

/**
 * VS ORIGINAL as a wipe: a single-purpose mode holding the original and the
 * live graph on the two sides of a draggable divider. This suite drives the
 * whole mode through the canvas — the toggle, the clip, the divider, the
 * snapshot the original is drawn from, and everything the mode stands down
 * while it is open.
 */

const enriched = fixture(enrichedDoc, 'enriched');
const plain = fixture(gallery, 'gallery');

const RESEARCH = 'Research the libraries & read the docs';
const RESEARCH_MCP = 'Pull the docs in-session';
const SCAFFOLD = 'Scaffold the module & wire it up';
const CODE = 'Write the feature, one slice at a time';

/** U+2212, the sign every saving is written with — see metrics.ts. */
const MINUS = '−';

/** The pane's box, which jsdom measures as 0×0 unless told otherwise. */
const PANE_WIDTH = 1024;

/**
 * Gives the pane a real width, so the divider has something to divide. jsdom
 * lays nothing out — without this every fraction of the pane is 0px and Home,
 * End and the arrows would all be the same place.
 */
function stubPane(container: HTMLElement, width = PANE_WIDTH, left = 0) {
  const pane = container.querySelector<HTMLElement>('.sg-viewport')!;
  Object.defineProperty(pane, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 640,
      width,
      height: 640,
      toJSON() {},
    }),
  });
}

const wipeBtn = () => screen.getByTestId('wipe-btn');
const handle = () => screen.getByTestId('wipe-handle');
const liveClip = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.react-flow')!.style.clipPath;

/** On V1 with the pane measured — the state every mode test starts from. */
async function onV1(container: HTMLElement) {
  await cardsOf(enriched);
  await applyOn(RESEARCH);
  await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);
  stubPane(container);
}

async function openWipe() {
  fireEvent.click(wipeBtn());
  await waitFor(() => expect(screen.getByTestId('wipe-under')).toBeInTheDocument());
}

/** Where React Flow has a card, off the transform it writes on the wrapper. */
function at(el: HTMLElement): { x: number; y: number } {
  const m = el.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  if (!m) throw new Error(`no position on ${el.getAttribute('data-id')}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Where the original layer put a card, off its inline box. */
function underBox(id: string): { x: number; y: number } {
  const card = screen
    .getAllByTestId('wipe-card')
    .find((el) => el.getAttribute('data-id') === id);
  if (!card) throw new Error(`no original card for ${id}`);
  return { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };
}

/** The full box the original layer drew a card in — what the marks hang off. */
function underRect(id: string): { x: number; y: number; width: number; height: number } {
  const card = screen
    .getAllByTestId('wipe-card')
    .find((el) => el.getAttribute('data-id') === id);
  if (!card) throw new Error(`no original card for ${id}`);
  return {
    x: parseFloat(card.style.left),
    y: parseFloat(card.style.top),
    width: parseFloat(card.style.width),
    height: parseFloat(card.style.height),
  };
}

const wrapper = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;

/**
 * The labels on the LIVE side only. The harness's `cardLabels` reads every card
 * in the document, and while the wipe is open the original layer renders real
 * card bodies too — which is the feature, not a leak, but it means live-side
 * questions have to be scoped to React Flow's own pane.
 */
const liveLabels = (container: HTMLElement) =>
  [...container.querySelectorAll('.react-flow [data-testid="sg-node"] .sg-label')].map(
    (el) => el.textContent ?? '',
  );

/**
 * One step of a divider drag. jsdom has no PointerEvent, so testing-library
 * builds these on the base Event constructor and the coordinate is lost — it is
 * defined on the instance instead, the same move the harness's `mouse` makes
 * for d3-drag's `view`.
 */
function point(type: 'pointerDown' | 'pointerMove' | 'pointerUp', target: Element, x: number) {
  const event = createEvent[type](target, { clientX: x });
  Object.defineProperty(event, 'clientX', { value: x });
  fireEvent(target, event);
}

// ---------------------------------------------------------------------------
// The mode: in, out, and when it is on offer at all
// ---------------------------------------------------------------------------

// Comparing V0 with V0 is a picture of one graph drawn twice. The toggle only
// means something once there is a difference to see.
it('offers no comparison while the original is what is on screen', async () => {
  render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  expect(screen.queryByTestId('wipe-btn')).not.toBeInTheDocument();

  await applyOn(RESEARCH);
  await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

  expect(wipeBtn()).toHaveTextContent('VS ORIGINAL');
  expect(wipeBtn()).toHaveAttribute('aria-pressed', 'false');
});

it('toggles the wipe open and closed, clipping the live canvas at the divider', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);

  await openWipe();
  expect(wipeBtn()).toHaveAttribute('aria-pressed', 'true');
  // the divider opens in the middle, and the live canvas is clipped up to it
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH / 2}px)`));
  expect(handle()).toHaveAttribute('role', 'slider');
  expect(handle()).toHaveAttribute('aria-valuenow', '50');
  // the divider is the mode's one control, so it takes the keyboard on open
  expect(document.activeElement).toBe(handle());
  // its two sides are named on the seam
  expect(handle()).toHaveTextContent('ORIGINAL');
  expect(handle()).toHaveTextContent('NOW');
  // and the entrance is animated at the default motion setting
  expect(screen.getByTestId('wipe-under').className).toContain('sg-wipe--animate');

  fireEvent.click(wipeBtn());
  await waitFor(() => expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument());
  expect(wipeBtn()).toHaveAttribute('aria-pressed', 'false');
  expect(liveClip(container)).toBe('');
});

it('exits on Escape and hands focus back to the toggle', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument());

  expect(screen.queryByTestId('wipe-handle')).not.toBeInTheDocument();
  expect(liveClip(container)).toBe('');
  // ESC was pressed with focus on a handle that just unmounted — the toggle is
  // where the mode's keyboard belongs afterwards
  await waitFor(() => expect(document.activeElement).toBe(wipeBtn()));
});

// A fresh file on the viewer is a fresh session at V0 — the mode must not
// survive into a graph that has nothing to compare.
it('closes when a new workflow lands mid-wipe', async () => {
  const { container, rerender } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  rerender(<GraphCanvas workflow={plain} />);
  await cardsOf(plain);

  expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument();
  expect(screen.queryByTestId('wipe-btn')).not.toBeInTheDocument();
});

it('takes the comparison away when the cursor walks back to the original', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  // the strip is away while the mode is open — leave first, then walk back
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument());
  fireEvent.click(screen.getByTestId('undo-btn'));
  await waitFor(() => expect(cardLabels()).toContain(RESEARCH), LAYOUT_WAIT);

  expect(screen.queryByTestId('wipe-btn')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// The divider
// ---------------------------------------------------------------------------

it('moves the clip with the handle: arrows step it, Home and End snap it', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH / 2}px)`));

  fireEvent.keyDown(handle(), { key: 'ArrowRight' });
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH / 2 + 32}px)`));
  // the deltas travel with the seam they explain
  expect(screen.getByTestId('wipe-deltas').style.left).toBe(`${PANE_WIDTH / 2 + 32}px`);
  expect(handle().style.left).toBe(`${PANE_WIDTH / 2 + 32}px`);

  fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH / 2}px)`));

  fireEvent.keyDown(handle(), { key: 'Home' });
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 0px)'));
  expect(handle()).toHaveAttribute('aria-valuenow', '0');

  fireEvent.keyDown(handle(), { key: 'End' });
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH}px)`));
  expect(handle()).toHaveAttribute('aria-valuenow', '100');
  // and the original layer's own clip is the complement — nothing of the past
  // bleeds through on the NOW side of the seam
  expect(screen.getByTestId('wipe-under').style.clipPath).toBe('inset(0 0px 0 0)');
});

it('follows a pointer drag, and stops following when the pointer lifts', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  point('pointerDown', handle(), 700);
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 700px)'));

  point('pointerMove', handle(), 300);
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 300px)'));

  point('pointerUp', handle(), 300);
  point('pointerMove', handle(), 900);
  expect(liveClip(container)).toBe('inset(0 0 0 300px)');
});

/**
 * The keyboard AFTER the pointer, which is where the first cut died: its
 * pointerdown prevented default, which in a browser suppresses the focus a
 * click confers — pan the canvas once and no click on the handle could ever
 * bring the arrows back. The grab itself must hand the keyboard over, and the
 * arrows are fired at whatever HOLDS focus — not at the handle by name —
 * because that is the question a real keyboard asks.
 */
it('keeps the keyboard through a pointer drag: grabbing the handle focuses it', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  // the mount-time focus is gone — a pan, a click on the pane, anything.
  // Blurred off whatever HOLDS it, not off the handle by name: under a loaded
  // run the drawer's own focus-return can land after the wipe opens.
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);

  point('pointerDown', handle(), 700);
  point('pointerUp', handle(), 700);
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 700px)'));
  expect(document.activeElement).toBe(handle());

  fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 668px)'));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 0px)'));
});

// The fraction is what survives a resize, not the pixel: the divider keeps
// dividing the pane it can see.
it('keeps its split of the pane when the window resizes mid-wipe', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();
  await waitFor(() => expect(liveClip(container)).toBe(`inset(0 0 0 ${PANE_WIDTH / 2}px)`));

  stubPane(container, 800);
  fireEvent(window, new Event('resize'));
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 400px)'));
});

// ---------------------------------------------------------------------------
// The original layer
// ---------------------------------------------------------------------------

it('renders the original at full fidelity: real cards, real edges, its own pips', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  const under = within(screen.getByTestId('wipe-under'));
  // every V0 card, whole: label, description, pain meter — not a silhouette
  expect(screen.getAllByTestId('wipe-card')).toHaveLength(enriched.nodes.length);
  expect(under.getAllByTestId('sg-node')).toHaveLength(enriched.nodes.length);
  expect(under.getByText(RESEARCH)).toBeInTheDocument();
  expect(under.getAllByTestId('sg-meter')).toHaveLength(enriched.nodes.length);
  // the step the patch consumed is on the original side and only there
  expect(liveLabels(container)).not.toContain(RESEARCH);
  // V0's own suggestion pips — the picture of where the opportunities stood
  expect(under.getAllByTestId('sg-badge')).toHaveLength(4);
  // every V0 edge, in the live vocabulary, arrowheads included
  const paths = screen.getByTestId('wipe-under').querySelectorAll('path.sg-edge');
  expect(paths).toHaveLength(enriched.edges.length);
  for (const p of paths) expect(p.getAttribute('marker-end')).toBe('url(#ut-arrow)');
  // and the conditions on those edges ride along as tags
  expect(under.getByText('all green')).toBeInTheDocument();
});

// The endpoints survive every patch, so their marks are the one piece of ink
// that stands in BOTH versions at the same place — a wipe across them must
// show one continuous mark, not a mark that blinks out on the original side.
it('hangs the endpoint marks off the original layer, same geometry as the live ones', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  const under = within(screen.getByTestId('wipe-under'));
  // the entry stroke and chevron, into the input's left port — drawn against
  // the box the original card actually stands in
  const entry = under.getByTestId('sg-mark-entry');
  expect(entry.getAttribute('data-id')).toBe('gather-brief');
  const input = { id: 'gather-brief', kind: 'input' as const, ...underRect('gather-brief') };
  expect(entry.getAttribute('d')).toBe(entryPath(input));
  // the exit run and its terminal dot, after the output's right port
  const exit = under.getByTestId('sg-mark-exit');
  expect(exit.getAttribute('data-id')).toBe('ship-release');
  const output = { id: 'ship-release', kind: 'output' as const, ...underRect('ship-release') };
  expect(exit.getAttribute('d')).toBe(exitPath(output));
  const dot = under.getByTestId('sg-mark-dot');
  const centre = dotCentre(output);
  expect(parseFloat(dot.getAttribute('cx')!)).toBeCloseTo(centre.cx, 1);
  expect(parseFloat(dot.getAttribute('cy')!)).toBeCloseTo(centre.cy, 1);
});

it('is a picture, not a graph: hidden from readers and closed to the pointer', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  const under = screen.getByTestId('wipe-under');
  expect(under).toHaveAttribute('aria-hidden', 'true');
  expect(under.style.pointerEvents).toBe('none');
});

/**
 * The headline correction of the whole mode: the original is drawn from the
 * positions React Flow had at the FIRST apply — the user's own arrangement,
 * drags included — and anchored so its input stands exactly on the live input.
 * The rejected version redrew V0 from a fresh ELK pass, which threw away every
 * drag the user had made.
 */
it('draws the original from the snapshot: a drag made before the first apply survives', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await cardsOf(enriched);

  // seed the drag: pull the scaffold step well out of its ELK row
  const scaffold = wrapper(container, 'scaffold-repo');
  const before = at(scaffold);
  const card = cardFor(SCAFFOLD, screen.getAllByTestId('sg-node'));
  fireEvent.click(card);
  await screen.findByTestId('detail-drawer');
  for (let i = 0; i < 6; i++) fireEvent.keyDown(card, { key: 'ArrowDown', shiftKey: true });
  await waitFor(() => expect(at(scaffold).y).not.toBe(before.y));
  const dragged = at(scaffold);
  const inputAtApply = at(wrapper(container, 'gather-brief'));
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument());

  // the first apply CONSUMES the dragged step — its position survives only in
  // the snapshot taken at that moment
  await applyOn(CODE);
  await waitFor(() => expect(cardLabels()).not.toContain(SCAFFOLD), LAYOUT_WAIT);

  stubPane(container);
  await openWipe();

  await waitFor(() => {
    const liveInput = at(wrapper(container, 'gather-brief'));
    // start-anchored: the original's way in stands exactly on the live one
    expect(underBox('gather-brief').x).toBeCloseTo(liveInput.x, 1);
    expect(underBox('gather-brief').y).toBeCloseTo(liveInput.y, 1);
    // and relative to that shared start, the consumed card stands where the
    // user LEFT it — not where ELK first dealt it
    expect(underBox('scaffold-repo').y - underBox('gather-brief').y).toBeCloseTo(
      dragged.y - inputAtApply.y,
      1,
    );
    expect(underBox('scaffold-repo').x - underBox('gather-brief').x).toBeCloseTo(
      dragged.x - inputAtApply.x,
      1,
    );
  });
});

// The fallback for a snapshot that never happened: the original's own layout,
// as ELK answered it. Rendered directly because the canvas cannot reach this
// state — it always captures at the first apply — but the component must not
// depend on that.
it('falls back to the laid-out positions when no snapshot exists', async () => {
  const laidOut = await layoutWorkflow(enriched);
  const onClip = vi.fn();
  render(
    <WipeCompare
      original={enriched}
      laidOut={laidOut}
      snapshot={null}
      shift={{ dx: 0, dy: 0 }}
      transform=""
      summary={impactSummary(createSession(enriched))}
      onClip={onClip}
      onExit={() => {}}
    />,
  );

  for (const n of laidOut.nodes) {
    expect(underBox(n.id)).toEqual({ x: n.x, y: n.y });
  }
  // and the clip is stated on mount, so the canvas is never wearing a stale one
  expect(onClip).toHaveBeenCalledWith(expect.stringMatching(/^inset\(0 0 0 \d+px\)$/));
});

// ---------------------------------------------------------------------------
// The delta readout
// ---------------------------------------------------------------------------

it('floats the headline deltas at the seam, in the shared vocabulary', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  await openWipe();

  const deltas = screen.getByTestId('wipe-deltas');
  // the applied patch's own figures, written the way every surface writes them
  expect(deltas).toHaveTextContent(`${MINUS}1 step`);
  expect(deltas).toHaveTextContent(`${MINUS}25 min`);
  // pain 18 → 16 on this graph: an 11% reduction, stated with the same sign
  expect(deltas).toHaveTextContent(`pain ${MINUS}11%`);
  // the honesty rule rides along: this patch claimed no tokens, so no token chip
  expect(deltas).not.toHaveTextContent('tok');
});

// ---------------------------------------------------------------------------
// What the mode stands down
// ---------------------------------------------------------------------------

it('disables EXPORT while the wipe is open — the mode is transient', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  expect(screen.getByTestId('export-btn')).toBeEnabled();

  await openWipe();
  expect(screen.getByTestId('export-btn')).toBeDisabled();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.getByTestId('export-btn')).toBeEnabled());
});

it('is a single-purpose view: OPTIMIZE and the version strip step away, the drawer stays shut', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);
  expect(screen.getByTestId('optimize-btn')).toBeInTheDocument();
  expect(screen.getByTestId('version-strip')).toBeInTheDocument();
  expect(screen.getByTestId('reset-layout')).toBeEnabled();

  await openWipe();
  expect(screen.queryByTestId('optimize-btn')).not.toBeInTheDocument();
  expect(screen.queryByTestId('version-strip')).not.toBeInTheDocument();
  expect(screen.getByTestId('critpath-btn')).toBeDisabled();
  // the results window's standing entry stands down with the other
  // read-the-graph controls: a modal opened over the seam would be two modes
  // fighting for one canvas
  expect(screen.getByTestId('prompt-btn')).toBeDisabled();
  // RESET LAYOUT was the one control left that MOVES the live half: a relayout
  // mid-compare walks the cards away from an original anchored on where they
  // were, and the two sides stop being one world with the seam still open
  expect(screen.getByTestId('reset-layout')).toBeDisabled();

  // a click on a live card opens nothing while the comparison holds the canvas
  fireEvent.click(cardFor(RESEARCH_MCP, screen.getAllByTestId('sg-node')));
  expect(screen.queryByTestId('detail-drawer')).not.toBeInTheDocument();

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.getByTestId('optimize-btn')).toBeInTheDocument());
  expect(screen.getByTestId('version-strip')).toBeInTheDocument();
  expect(screen.getByTestId('critpath-btn')).toBeEnabled();
  expect(screen.getByTestId('reset-layout')).toBeEnabled();
  expect(screen.getByTestId('prompt-btn')).toBeEnabled();
});

/**
 * The drag that had nothing to grab. The live layer's clip stops it hit-testing
 * left of the divider, so a pointer drag on the ORIGINAL side falls through to
 * plain DOM — and with nothing said about selection, the browser answered with
 * its own default and dragged a highlight across the title, the panels and every
 * chip it could reach. The mode closes the surface to selection for as long as
 * it holds it, and opens it again on the way out.
 */
it('closes the canvas to text selection while the wipe holds it, and opens it again on exit', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);

  const canvas = screen.getByTestId('canvas');
  // the modifier is what the no-select rule in canvas.css is written against —
  // the base class says nothing about selection, so outside the mode every
  // surface keeps its own word on the subject
  expect(canvas.className).not.toContain('sg-canvas--wipe');
  expect(readFileSync('src/components/canvas.css', 'utf8')).toMatch(
    /\.sg-canvas--wipe \{[^}]*user-select:\s*none/,
  );

  await openWipe();
  expect(canvas.className).toContain('sg-canvas--wipe');

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument());
  // the surface is text again the moment the mode lets go
  expect(canvas.className).not.toContain('sg-canvas--wipe');
});

/**
 * A highlight dragged before the toggle would have no gesture left to clear it,
 * the canvas taking no selection for the mode's whole life. So the mode opens on
 * a clean surface.
 *
 * Asked as "is the highlight still standing on what it was made over", not as
 * "is the range count zero": jsdom's `focus()` writes a document selection over
 * whatever it focuses, which no browser does, so the handle taking the keyboard
 * on open leaves a range behind here that exists nowhere else. What the fix owes
 * the reader is that THEIR selection is gone, and that is what this asks.
 */
it('drops a selection made before the wipe opened', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);

  const title = container.querySelector('.sg-wf-title')!;
  const range = document.createRange();
  range.selectNodeContents(title);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(title.contains(selection.anchorNode)).toBe(true);

  await openWipe();
  expect(title.contains(window.getSelection()!.anchorNode)).toBe(false);
});

/**
 * The rail stands at z5 and the divider at z4, so dragging the seam rightwards —
 * the mode's whole gesture — used to walk the handle and its deltas in behind
 * the impact panel: numbers unreadable, handle ungrabbable, in the exact band
 * the demo travels through. So the rail goes out of sight with the version strip.
 *
 * HIDDEN, not unmounted, and this is the test that says which: the panel in it
 * is holding state nobody re-made — folded away to its tab before the press —
 * and an unmount discarded that, so the comparison quietly undid the setup the
 * user made to get a look at the graph in the first place.
 *
 * jsdom lays nothing out and vitest never loads the CSS, so the rule that does
 * the hiding is read off the stylesheet the way railHeight.test.ts reads the
 * bounds it pins; what is driven here is that the subtree survives the round trip
 * holding exactly what it held.
 */
it('hides the rail inside the wipe, and brings it back holding what it held', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);

  const rail = screen.getByTestId('canvas-rail');
  expect(rail).toContainElement(screen.getByTestId('impact-panel'));

  // set the rail up the way a reader would before pressing VS ORIGINAL: fold
  // the impact panel away to its tab
  fireEvent.click(screen.getByTestId('impact-toggle'));
  expect(screen.getByTestId('impact-toggle')).toHaveAttribute('aria-expanded', 'false');

  await openWipe();
  // the modifier is what the rule is written against, and the rule takes the
  // column out of the layout, out of the pointer's way and out of the tab order
  expect(screen.getByTestId('canvas').className).toContain('sg-canvas--wipe');
  expect(readFileSync('src/components/canvas.css', 'utf8')).toMatch(
    /\.sg-canvas--wipe \.sg-rail \{\s*display:\s*none;/,
  );
  // nothing of the rail's is left to paint over the seam — the figures are told
  // at the divide instead, and the handle is grabbable the whole way across
  expect(screen.getByTestId('wipe-deltas')).toBeInTheDocument();
  point('pointerDown', handle(), 1000);
  await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 1000px)'));
  expect(screen.getByTestId('wipe-deltas').style.left).toBe('1000px');

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('wipe-under')).not.toBeInTheDocument());
  expect(screen.getByTestId('canvas-rail')).toBeInTheDocument();
  expect(screen.getByTestId('impact-panel')).toBeInTheDocument();
  // and it comes back exactly as it was — still folded. The mode is a way of
  // looking at the graph, not a reason to re-make the surface around it.
  expect(screen.getByTestId('impact-toggle')).toHaveAttribute('aria-expanded', 'false');
});

// The route would glow on only one side of the divider and read as a difference
// between the versions — so it stands down with the rest, and comes back where
// the toggle left it.
it('stands the critical path down inside the wipe and restores it on exit', async () => {
  const { container } = render(<GraphCanvas workflow={enriched} />);
  await onV1(container);

  fireEvent.click(screen.getByTestId('critpath-btn'));
  await waitFor(() =>
    expect(document.querySelectorAll('.sg-node--critical').length).toBeGreaterThan(0),
  );

  await openWipe();
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0));
  expect(screen.getByTestId('critpath-btn')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() =>
    expect(document.querySelectorAll('.sg-node--critical').length).toBeGreaterThan(0),
  );
});

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

it('drops the entrance under reduced motion, and the divider still answers', async () => {
  const restore = reduceMotion();
  try {
    const { container } = render(<GraphCanvas workflow={enriched} />);
    await onV1(container);
    await openWipe();

    // no animated arrival on any of the mode's own elements
    expect(screen.getByTestId('wipe-under').className).not.toContain('sg-wipe--animate');
    expect(handle().className).not.toContain('sg-wipe--animate');
    expect(screen.getByTestId('wipe-deltas').className).not.toContain('sg-wipe--animate');

    // the mode itself is untouched: the handle moves and the clip follows
    fireEvent.keyDown(handle(), { key: 'Home' });
    await waitFor(() => expect(liveClip(container)).toBe('inset(0 0 0 0px)'));
  } finally {
    restore();
  }
});
