import { backEdgePath, LANE_STEP, planBackEdges } from './backEdge';
import { NODE_HEIGHT, NODE_WIDTH } from './layout';

// A real reversed edge out of the gallery graph: run-suite's right port sits far
// to the right of suite-green's left port after ELK breaks the retry cycle.
const BACK = { sx: 2317, sy: 284, tx: 1038, ty: 92.3 };

it('starts at the source port and ends at the target port', () => {
  const { d } = backEdgePath(BACK);
  expect(d.startsWith('M2317,284')).toBe(true);
  expect(d.endsWith('L1038,92.3')).toBe(true);
});

it('runs below the lower of the two rows, clear of both cards', () => {
  const { d, labelY } = backEdgePath(BACK);
  const below = Math.max(BACK.sy, BACK.ty) + NODE_HEIGHT / 2;
  expect(labelY).toBeGreaterThan(below);
  // the horizontal run is the label's row, and it is on the path
  expect(d).toContain(`,${labelY}`);
});

it('anchors the label on the long horizontal run, not on a corner', () => {
  const { labelX, labelY } = backEdgePath(BACK);
  expect(labelX).toBeLessThan(BACK.sx);
  expect(labelX).toBeGreaterThan(BACK.tx);
  expect(labelY).toBe(Math.max(BACK.sy, BACK.ty) + NODE_HEIGHT / 2 + 32);
});

it('turns four rounded corners rather than kinking', () => {
  const { d } = backEdgePath(BACK);
  expect(d.match(/Q/g)).toHaveLength(4);
  expect(d).not.toContain('C');
});

it('emits no NaN, for ordinary and for degenerate geometry', () => {
  for (const g of [
    BACK,
    { sx: 100, sy: 100, tx: 40, ty: 100 }, // same row, barely reversed
    { sx: 0, sy: 0, tx: 0, ty: 0 }, // fully degenerate
    { sx: 10, sy: -50, tx: -400, ty: 900 }, // negative coords, target far below
  ]) {
    expect(backEdgePath(g).d).not.toMatch(/NaN/);
  }
});

it('keeps the run below both ports even when the target is the lower one', () => {
  const { labelY } = backEdgePath({ sx: 500, sy: 100, tx: 100, ty: 640 });
  expect(labelY).toBe(640 + NODE_HEIGHT / 2 + 32);
});

it('drops to the floor it is given instead of guessing from the two ports', () => {
  const { labelY } = backEdgePath({ ...BACK, floorY: 900 });
  expect(labelY).toBe(932);
});

it('separates lanes on both the run and the stubs, so two runs never overlap', () => {
  const a = backEdgePath({ ...BACK, floorY: 900, lane: 0 });
  const b = backEdgePath({ ...BACK, floorY: 900, lane: 1 });
  expect(b.labelY - a.labelY).toBe(LANE_STEP);
  // the deeper lane also swings its vertical stubs wider, or the two would
  // share a vertical line for hundreds of pixels
  expect(b.d).toContain(String(BACK.sx + 24 + LANE_STEP));
  expect(a.d).toContain(String(BACK.sx + 24));
});

// ── planBackEdges ─────────────────────────────────────────────────────────

const node = (id: string, x: number, y: number) => ({ id, x, y, width: NODE_WIDTH, height: NODE_HEIGHT });

it('ignores forward edges entirely', () => {
  const plan = planBackEdges(
    [node('a', 0, 0), node('b', 400, 0)],
    [{ id: 'e0', from: 'a', to: 'b' }],
  );
  expect(plan.size).toBe(0);
});

it('floors a back-edge below every card its run crosses, not just its own two', () => {
  const nodes = [
    node('a', 0, 0), // target column
    node('mid', 400, 600), // an unrelated layer hanging far lower
    node('b', 800, 0), // source column
  ];
  const plan = planBackEdges(nodes, [{ id: 'e0', from: 'b', to: 'a' }])!;
  // 600 + 148, not 0 + 148: the run would otherwise vanish under `mid`
  expect(plan.get('e0')!.floorY).toBe(600 + NODE_HEIGHT);
});

it('leaves the floor at the two rows when nothing stands between them', () => {
  const nodes = [node('a', 0, 0), node('b', 800, 40), node('far', 2000, 900)];
  const plan = planBackEdges(nodes, [{ id: 'e0', from: 'b', to: 'a' }]);
  // `far` is outside the run's columns, so it does not push the floor down
  expect(plan.get('e0')!.floorY).toBe(40 + NODE_HEIGHT);
});

it('gives the wider span the deeper lane, so nested runs do not cross', () => {
  const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 800, 0), node('d', 1200, 0)];
  const plan = planBackEdges(nodes, [
    { id: 'wide', from: 'd', to: 'a' },
    { id: 'narrow', from: 'c', to: 'b' },
  ]);
  expect(plan.get('narrow')!.lane).toBe(0);
  expect(plan.get('wide')!.lane).toBe(1);
});

it('skips edges naming a node that is not in the layout', () => {
  const plan = planBackEdges([node('a', 0, 0)], [{ id: 'e0', from: 'ghost', to: 'a' }]);
  expect(plan.size).toBe(0);
});
