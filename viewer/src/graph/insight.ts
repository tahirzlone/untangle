import type { Workflow, WorkflowEdge } from './types';

/**
 * What the graph is really costing, as a route through it.
 *
 * The critical path is the run of steps that hurts most: the chain whose pain
 * levels add up to more than any other chain's. It is the answer to "where does
 * this workflow actually go wrong" — and, once suggestions start landing, the
 * thing that visibly moves when the worst step is consolidated away.
 *
 * Pure and synchronous: no layout, no DOM, no session. The canvas asks it about
 * whichever version is on screen and gets ids back.
 */

/** The route, as ids the canvas can match its nodes and edges against. */
export interface CriticalPath {
  /** The steps on the route, in the order the work runs them. */
  nodeIds: string[];
  /** The edges between them, keyed the way the layout keys edges. */
  edgeKeys: string[];
}

/** Nothing to state: an empty graph, or one this cannot honestly answer about. */
const NO_PATH: CriticalPath = { nodeIds: [], edgeKeys: [] };

/**
 * How an edge is named once it is on the canvas.
 *
 * A workflow edge has no id of its own — its identity is its POSITION in
 * `workflow.edges` — so the layout mints one from the index, React Flow carries
 * that through as the edge id, and this module hands the same key back. Stated
 * here rather than in the layout because a pure module can be read (and imported)
 * without an engine coming with it; `layout.ts` calls this one so the two can
 * never drift.
 */
export function edgeKey(index: number): string {
  return `e${index}`;
}

/** One route, carried through the sweep with everything a tie-break needs. */
interface Run {
  /** Pain, summed over every step on the route. */
  total: number;
  nodeIds: string[];
  /** Positions in `workflow.edges`, turned into keys only on the way out. */
  edges: number[];
}

/** Element-wise, shorter-first — the ordinary dictionary comparison. */
function compare<T extends string | number>(a: T[], b: T[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * Does `a` describe a worse route than `b` — and so a better answer?
 *
 * Pain first, which is the question being asked. Everything after it exists so
 * that two equally painful routes resolve the SAME way every time: the glow must
 * not flip between two chains that tie, and a graph written in a different order
 * must not answer differently. Lexicographically smallest ids win, then the
 * lower edge positions — reachable only when two edges join the same pair of
 * steps, where the route is identical and only the drawing differs.
 */
function beats(a: Run, b: Run): boolean {
  if (a.total !== b.total) return a.total > b.total;
  const ids = compare(a.nodeIds, b.nodeIds);
  if (ids !== 0) return ids < 0;
  return compare(a.edges, b.edges) < 0;
}

/**
 * The edges the work actually flows along.
 *
 * Retries are excluded, and that is the whole reason this can be asked at all: a
 * retry is the loop back to a step already taken, so a graph carrying one is
 * cyclic and "longest path" stops meaning anything on it. What is left is the
 * LOGICAL graph — the run where nothing goes wrong — over which sequence and
 * branch edges both count: a costly approval branch is part of the work, not an
 * aside. (The layout's geometric back-edges are a separate matter entirely: ELK
 * reverses whichever edges it must to draw the picture, and which way an arrow
 * happens to point on screen has no bearing on what the workflow does.)
 *
 * Edges naming a step the graph does not have are dropped rather than thrown on:
 * the reducer guarantees a coherent graph, generation does not, and a glow is not
 * worth taking the canvas down for. A step wired to itself is dropped too — it
 * adds nothing to any route, and reading it as a cycle would blank the whole
 * answer over one stray edge.
 */
function logicalEdges(
  wf: Workflow,
  /** Anything that can say whether a step exists — the pain table, as it happens. */
  known: { has: (id: string) => boolean },
): (WorkflowEdge & { index: number })[] {
  return wf.edges
    .map((e, index) => ({ ...e, index }))
    .filter((e) => e.kind !== 'retry' && e.from !== e.to && known.has(e.from) && known.has(e.to));
}

/**
 * The most painful route through the workflow.
 *
 * A longest-path sweep in topological order: every step starts as a route of its
 * own, and each edge offers its target the route that reached its source. Because
 * a node is only visited once every route into it has been settled, one pass
 * answers for the whole graph.
 *
 * A graph whose logical edges still form a cycle gets `NO_PATH` rather than an
 * exception: a longest path is genuinely undefined there (walk the loop again and
 * it is longer), and the honest answer to an undefined question is to state
 * nothing. The canvas draws no glow, which reads as "no route to point at" — a
 * throw would take the whole canvas down over an analysis overlay.
 */
export function criticalPath(wf: Workflow): CriticalPath {
  const pain = new Map(wf.nodes.map((n) => [n.id, n.painLevel]));
  const ids = [...pain.keys()];
  if (ids.length === 0) return NO_PATH;

  const out = new Map<string, (WorkflowEdge & { index: number })[]>();
  const waiting = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of logicalEdges(wf, pain)) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
    waiting.set(e.to, (waiting.get(e.to) ?? 0) + 1);
  }

  const best = new Map<string, Run>(
    ids.map((id) => [id, { total: pain.get(id)!, nodeIds: [id], edges: [] }]),
  );

  // The queue IS the topological order — a step joins it once nothing upstream is
  // still owed to it, and the sweep reads it in the order it filled.
  const queue = ids.filter((id) => waiting.get(id) === 0);
  let settled = 0;
  for (let head = 0; head < queue.length; head++) {
    const here = best.get(queue[head])!;
    settled += 1;
    for (const e of out.get(queue[head]) ?? []) {
      const onward: Run = {
        total: here.total + pain.get(e.to)!,
        nodeIds: [...here.nodeIds, e.to],
        edges: [...here.edges, e.index],
      };
      if (beats(onward, best.get(e.to)!)) best.set(e.to, onward);
      const left = waiting.get(e.to)! - 1;
      waiting.set(e.to, left);
      if (left === 0) queue.push(e.to);
    }
  }
  // Steps the sweep never reached are steps waiting on each other: a cycle.
  if (settled !== ids.length) return NO_PATH;

  let top = best.get(ids[0])!;
  for (const id of ids) {
    const run = best.get(id)!;
    if (beats(run, top)) top = run;
  }
  return { nodeIds: top.nodeIds, edgeKeys: top.edges.map(edgeKey) };
}
