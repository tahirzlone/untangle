import { tokenReader } from '../graph/tokens';
import type { NodeKind } from '../graph/types';

/**
 * Where the work comes in and where it goes out, drawn on the canvas itself.
 *
 * The cards say which end they are (see `.sg-node--start` / `--end` in node.css);
 * these are the strokes that make it legible from across the graph, at a zoom
 * where no chip is readable: a short accent run with a chevron INTO the first
 * card's left port, and a run OUT of the last card's right port ending in a
 * terminal dot. One per `input` and one per `output`, because a graph may have
 * several of each.
 *
 * Every value that has to survive the trip is a presentation ATTRIBUTE, not a
 * class: an exported PNG is a clone of the DOM with no stylesheet behind it, and
 * CSS-derived presentation on SVG does not survive that. The same lesson the
 * edges learned — see `edgeInk` in SignalEdge.tsx — so the ink is resolved from
 * the palette here rather than repeated as a literal.
 */

/** How far a mark stands off the card, clear of the 10px port ring on its edge. */
const MARK_GAP = 8;

/** How long the run itself is, from that gap outward. */
const MARK_RUN = 26;

/**
 * How far past the card the outermost ink lands: the entry stroke's tail on one
 * side, the terminal dot's far EDGE on the other.
 *
 * Exported because it is a claim the export has to keep: `contentBounds` frames a
 * picture on the cards, the edges and the tags, and these marks hang off the two
 * cards at the outside of that frame. They stay inside the picture because
 * `EXPORT_PADDING` is wider than this reach — a relationship asserted in the
 * suite rather than left as a hope.
 */
export const MARK_REACH = MARK_GAP + MARK_RUN;

/** The chevron's arms, back from the point at the port. */
const CHEVRON = 5;

/** The dot the exit stroke ends on: 6px across, as the review asked. */
export const DOT_R = 3;

/** Drawn at the weight of an ordinary edge, so the marks read as part of the run. */
const MARK_STROKE = 2;

/** A card the marks hang off, in flow coordinates — the space the cards are laid out in. */
export interface EndpointBox {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The vertical middle of a card, which is where both ports sit. */
const portY = (box: EndpointBox) => box.y + box.height / 2;

/**
 * The run into the left port, with the chevron that gives it a direction.
 *
 * One path rather than three: a single `d` is one thing to ink, one thing to
 * clone into an export, and one thing to move when a card is dragged.
 */
export function entryPath(box: EndpointBox): string {
  const y = portY(box);
  const head = box.x - MARK_GAP;
  const tail = box.x - MARK_REACH;
  return `M ${tail} ${y} L ${head} ${y} M ${head - CHEVRON} ${y - CHEVRON} L ${head} ${y} L ${head - CHEVRON} ${y + CHEVRON}`;
}

/** Where the exit's terminal dot sits — its far edge is the mark's full reach. */
export function dotCentre(box: EndpointBox): { cx: number; cy: number } {
  return { cx: box.x + box.width + MARK_REACH - DOT_R, cy: portY(box) };
}

/** The run out of the right port, meeting the near edge of that dot. */
export function exitPath(box: EndpointBox): string {
  const y = portY(box);
  const from = box.x + box.width + MARK_GAP;
  return `M ${from} ${y} L ${dotCentre(box).cx - DOT_R} ${y}`;
}

export function EndpointMarks({ boxes }: { boxes: EndpointBox[] }) {
  const starts = boxes.filter((b) => b.kind === 'input');
  const ends = boxes.filter((b) => b.kind === 'output');
  if (starts.length === 0 && ends.length === 0) return null;
  // Resolved once for the whole layer, not per mark — `getComputedStyle` is a
  // live object and one lookup answers every question asked of it.
  const ink = tokenReader()('--accent');
  return (
    <svg
      className="sg-endpoint-marks"
      data-testid="endpoint-marks"
      aria-hidden="true"
      // Inline rather than in a stylesheet for the same reason the ink is an
      // attribute: this layer is inside the element an export captures, and where
      // it sits has to survive being cloned away from its CSS. Zero-origin and
      // overflow-visible, so the coordinates below ARE flow coordinates.
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        // decoration, never a target: a mark must not swallow a drag aimed at the
        // card it hangs off
        pointerEvents: 'none',
      }}
    >
      {starts.map((b) => (
        <path
          key={b.id}
          className="sg-mark sg-mark--entry"
          data-testid="sg-mark-entry"
          data-id={b.id}
          d={entryPath(b)}
          fill="none"
          stroke={ink}
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {ends.map((b) => (
        <g key={b.id} data-id={b.id}>
          <path
            className="sg-mark sg-mark--exit"
            data-testid="sg-mark-exit"
            data-id={b.id}
            d={exitPath(b)}
            fill="none"
            stroke={ink}
            strokeWidth={MARK_STROKE}
            strokeLinecap="round"
          />
          {/* The full stop. Filled, not stroked — an SVG shape with no fill of its
              own exports BLACK, which is a bead of ink nobody drew. */}
          <circle
            className="sg-mark-dot"
            data-testid="sg-mark-dot"
            data-id={b.id}
            {...dotCentre(b)}
            r={DOT_R}
            fill={ink}
          />
        </g>
      ))}
    </svg>
  );
}
