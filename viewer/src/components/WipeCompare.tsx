import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { getBezierPath, Position } from '@xyflow/react';
import { backEdgePath, planBackEdges } from '../graph/backEdge';
import type { LaidOutGraph } from '../graph/layout';
import { impactLabel, impactParts, painLabel, type ImpactSummary } from '../graph/metrics';
import { wrapLabel } from '../graph/path';
import type { Suggestion, Workflow } from '../graph/types';
import { prefersReducedMotion } from './motion';
import { SignalNodeBody } from './SignalNode';
import { edgeInk, EdgeTag } from './SignalEdge';
import './wipe.css';

/** How far one arrow press moves the divider. */
const STEP_PX = 32;

/** Where the divider starts: the middle, half of each world showing. */
const OPENING_FRACTION = 0.5;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A place and a size in flow coordinates — what every route below is drawn against. */
interface WorldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * VS ORIGINAL as a wipe: the graph as it arrived on one side of a draggable
 * divider, the graph it became on the other, in ONE world.
 *
 * Two full-fidelity layers share the viewport. The UNDER layer is this
 * component's picture of V0 — real card bodies, real edge ink, full opacity —
 * and the OVER layer is the live canvas itself, clip-pathed from the left by
 * however far the handle stands (the canvas applies the clip; this component
 * only states it, through `onClip`). Everything left of the handle is the
 * original; everything right of it is now.
 *
 * WHERE the original's cards stand is the correction this component exists for:
 * positions come from the snapshot taken at the session's first apply — the
 * user's own arrangement, drags included — and only fall back to ELK's layout
 * when no snapshot exists. The whole picture is then shifted so the original's
 * first input stands exactly on the live one (`shift`, worked out by the
 * canvas), which is what makes the two halves read as one continuous workflow
 * rather than two unrelated photographs.
 *
 * The under layer takes no pointer and reaches no reader: the live graph is the
 * one you interact with, and the impact panel's live region is what a screen
 * reader is told. The handle is the mode's one control — draggable, and a
 * slider to the keyboard.
 */
export function WipeCompare({
  original,
  laidOut,
  snapshot,
  shift,
  transform,
  summary,
  onClip,
  onExit,
}: {
  /** V0 — the workflow as it arrived, suggestions and all. */
  original: Workflow;
  /** V0's layout: the position fallback, and the edge list with its minted ids. */
  laidOut: LaidOutGraph;
  /** Where React Flow had V0's cards at the first apply, or null before any drag mattered. */
  snapshot: Map<string, { x: number; y: number }> | null;
  /** How far the original must travel so its input stands on the live input. */
  shift: { dx: number; dy: number };
  /** The live pane's transform, mirrored so both layers pan and zoom as one. */
  transform: string;
  /** The session's own figures — the strip states these, it computes nothing. */
  summary: ImpactSummary;
  /** The clip the live canvas should wear, restated whenever the handle moves. */
  onClip: (clipPath: string) => void;
  /** ESC — the way out, from anywhere. */
  onExit: () => void;
}) {
  const underRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  /** 0..1 of the pane's width, so a window resize keeps the split, not the pixel. */
  const [fraction, setFraction] = useState(OPENING_FRACTION);
  /** The pane's box in screen pixels — what the fraction is a fraction OF. */
  const [frame, setFrame] = useState({ width: 0, left: 0 });
  /**
   * Read once at mount: the OS setting is not going to change mid-wipe, and the
   * class it gates is the entrance only — the handle tracks the pointer
   * directly at every setting, because a divider that eased after the hand
   * would be answering behind the question.
   */
  const [animate] = useState(() => !prefersReducedMotion());

  // The pane is this component's parent — WipeCompare always renders inside
  // `.sg-viewport` — and its width is what the divider divides. Re-measured on
  // resize so the fraction keeps meaning the same split of the visible pane.
  useLayoutEffect(() => {
    const measure = () => {
      const pane = underRef.current?.parentElement;
      if (!pane) return;
      const at = pane.getBoundingClientRect();
      setFrame({ width: at.width, left: at.left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const x = Math.round(fraction * frame.width);

  // The OVER layer's clip, stated to the canvas that owns the live graph. In
  // screen pixels off the pane's left edge, which is why the clip lives on the
  // untransformed React Flow root and not anywhere the zoom could scale it.
  useEffect(() => {
    onClip(`inset(0 0 0 ${x}px)`);
  }, [onClip, x]);

  // ESC exits the mode from anywhere — the handle need not be focused.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  // The handle is the mode's one control, so it is where the keyboard starts:
  // arrows move the divider the moment the mode opens, the same way the drawer
  // hands focus to its panel on open.
  useEffect(() => {
    handleRef.current?.focus();
  }, []);

  const moveTo = useCallback(
    (clientX: number) => {
      if (frame.width <= 0) return;
      setFraction(clamp01((clientX - frame.left) / frame.width));
    },
    [frame],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      draggingRef.current = true;
      // jsdom has no active pointers to capture; a browser keeps the drag even
      // when the pointer outruns the handle's 12px hit area.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no capture available — the drag still tracks while over the handle */
      }
      moveTo(e.clientX);
    },
    [moveTo],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) moveTo(e.clientX);
    },
    [moveTo],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const step = frame.width > 0 ? STEP_PX / frame.width : 0;
      let to: number;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          to = fraction - step;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          to = fraction + step;
          break;
        case 'Home':
          to = 0;
          break;
        case 'End':
          to = 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      setFraction(clamp01(to));
    },
    [fraction, frame],
  );

  // The KB's answer on the ORIGINAL, so its cards carry the pips they carried:
  // the original is a picture of where the opportunities stood, and the badges
  // are part of what it looked like.
  const matched = useMemo(() => {
    const byNode = new Map<string, Suggestion[]>();
    for (const s of original.suggestions) {
      const list = byNode.get(s.nodeId);
      if (list) list.push(s);
      else byNode.set(s.nodeId, [s]);
    }
    return byNode;
  }, [original]);

  /**
   * Where each original card stands: the snapshot's answer first — the user's
   * own arrangement at the moment the first patch landed — ELK's only for a
   * card the snapshot never saw, and the whole set carried by `shift` so the
   * original's input coincides with the live one.
   */
  const boxes = useMemo(() => {
    const at = new Map<string, WorldBox>();
    for (const n of laidOut.nodes) {
      const pos = snapshot?.get(n.id) ?? { x: n.x, y: n.y };
      at.set(n.id, {
        x: pos.x + shift.dx,
        y: pos.y + shift.dy,
        width: n.width,
        height: n.height,
      });
    }
    return at;
  }, [laidOut, snapshot, shift]);

  // The original's own lane plan, against the positions it is actually drawn
  // at: a back-edge that planned around ELK's rows while the cards stand where
  // the user dragged them would cut through the very picture it belongs to.
  const backPlan = useMemo(
    () =>
      planBackEdges(
        [...boxes.entries()].map(([id, b]) => ({ id, ...b })),
        laidOut.edges,
      ),
    [boxes, laidOut],
  );

  /**
   * The same two routes SignalEdge draws, chosen by the same geometric test:
   * a bezier port-to-port, or the planned run around the cards for an edge
   * whose target sits behind its source. Full-strength ink from the same
   * `edgeInk` vocabulary, so an unchanged edge is drawn identically on both
   * sides of the divider.
   */
  const routes = useMemo(
    () =>
      laidOut.edges.flatMap((e) => {
        const from = boxes.get(e.from);
        const to = boxes.get(e.to);
        if (!from || !to) return [];
        const sx = from.x + from.width;
        const sy = from.y + from.height / 2;
        const tx = to.x;
        const ty = to.y + to.height / 2;
        const geo =
          tx < sx
            ? backEdgePath({ sx, sy, tx, ty, ...backPlan.get(e.id) })
            : (() => {
                const [d, labelX, labelY] = getBezierPath({
                  sourceX: sx,
                  sourceY: sy,
                  sourcePosition: Position.Right,
                  targetX: tx,
                  targetY: ty,
                  targetPosition: Position.Left,
                  curvature: e.kind === 'retry' ? 0.5 : 0.25,
                });
                return { d, labelX, labelY };
              })();
        return [{ id: e.id, kind: e.kind, label: e.label, ...geo }];
      }),
    [backPlan, boxes, laidOut],
  );

  // The satisfaction line: what the session saved, stated in the same
  // vocabulary every other surface states it in. Steps and minutes are the
  // headline and appear only when they moved — impactParts' own honesty rule —
  // while the pain figure is the comparison's whole point and always speaks.
  const { totals, painPct } = summary;
  const headline = impactParts(totals).filter(
    (p) => p.key === 'stepsSaved' || p.key === 'estTimeSavedMin',
  );

  const animateClass = animate ? ' sg-wipe--animate' : '';
  const pct = Math.round(fraction * 100);

  return (
    <>
      {/* The original. Clipped on the untransformed wrapper — a clip inside the
          world div would be dragged around by the very pan it must not follow —
          while the world inside carries the live pane's own transform. */}
      <div
        ref={underRef}
        className={`sg-wipe-under${animateClass}`}
        data-testid="wipe-under"
        aria-hidden="true"
        style={{
          pointerEvents: 'none',
          clipPath: `inset(0 ${Math.max(0, frame.width - x)}px 0 0)`,
        }}
      >
        <div className="sg-wipe-world" style={{ transform }}>
          <svg className="sg-wipe-edges">
            {routes.map((r) => (
              <path
                key={r.id}
                className={`sg-edge sg-edge--${r.kind}`}
                d={r.d}
                fill="none"
                markerEnd="url(#fp-arrow)"
                pathLength={1}
                {...edgeInk(r.kind, false, false)}
              />
            ))}
          </svg>
          {original.nodes.map((n) => {
            const box = boxes.get(n.id);
            if (!box) return null;
            return (
              <div
                key={n.id}
                className="sg-wipe-card"
                data-testid="wipe-card"
                data-id={n.id}
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              >
                <span className="sg-wipe-port sg-wipe-port--in" />
                <SignalNodeBody node={n} suggestions={matched.get(n.id)} />
                <span className="sg-wipe-port sg-wipe-port--out" />
              </div>
            );
          })}
          {routes.map((r) =>
            r.label ? (
              <EdgeTag
                key={r.id}
                id={r.id}
                lines={wrapLabel(r.label)}
                kind={r.kind}
                x={r.labelX}
                y={r.labelY}
              />
            ) : null,
          )}
        </div>
      </div>

      {/* The divider: an accent seam with a grip, ORIGINAL on its past side and
          NOW on its live side. A slider to the keyboard — arrows walk it,
          Home/End snap it to either edge. */}
      <div
        ref={handleRef}
        className={`sg-wipe-handle${animateClass}`}
        data-testid="wipe-handle"
        role="slider"
        tabIndex={0}
        aria-label="comparison divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{ left: x }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="sg-wipe-chip sg-wipe-chip--original">ORIGINAL</span>
        <span className="sg-wipe-chip sg-wipe-chip--now">NOW</span>
        <span className="sg-wipe-grip" aria-hidden="true">
          ◂▸
        </span>
      </div>

      {/* What the divide is worth, floating at the seam. */}
      <div
        className={`sg-wipe-deltas${animateClass}`}
        data-testid="wipe-deltas"
        style={{ left: x }}
      >
        {headline.map((p) => (
          <span key={p.key} className="sg-wipe-delta">
            {impactLabel(totals[p.key], p.unit)}
          </span>
        ))}
        <span className="sg-wipe-delta sg-wipe-delta--pain">pain {painLabel(painPct)}</span>
      </div>
    </>
  );
}
