import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { labelAnchor, pointsToPath, wrapLabel } from '../graph/path';
import type { EdgeKind } from '../graph/types';
import './edge.css';

export function PlotterEdgePath({
  points,
  kind,
  index,
}: {
  points: { x: number; y: number }[];
  kind: EdgeKind;
  index: number;
}) {
  const d = pointsToPath(points);
  if (!d) return null;
  return (
    <g className="bp-edge-group" style={{ ['--i' as string]: index }}>
      <path
        className={`bp-edge bp-edge--${kind}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
      />
    </g>
  );
}

/**
 * The checker's tag, stapled over the sheet. Rendered as HTML through
 * EdgeLabelRenderer so it layers ABOVE the node layer — no in-SVG placement
 * can win, because React Flow paints nodes above the edge SVG.
 */
export function EdgeTag({
  lines,
  kind,
  anchor,
}: {
  lines: string[];
  kind: EdgeKind;
  anchor: { x: number; y: number; vertical: boolean };
}) {
  const transform = anchor.vertical
    ? `translate(0, -50%) translate(${anchor.x + 8}px, ${anchor.y}px)`
    : `translate(-50%, -100%) translate(${anchor.x}px, ${anchor.y - 6}px)`;
  return (
    <div
      className={`bp-edge-tag${kind === 'retry' ? ' bp-edge-tag--retry' : ''}`}
      style={{ transform }}
      data-testid="edge-tag"
    >
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  );
}

export function PlotterEdge(props: EdgeProps) {
  const data = props.data as
    | { points: { x: number; y: number }[]; kind: EdgeKind; label?: string; index: number }
    | undefined;
  if (!data) return null;
  const lines = data.label ? wrapLabel(data.label) : [];
  return (
    <>
      <PlotterEdgePath points={data.points} kind={data.kind} index={data.index} />
      {lines.length > 0 ? (
        <EdgeLabelRenderer>
          <EdgeTag lines={lines} kind={data.kind} anchor={labelAnchor(data.points)} />
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
