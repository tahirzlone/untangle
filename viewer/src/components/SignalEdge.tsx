import { EdgeLabelRenderer, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import { backEdgePath, type BackEdgePlan } from '../graph/backEdge';
import type { LabelOffset } from '../graph/labels';
import { wrapLabel } from '../graph/path';
import { branchInk, tokenReader } from '../graph/tokens';
import type { EdgeKind } from '../graph/types';
import './edge.css';

/**
 * The ink edge.css gives this edge, resolved from the tokens they both read.
 *
 * Written onto the path as PRESENTATION ATTRIBUTES, which sit below author CSS in
 * the cascade — so on screen every rule in edge.css still wins, the draw-in still
 * owns the dash, and nothing here is visible at all. They exist for the export: an
 * exported PNG is a clone of the DOM with no stylesheet behind it, and CSS-derived
 * presentation does not survive that trip. Without them a shared graph arrives
 * with every edge missing; with them the clone has the finished state to draw.
 *
 * Resolved rather than written out here, so the palette stays the one source: an
 * unresolvable token states nothing rather than inventing a colour.
 */
function edgeInk(kind: EdgeKind, critical: boolean) {
  const token = tokenReader();
  return {
    stroke: critical
      ? token('--accent')
      : kind === 'retry'
        ? token('--ember')
        : // Derived from --accent and --line at the moment it is asked for, so the
          // branch edge follows the palette instead of carrying a mix worked out
          // against an older one — see `branchInk` in graph/tokens.ts.
          kind === 'branch'
          ? branchInk(token)
          : token('--accent'),
    // The route the CRITICAL PATH toggle is pointing at draws heavier and at full
    // strength — the same values `.sg-edge--critical` states in edge.css, so the
    // screen and the exported PNG agree about which run is the expensive one.
    strokeWidth: token(critical ? '--edge-stroke-critical' : '--edge-stroke'),
    strokeLinecap: token('--edge-cap') as 'round' | undefined,
    opacity: critical ? '1' : token(kind === 'retry' ? '--edge-opacity-retry' : '--edge-opacity'),
    // The state the draw-in ENDS on — a retry stays dashed, everything else
    // resolves to one dash over a curve normalized to a single unit. The
    // animation is a CSS keyframe, so it outranks this while it plays and the
    // export, which has no keyframes, gets the arrival.
    strokeDasharray: token(kind === 'retry' ? '--edge-dash-retry' : '--edge-dash'),
  };
}

/**
 * The condition on a branch, rendered as HTML through EdgeLabelRenderer so it
 * layers ABOVE the node layer — no in-SVG placement can win, because React Flow
 * paints nodes above the edge SVG.
 *
 * `x`/`y` are where the CURVE puts the tag; `offset` is the canvas's answer to
 * what else is standing there — see `planLabels` in graph/labels.ts. The two are
 * added for the transform and stated separately in the data attributes, so the
 * collision pass always re-measures the natural point rather than the one it moved
 * the chip to last time and drifting a little further on every pass.
 */
export function EdgeTag({
  id,
  lines,
  kind,
  x,
  y,
  offset,
}: {
  /** The edge this tag belongs to — how the collision pass names it. */
  id: string;
  lines: string[];
  kind: EdgeKind;
  x: number;
  y: number;
  offset?: LabelOffset;
}) {
  const dx = offset?.dx ?? 0;
  const dy = offset?.dy ?? 0;
  return (
    <div
      className={`sg-edge-tag${kind === 'retry' ? ' sg-edge-tag--retry' : ''}`}
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${x + dx}px, ${y + dy}px)`,
      }}
      data-testid="edge-tag"
      data-tag-id={id}
      data-tag-x={x}
      data-tag-y={y}
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
    | {
        kind: EdgeKind;
        label?: string;
        index: number;
        back?: BackEdgePlan;
        critical?: boolean;
        /** Where the collision pass wants this edge's tag, if not where the curve put it. */
        tagOffset?: LabelOffset;
      }
    | undefined;
  const kind = data?.kind ?? 'sequence';
  const critical = data?.critical ?? false;
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
  const ink = edgeInk(kind, critical);
  return (
    <g className="sg-edge-group" style={{ ['--i' as string]: data?.index ?? 0 }}>
      <path
        className={`sg-edge sg-edge--${kind}${critical ? ' sg-edge--critical' : ''}`}
        d={d}
        fill="none"
        markerEnd="url(#fp-arrow)"
        pathLength={1}
        {...ink}
      />
      {kind === 'sequence' && !isBack && !reduced ? (
        // the dot's fill is CSS too, and an SVG circle with no fill of its own
        // exports BLACK — a bead of ink on the graph nobody drew
        <circle className="sg-flow-dot" r="3" fill={ink.stroke}>
          <animateMotion dur="3.2s" repeatCount="indefinite" path={d} />
        </circle>
      ) : null}
      {lines.length > 0 ? (
        <EdgeLabelRenderer>
          <EdgeTag
            id={props.id}
            lines={lines}
            kind={kind}
            x={labelX}
            y={labelY}
            offset={data?.tagOffset}
          />
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}
