import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from './load';
import { layoutWorkflow } from './layout';

async function laidOutGallery() {
  const res = loadWorkflow(gallery);
  if (!res.ok) throw new Error('fixture invalid');
  return layoutWorkflow(res.workflow);
}

it('positions every node with finite coordinates', async () => {
  const g = await laidOutGallery();
  expect(g.nodes).toHaveLength((gallery as any).nodes.length);
  for (const n of g.nodes) {
    expect(Number.isFinite(n.x)).toBe(true);
    expect(Number.isFinite(n.y)).toBe(true);
    expect(n.width).toBeGreaterThan(0);
    expect(n.height).toBeGreaterThan(0);
  }
  expect(g.width).toBeGreaterThan(0);
  expect(g.height).toBeGreaterThan(0);
});

it('routes every edge with at least two points', async () => {
  const g = await laidOutGallery();
  expect(g.edges).toHaveLength((gallery as any).edges.length);
  for (const e of g.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    for (const p of e.points) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  }
});

it('flows left-to-right: the input node sits left of the output node', async () => {
  const g = await laidOutGallery();
  const input = g.nodes.find((n) => n.node.kind === 'input')!;
  const output = g.nodes.find((n) => n.node.kind === 'output')!;
  expect(input.x).toBeLessThan(output.x);
});

it('preserves edge kind and label through layout', async () => {
  const g = await laidOutGallery();
  const retry = g.edges.filter((e) => e.kind === 'retry');
  expect(retry.length).toBeGreaterThan(0);
  expect(retry.every((e) => typeof e.label === 'string' && e.label.length > 0)).toBe(true);
});
