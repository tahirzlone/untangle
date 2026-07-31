import { getBezierPath, Position } from '@xyflow/react';
import { backEdgePath } from '../graph/backEdge';
import type { LaidOutGraph } from '../graph/layout';

/**
 * The original graph, held under the live one.
 *
 * A silhouette, not a second canvas: card-sized boxes carrying the step's label
 * and nothing else. The label is what makes the comparison legible — "that is
 * where the two hand-run steps used to be" — while the description, the pain
 * meter and the suggestion pip would be three more things to read behind the
 * graph you are actually looking at. Card DIMENSIONS come from the same layout
 * the real cards use, so the two pictures line up exactly.
 *
 * Nothing here takes a pointer or reaches a screen reader: the live graph is the
 * one you interact with, and this is a picture of what it used to be.
 */
export function XrayLayer({ laidOut, transform }: { laidOut: LaidOutGraph; transform: string }) {
  const at = new Map(laidOut.nodes.map((n) => [n.id, n]));

  const routes = laidOut.edges.flatMap((e) => {
    const from = at.get(e.from);
    const to = at.get(e.to);
    if (!from || !to) return [];
    // The ports the real cards carry: out of the right edge, into the left one.
    const sx = from.x + from.width;
    const sy = from.y + from.height / 2;
    const tx = to.x;
    const ty = to.y + to.height / 2;
    // The same two routes SignalEdge picks between, chosen by the same geometric
    // test — a run that goes backwards takes a lane under the cards rather than a
    // bezier straight through them.
    const d =
      tx < sx
        ? backEdgePath({ sx, sy, tx, ty }).d
        : getBezierPath({
            sourceX: sx,
            sourceY: sy,
            sourcePosition: Position.Right,
            targetX: tx,
            targetY: ty,
            targetPosition: Position.Left,
            curvature: e.kind === 'retry' ? 0.5 : 0.25,
          })[0];
    return [{ id: e.id, d }];
  });

  return (
    <div className="sg-xray" data-testid="xray-layer" aria-hidden="true" style={{ transform }}>
      <svg className="sg-xray-edges">
        {routes.map((r) => (
          <path key={r.id} className="sg-xray-edge" d={r.d} fill="none" />
        ))}
      </svg>
      {laidOut.nodes.map((n) => (
        <div
          key={n.id}
          className="sg-node sg-xray-card"
          data-testid="sg-xray-card"
          style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
        >
          <div className="sg-node-head">
            <span className="sg-label">{n.node.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
