import type { EdgeProps } from '@xyflow/react';
import { labelAnchor, pointsToPath, wrapLabel } from '../graph/path';
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
  const anchor = labelAnchor(points);
  const lines = label ? wrapLabel(label) : [];
  return (
    <g className="bp-edge-group" style={{ ['--i' as string]: index }}>
      <path
        className={`bp-edge bp-edge--${kind}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
      />
      {lines.length > 0 ? (
        <text
          className="bp-edge-label"
          textAnchor={anchor.vertical ? 'start' : 'middle'}
          y={anchor.vertical ? anchor.y + 3 - (lines.length - 1) * 5 : anchor.y - 7 - (lines.length - 1) * 10}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={anchor.vertical ? anchor.x + 8 : anchor.x} dy={i === 0 ? 0 : 10}>
              {line}
            </tspan>
          ))}
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
