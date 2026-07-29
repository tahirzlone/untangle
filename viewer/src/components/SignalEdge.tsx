import { EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
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
 * Geometry comes from React Flow, not ELK: the nodes declare real left/right
 * ports, so RF hands us the exact port coordinates and `getBezierPath` draws the
 * curve between them. ELK's own edge sections are spline control points for a
 * different routing and are deliberately ignored.
 */
export function SignalEdge(props: EdgeProps) {
  const data = props.data as { kind: EdgeKind; label?: string; index: number } | undefined;
  const kind = data?.kind ?? 'sequence';
  const [d, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition ?? Position.Right,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition ?? Position.Left,
    // retries double back across the sheet — a fuller belly keeps them clear of
    // the cards they pass under
    curvature: kind === 'retry' ? 0.5 : 0.25,
  });
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
      {kind === 'sequence' && !reduced ? (
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
