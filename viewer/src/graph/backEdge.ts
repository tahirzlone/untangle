import { NODE_HEIGHT } from './layout';

/** How far the route runs straight out of a port before it turns. */
const STUB = 24;
/** Clearance between the lowest card the run must clear and the run itself. */
const CLEARANCE = 32;
/** Corner radius of the four turns. */
const CORNER = 16;
/** Gap between two back-edges sharing a floor, on both the run and the stubs. */
export const LANE_STEP = 16;

export interface BackEdgeInput {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /**
   * Bottom of the lowest card the horizontal run has to clear. Defaults to the
   * bottom of the source/target rows, which is all a two-point route can know;
   * GraphCanvas supplies the real figure because it can see every card the run
   * would otherwise pass under.
   */
  floorY?: number;
  /** Nesting depth — see `lane` in GraphCanvas. Wider spans take deeper lanes. */
  lane?: number;
}

export interface BackEdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
}

// SVG paths care about precision far less than diffs do; 2dp keeps the strings
// short and stable without any visible loss.
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Route for an edge whose target sits to the LEFT of its source.
 *
 * ELK reverses edges to break the retry cycles in a workflow, so a handful of
 * perfectly ordinary `sequence` edges come back pointing right-to-left. A bezier
 * cannot rescue those: React Flow's curvature only pushes the control points
 * further out horizontally, so the curve stays a near-straight line that runs
 * for most of its length *underneath* the node cards between the two ports.
 *
 * This routes around the cards instead — out of the source port, down below the
 * floor, back along the whole span, then up into the target's left port. Corners
 * are quadratic so the turns read as bends, not kinks.
 *
 * Detection is purely geometric (`targetX < sourceX`) and belongs to the caller:
 * edge *kind* says nothing about direction — the two worst offenders in the
 * gallery graph are `sequence` edges.
 */
export function backEdgePath({
  sx,
  sy,
  tx,
  ty,
  floorY,
  lane = 0,
}: BackEdgeInput): BackEdgeGeometry {
  const spread = lane * LANE_STEP;
  const outX = sx + STUB + spread;
  const inX = tx - STUB - spread;
  // Fallback floor: the bottom of whichever of the two rows hangs lower. It is
  // right whenever nothing else stands between the ports, and it is the most a
  // four-coordinate route can work out on its own.
  const y = (floorY ?? Math.max(sy, ty) + NODE_HEIGHT / 2) + CLEARANCE + spread;

  // Never let a corner eat more than half of the leg it turns out of. With a
  // genuine back-edge every leg is comfortably longer than 2×CORNER, so this
  // only ever matters for degenerate geometry — but it keeps the path valid
  // instead of self-intersecting.
  const c = Math.max(
    0,
    Math.min(CORNER, Math.abs(outX - inX) / 2, (y - sy) / 2, (y - ty) / 2),
  );

  const d = [
    `M${r2(sx)},${r2(sy)}`,
    `L${r2(outX - c)},${r2(sy)}`,
    `Q${r2(outX)},${r2(sy)} ${r2(outX)},${r2(sy + c)}`,
    `L${r2(outX)},${r2(y - c)}`,
    `Q${r2(outX)},${r2(y)} ${r2(outX - c)},${r2(y)}`,
    `L${r2(inX + c)},${r2(y)}`,
    `Q${r2(inX)},${r2(y)} ${r2(inX)},${r2(y - c)}`,
    `L${r2(inX)},${r2(ty + c)}`,
    `Q${r2(inX)},${r2(ty)} ${r2(inX + c)},${r2(ty)}`,
    `L${r2(tx)},${r2(ty)}`,
  ].join(' ');

  // the long horizontal run is the only stretch of a back-edge with room for a
  // chip, and it is guaranteed clear of the cards
  return { d, labelX: r2((outX + inX) / 2), labelY: r2(y) };
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackEdgePlan {
  floorY: number;
  lane: number;
}

/**
 * Works out, for every reversed edge in a laid-out graph, how deep its return
 * run has to go and which lane it takes.
 *
 * `backEdgePath` alone can only clear the two cards it connects. ELK, though,
 * puts unrelated layers at whatever y suits them, so a run that clears its own
 * two rows can still disappear under a card three layers along. This pass has
 * the whole layout in hand: for each back-edge it takes the lowest bottom among
 * the cards whose columns its run actually crosses, and that becomes the floor.
 * With nothing in between, the answer collapses to the two rows' own bottoms.
 *
 * Lanes are assigned narrowest span first, so a wider run always travels below
 * a run nested inside it — that ordering is what keeps their vertical stubs from
 * cutting across each other's horizontal runs.
 */
export function planBackEdges(
  nodes: Box[],
  edges: { id: string; from: string; to: string }[],
): Map<string, BackEdgePlan> {
  const box = new Map(nodes.map((n) => [n.id, n]));
  const spans = edges
    .map((e) => {
      const a = box.get(e.from);
      const b = box.get(e.to);
      if (!a || !b || b.x >= a.x) return null; // forward edge, or a dangling id
      const left = b.x - STUB;
      const right = a.x + a.width + STUB;
      const floorY = nodes.reduce(
        (low, n) => (n.x + n.width >= left && n.x <= right ? Math.max(low, n.y + n.height) : low),
        Math.max(a.y + a.height, b.y + b.height),
      );
      return { id: e.id, width: right - left, floorY };
    })
    .filter((s): s is { id: string; width: number; floorY: number } => s !== null)
    .sort((p, q) => p.width - q.width);

  return new Map(spans.map((s, lane) => [s.id, { floorY: s.floorY, lane }]));
}
