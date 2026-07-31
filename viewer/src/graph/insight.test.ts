import { compareInOrder, criticalPath, edgeKey, NO_PATH } from './insight';
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

// ---------------------------------------------------------------------------
// The arithmetic, pinned where it can actually be got wrong
// ---------------------------------------------------------------------------
//
// Every test above compares two routes that SHARE their first step, which is
// exactly where the two easiest mistakes in a longest-path sweep hide: a route
// that forgets to count where it started, and a route that counts the step it is
// leaving instead of the one it is arriving at. Both cancel out on a shared
// prefix and both answer these graphs correctly. These four do not let them.

// A route costs its FIRST step too. Two runs with nothing in common, where the
// pain is at opposite ends: counting from zero picks the wrong one outright.
it('counts the step a route starts on, not just the ones it reaches', () => {
  const wf = graph(
    [node('head', 5), node('tail', 1), node('low', 1), node('high', 3)],
    [edge('head', 'tail'), edge('low', 'high')],
  );

  // 5+1 = 6 beats 1+3 = 4. Drop the starting step and it reads 1 against 3.
  expect(criticalPath(wf)).toEqual({ nodeIds: ['head', 'tail'], edgeKeys: ['e0'] });
});

// Each hop adds the step it ARRIVES at. Two routes of the same length from one
// start, with the pain at different depths along them.
it('adds the step each hop arrives at, not the one it left', () => {
  const wf = graph(
    [node('a', 1), node('near', 1), node('deep', 5), node('other', 3), node('shallow', 1)],
    [edge('a', 'near'), edge('near', 'deep'), edge('a', 'other'), edge('other', 'shallow')],
  );

  // 1+1+5 = 7 beats 1+3+1 = 5. Add the source at each hop and both routes count
  // their start twice and stop at the second step: 3 against 5, the wrong way up.
  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'near', 'deep'], edgeKeys: ['e0', 'e1'] });
});

// Two edges between the same pair of steps: the route is identical either way and
// only the drawing differs, so the glow takes the first one the document declares.
// The whole point of the rule is that it does not flip.
it('takes the earlier edge when two of them join the same pair of steps', () => {
  const wf = graph([node('a', 1), node('b', 3)], [edge('a', 'b'), edge('a', 'b')]);

  expect(criticalPath(wf)).toEqual({ nodeIds: ['a', 'b'], edgeKeys: ['e0'] });
});

// The last arm of the tie-break, tested where it can be reached at all — see the
// note on `compareInOrder`. A graph cannot produce two tying routes where one
// continues the other, because every step costs at least 1; the rule is what keeps
// the ordering total, so the tie-break never falls through to a fact about
// drawing when it is really being asked about routes.
it('orders a run before the run that continues it', () => {
  expect(compareInOrder(['a', 'b'], ['a', 'b', 'c'])).toBeLessThan(0);
  expect(compareInOrder(['a', 'b', 'c'], ['a', 'b'])).toBeGreaterThan(0);
  expect(compareInOrder(['a', 'b'], ['a', 'b'])).toBe(0);
  // and it is still a dictionary order first: a difference outranks a length
  expect(compareInOrder(['a', 'z'], ['a', 'b', 'c'])).toBeGreaterThan(0);
});

// One empty answer, shared: the canvas states the same thing when the toggle is
// up as this module does when there is nothing to point at.
it('offers one empty path rather than a new one per question', () => {
  expect(NO_PATH).toEqual({ nodeIds: [], edgeKeys: [] });
  expect(criticalPath(graph([], []))).toEqual(NO_PATH);
});
