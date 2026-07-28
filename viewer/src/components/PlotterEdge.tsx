import type { EdgeProps } from '@xyflow/react';
import { midpointOf, pointsToPath } from '../graph/path';
import type { EdgeKind } from '../graph/types';
import './edge.css';

export function PlotterEdgePath({
  points,
  kind,
  label,
  index,
}: {
  points: { x: number; y: number }[];
  kind: EdgeKind;
  label?: string;
  index: number;
}) {
  const d = pointsToPath(points);
  if (!d) return null;
  const mid = midpointOf(points);
  return (
    <g className="bp-edge-group" style={{ ['--i' as string]: index }}>
      <path
        className={`bp-edge bp-edge--${kind}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
      />
      {label ? (
        <text className="bp-edge-label" x={mid.x + 6} y={mid.y - 6}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function PlotterEdge(props: EdgeProps) {
  const data = props.data as
    | { points: { x: number; y: number }[]; kind: EdgeKind; label?: string; index: number }
    | undefined;
  if (!data) return null;
  return <PlotterEdgePath points={data.points} kind={data.kind} label={data.label} index={data.index} />;
}
