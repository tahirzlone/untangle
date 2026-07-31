import { criticalPath, edgeKey } from './insight';
import type { EdgeKind, Workflow, WorkflowEdge, WorkflowNode } from './types';

/**
 * Graphs written by hand, not loaded: this module reads a `Workflow` and answers
 * about it, so the fixtures state exactly the shape each question is about — a
 * diamond, a tie, a cycle — without a document's worth of prose around it.
 */
const META: Workflow['meta'] = {
  task: 'exercise the longest path',
  title: 'Insight Fixture',
  generatedAt: '2026-07-30T09:00:00Z',
  model: 'claude-fable-5',
  kbSource: 'none',
};

function node(id: string, painLevel: WorkflowNode['painLevel']): WorkflowNode {
  return { id, label: id, kind: 'process', description: `${id} step`, painLevel };
}

function edge(from: string, to: string, kind: EdgeKind = 'sequence'): WorkflowEdge {
  return { from, to, kind };
}

function graph(nodes: WorkflowNode[], edges: WorkflowEdge[]): Workflow {
  return { meta: META, nodes, edges, suggestions: [] };
}

it('keys edges by their position in the workflow, the way the layout mints ids', () => {
  expect(edgeKey(0)).toBe('e0');
  expect(edgeKey(7)).toBe('e7');
});

// The point of the whole module: the hot chain, not the long one. Four cheap
// steps in a row are less of a problem than one step that hurts.
it('takes the chain of most pain, not the chain of most steps', () => {
  const wf = graph(
    [node('a', 1), node('long1', 1), node('long2', 1), node('long3', 1), node('heavy', 5), node('end', 1)],
    [
      edge('a', 'long1'),
      edge('long1', 'long2'),
      edge('long2', 'long3'),
      edge('long3', 'end'),
      edge('a', 'heavy'),
      edge('heavy', 'end'),
    ],
  );

  // 1+5+1 = 7 beats 1+1+1+1+1 = 5, over half the number of hops
  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'heavy', 'end'], edgeKeys: ['e4', 'e5'] });
});

// Two routes that hurt exactly as much are a coin toss the graph must not flip
// differently on every render — the glow would twitch between them on nothing.
it('breaks a tie on id, and answers the same whatever order the graph is written in', () => {
  const nodes = [node('a', 1), node('alpha', 3), node('beta', 3), node('z', 1)];
  const edges = [edge('a', 'alpha'), edge('alpha', 'z'), edge('a', 'beta'), edge('beta', 'z')];

  expect(criticalPath(graph(nodes, edges)).nodeIds).toEqual(['a', 'alpha', 'z']);

  // the same graph, written backwards: same answer, and the keys follow the new
  // positions because a key IS a position
  const flipped = criticalPath(
    graph([...nodes].reverse(), [edge('a', 'beta'), edge('beta', 'z'), edge('a', 'alpha'), edge('alpha', 'z')]),
  );
  expect(flipped.nodeIds).toEqual(['a', 'alpha', 'z']);
  expect(flipped.edgeKeys).toEqual(['e2', 'e3']);
});

// Retries are what make the drawing a loop. The LOGICAL graph — the work as it
// runs when nothing goes wrong — is the acyclic one, and that is what a longest
// path can be asked about at all.
it('ignores retry edges, which are the only thing making the graph a cycle', () => {
  const wf = graph(
    [node('a', 1), node('b', 4), node('c', 2)],
    [edge('a', 'b'), edge('b', 'c'), edge('c', 'b', 'retry')],
  );

  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'b', 'c'], edgeKeys: ['e0', 'e1'] });
});

// A branch is part of the work, not an aside: an approval path that hurts more
// than the happy path is exactly the thing this is meant to find.
it('walks branch edges as readily as sequence edges', () => {
  const wf = graph(
    [node('a', 1), node('cheap', 1), node('costly', 5), node('z', 1)],
    [
      edge('a', 'cheap'),
      edge('cheap', 'z'),
      edge('a', 'costly', 'branch'),
      edge('costly', 'z', 'branch'),
    ],
  );

  expect(criticalPath(wf).nodeIds).toEqual(['a', 'costly', 'z']);
});

it('answers a lone step with itself and no edges', () => {
  const wf = graph([node('only', 3)], []);
  expect(criticalPath(wf)).toEqual({ nodeIds: ['only'], edgeKeys: [] });
});

it('answers an empty graph with nothing', () => {
  expect(criticalPath(graph([], []))).toEqual({ nodeIds: [], edgeKeys: [] });
});

// Two graphs in one document — a stranded step, or a second flow the author drew
// beside the first. The heaviest run wins wherever it lives.
it('picks the heaviest run when the graph is in pieces', () => {
  const wf = graph(
    [node('a', 1), node('b', 1), node('lone1', 5), node('lone2', 5)],
    [edge('a', 'b'), edge('lone1', 'lone2')],
  );

  expect(criticalPath(wf)).toEqual({ nodeIds: ['lone1', 'lone2'], edgeKeys: ['e1'] });
});

// A longest path is undefined on a cycle — walk it again and it is longer. The
// module states nothing rather than picking an arbitrary lap.
it('states no path at all when the logical graph is cyclic', () => {
  const wf = graph(
    [node('a', 1), node('b', 2), node('c', 3)],
    [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
  );

  expect(criticalPath(wf)).toEqual({ nodeIds: [], edgeKeys: [] });
});

// A step wired to itself adds nothing to any route, so it is dropped rather than
// read as the cycle that would blank the whole graph.
it('steps over a self-edge instead of calling the graph cyclic', () => {
  const wf = graph(
    [node('a', 1), node('b', 4), node('c', 1)],
    [edge('a', 'b'), edge('b', 'b'), edge('b', 'c')],
  );

  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'b', 'c'], edgeKeys: ['e0', 'e2'] });
});

// Generation is fallible and the reducer is the only thing that guarantees a
// coherent graph. An edge pointing at nothing is skipped, not thrown on.
it('skips an edge that names a step the graph does not have', () => {
  const wf = graph(
    [node('a', 1), node('b', 2)],
    [edge('a', 'b'), edge('b', 'ghost')],
  );

  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'b'], edgeKeys: ['e0'] });
});

// The whole reason the toggle recomputes per version: consolidating the hot step
// moves the glow onto whatever is now the worst way through.
it('moves the path when the step that made it hot is gone', () => {
  const before = graph(
    [node('a', 1), node('manual', 5), node('auto', 2), node('z', 1)],
    [edge('a', 'manual'), edge('manual', 'z'), edge('a', 'auto'), edge('auto', 'z')],
  );
  expect(criticalPath(before).nodeIds).toEqual(['a', 'manual', 'z']);

  const after = graph(
    [node('a', 1), node('assisted', 1), node('auto', 2), node('z', 1)],
    [edge('a', 'assisted'), edge('assisted', 'z'), edge('a', 'auto'), edge('auto', 'z')],
  );
  expect(criticalPath(after).nodeIds).toEqual(['a', 'auto', 'z']);
});
