import { render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { EXPORT_PADDING } from '../graph/exportPng';
import { NODE_HEIGHT, NODE_WIDTH } from '../graph/layout';
import { cardsOf, fixture, LAYOUT_WAIT } from '../test/harness';
import {
  dotCentre,
  DOT_R,
  EndpointMarks,
  entryPath,
  exitPath,
  MARK_REACH,
  type EndpointBox,
} from './EndpointMarks';
import { GraphCanvas } from './GraphCanvas';

const wf = fixture(gallery, 'gallery');

/**
 * The palette, where the app keeps it. jsdom loads no stylesheet, so this is the
 * only place `--accent` resolves from — and the marks read it at render time, so
 * an ink literal in the component would fail these outright.
 */
const ACCENT = 'rgb(163, 230, 53)';

function installAccent(): () => void {
  document.documentElement.style.setProperty('--accent', ACCENT);
  return () => document.documentElement.style.removeProperty('--accent');
}

const box = (over: Partial<EndpointBox> = {}): EndpointBox => ({
  id: 'gather',
  kind: 'input',
  x: 400,
  y: 200,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
  ...over,
});

// ---------------------------------------------------------------------------
// The geometry
// ---------------------------------------------------------------------------

it('runs the entry stroke into the left port and points it at the card', () => {
  const at = box();
  const y = at.y + NODE_HEIGHT / 2;
  const d = entryPath(at);

  // starts a fixed reach back from the card, on the port's own line
  expect(d.startsWith(`M ${at.x - MARK_REACH} ${y} `)).toBe(true);
  // and every point it visits is to the LEFT of the card — a stroke that touched
  // the border would be drawn under the card it is pointing at
  for (const [, px] of d.matchAll(/(?:M|L) (-?[\d.]+) /g)) {
    expect(Number(px)).toBeLessThan(at.x);
  }
  // the chevron: two arms meeting at the head, which is the point nearest the card
  expect(d.split('M')).toHaveLength(3);
});

it('runs the exit stroke out of the right port, up to the dot that ends it', () => {
  const at = box({ kind: 'output' });
  const y = at.y + NODE_HEIGHT / 2;
  const d = exitPath(at);
  const [, from, to] = /^M (-?[\d.]+) [\d.]+ L (-?[\d.]+) /.exec(d)!;
  const { cx, cy } = dotCentre(at);

  expect(d).toContain(` ${y} `);
  // clear of the card, and clear of the port ring straddling its edge
  expect(Number(from)).toBeGreaterThan(at.x + at.width);
  // meets the dot rather than running under it or stopping short of it
  expect(Number(to)).toBe(cx - DOT_R);
  expect(cy).toBe(y);
  // and the dot's far edge is where the whole mark ends
  expect(cx + DOT_R).toBe(at.x + at.width + MARK_REACH);
});

/**
 * The marks hang off the two cards at the outside of the frame an export is cut
 * to: `contentBounds` unions the cards, the edges and the tags, and these are
 * none of those. What keeps them in the picture is the padding around it, so the
 * relationship is asserted rather than assumed — a longer mark would silently
 * start exporting clipped.
 */
it('reaches less far than the export pads, so a shared picture keeps them', () => {
  // MARK_REACH is the OUTERMOST ink on either side — the entry stroke's tail and
  // the terminal dot's far edge, both asserted above — so this one comparison
  // covers every mark the canvas draws.
  expect(MARK_REACH).toBeLessThan(EXPORT_PADDING);
});

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

it('inks the marks as presentation attributes, which is what an export keeps', () => {
  const restore = installAccent();
  render(
    <EndpointMarks boxes={[box(), box({ id: 'delivered', kind: 'output', x: 900 })]} />,
  );

  const entry = screen.getByTestId('sg-mark-entry');
  expect(entry).toHaveAttribute('stroke', ACCENT);
  expect(entry).toHaveAttribute('stroke-width', '2');
  expect(entry).toHaveAttribute('fill', 'none');

  const exit = screen.getByTestId('sg-mark-exit');
  expect(exit).toHaveAttribute('stroke', ACCENT);

  // filled, not stroked: an SVG shape with no fill of its own exports BLACK
  const dot = screen.getByTestId('sg-mark-dot');
  expect(dot).toHaveAttribute('fill', ACCENT);
  expect(dot).toHaveAttribute('r', '3');
  restore();
});

it('marks every input and every output, and nothing in between', () => {
  const restore = installAccent();
  render(
    <EndpointMarks
      boxes={[
        box({ id: 'in-a' }),
        box({ id: 'in-b', y: 600 }),
        box({ id: 'middle', kind: 'process', x: 700 }),
        box({ id: 'out', kind: 'output', x: 1200 }),
      ]}
    />,
  );

  expect(screen.getAllByTestId('sg-mark-entry').map((el) => el.getAttribute('data-id'))).toEqual([
    'in-a',
    'in-b',
  ]);
  expect(screen.getAllByTestId('sg-mark-exit')).toHaveLength(1);
  expect(screen.getAllByTestId('sg-mark-dot')).toHaveLength(1);
  restore();
});

// A graph with neither end — every kind in the middle — gets no layer at all,
// rather than an empty <svg> sitting in the export's way.
it('draws no layer for a graph with no ends', () => {
  const { container } = render(<EndpointMarks boxes={[box({ kind: 'process' })]} />);
  expect(container).toBeEmptyDOMElement();
});

// ---------------------------------------------------------------------------
// On the canvas
// ---------------------------------------------------------------------------

/**
 * Inside React Flow's transformed layer, which is BOTH the coordinate space the
 * cards are drawn in and the element an export captures. Outside it the marks
 * would drift away from their cards at any pan or zoom, and arrive missing from
 * every shared picture — the same lesson the arrowhead definition taught.
 */
it('draws the marks inside the layer the export captures', async () => {
  const { container } = render(<GraphCanvas workflow={wf} />);
  await cardsOf(wf);

  await waitFor(() => {
    expect(container.querySelector('.react-flow__viewport > .sg-endpoint-marks')).not.toBeNull();
  }, LAYOUT_WAIT);

  const inputs = wf.nodes.filter((n) => n.kind === 'input');
  const outputs = wf.nodes.filter((n) => n.kind === 'output');
  expect(inputs.length).toBeGreaterThan(0);
  expect(outputs.length).toBeGreaterThan(0);
  expect(screen.getAllByTestId('sg-mark-entry')).toHaveLength(inputs.length);
  expect(screen.getAllByTestId('sg-mark-exit')).toHaveLength(outputs.length);
  // named for the card each one hangs off, so a drag can be read against it
  expect(screen.getByTestId('sg-mark-entry')).toHaveAttribute('data-id', inputs[0].id);
});

// Decoration, never a target: the marks sit right beside the ports, and a layer
// that took the pointer would swallow drags aimed at the cards they belong to.
it('never takes the pointer', async () => {
  const { container } = render(<GraphCanvas workflow={wf} />);
  await cardsOf(wf);

  const layer = await waitFor(
    () => container.querySelector<SVGElement>('.sg-endpoint-marks')!,
    LAYOUT_WAIT,
  );
  expect(layer.style.pointerEvents).toBe('none');
});
