import { EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import { backEdgePath, type BackEdgePlan } from '../graph/backEdge';
import { wrapLabel } from '../graph/path';
import type { EdgeKind } from '../graph/types';
import './edge.css';

/**
 * The condition on a branch, rendered as HTML through EdgeLabelRenderer so it
 * layers ABOVE the node layer — no in-SVG placement can win, because React Flow
 * paints nodes above the edge SVG.
 */
export function EdgeTag({
  lines,
  kind,
  x,
  y,
}: {
  lines: string[];
  kind: EdgeKind;
  x: number;
  y: number;
}) {
  return (
    <div
      className={`sg-edge-tag${kind === 'retry' ? ' sg-edge-tag--retry' : ''}`}
      style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
      data-testid="edge-tag"
    >
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

/**
 * The forward case: a cubic straight from the source port to the target port.
 *
 * Curvature is how far React Flow pushes the control points out HORIZONTALLY
 * from each port. Retries fan out more because they typically span more layers
 * than one hop, and a fuller belly separates them from the sequence edge running
 * the same corridor. It cannot make an edge avoid anything — that is what
 * `backEdgePath` is for.
 */
function bezierGeometry(props: EdgeProps, kind: EdgeKind) {
  const [d, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition ?? Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition ?? Position.Left,
    curvature: kind === 'retry' ? 0.5 : 0.25,
  });
  return { d, labelX, labelY };
}

/**
 * Geometry comes from React Flow, not ELK: the nodes declare real left/right
 * ports, so RF hands us the exact port coordinates. ELK's own edge sections are
 * spline control points for a different routing and are deliberately ignored.
 */
export function SignalEdge(props: EdgeProps) {
  const data = props.data as
    | { kind: EdgeKind; label?: string; index: number; back?: BackEdgePlan }
    | undefined;
  const kind = data?.kind ?? 'sequence';
  // Geometric, never by kind: ELK reverses whichever edges it must to break the
  // retry cycles, so plain `sequence` edges come back right-to-left too. The
  // route plan is optional — without it the path still clears its own two rows.
  const isBack = props.targetX < props.sourceX;
  const geo = isBack
    ? backEdgePath({
        sx: props.sourceX,
        sy: props.sourceY,
        tx: props.targetX,
        ty: props.targetY,
        ...data?.back,
      })
    : bezierGeometry(props, kind);
  const { d, labelX, labelY } = geo;
  const lines = data?.label ? wrapLabel(data.label) : [];
  // the dot is decoration with a pulse; reduced motion drops it entirely rather
  // than freezing it somewhere arbitrary along the curve
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <g className="sg-edge-group" style={{ ['--i' as string]: data?.index ?? 0 }}>
      <path
        className={`sg-edge sg-edge--${kind}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
      />
      {kind === 'sequence' && !isBack && !reduced ? (
        <circle className="sg-flow-dot" r="3">
          <animateMotion dur="3.2s" repeatCount="indefinite" path={d} />
        </circle>
      ) : null}
      {lines.length > 0 ? (
        <EdgeLabelRenderer>
          <EdgeTag lines={lines} kind={kind} x={labelX} y={labelY} />
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}
