import type { Rect } from '@xyflow/react';

/**
 * Where the edge tags actually go, once everything else is already drawn.
 *
 * An edge label is placed by the curve it belongs to — the midpoint of a bezier,
 * the top run of a return lane — and the curve knows nothing about the cards it
 * passes or the other labels beside it. Most of the time that is fine. When it is
 * not, a condition ends up written across a step's title, or two conditions end up
 * written across each other, and neither is readable.
 *
 * This is the pass that fixes it: given where every tag WOULD go and what is
 * already standing there, it answers with the small offsets that get them out of
 * the way. Pure — rectangles in, offsets out — so the whole of the placement rule
 * can be read and tested without a layout engine or a browser behind it.
 *
 * A tag with nothing on it gets no entry at all: the map holds the moves, not the
 * tags, so the common case costs the caller nothing to apply.
 */

/**
 * How far a tag may be moved from where its edge put it, in flow pixels.
 *
 * A budget, not a target. Past this a label is no longer beside the edge it names
 * — it is beside a different one — and an unreadable label in the right place is
 * better than a legible one making a false claim about which edge it describes.
 */
export const LABEL_NUDGE_CAP = 24;

/** The grain of the search: the smallest move worth making, and its increment. */
export const LABEL_NUDGE_STEP = 6;

/** One tag, as the canvas measured it: an edge id and the box the chip occupies. */
export interface LabelTag {
  /** The edge this tag belongs to — the key the plan answers in. */
  id: string;
  /** Where the chip sits with no offset applied, in flow coordinates. */
  rect: Rect;
}

/** How far a tag moves off the point its edge chose. */
export interface LabelOffset {
  dx: number;
  dy: number;
}

/** Do these two boxes share any area? Touching edges do not count as sharing. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function shift(rect: Rect, { dx, dy }: LabelOffset): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

/**
 * Every move the search will consider, in the order it considers them.
 *
 * Vertical first, and nearest first. The graph runs left to right, so the empty
 * space is in the GUTTERS between the rows — a tag lifted into one clears the card
 * it was on and stays over its own edge. A tag pushed sideways instead travels
 * ALONG its corridor, which is where the rest of that edge is and where the next
 * tag along is too, so the horizontal moves are only reached once no gutter inside
 * the cap will take it.
 *
 * Worked out once: the list is the same for every tag and every graph.
 */
const CANDIDATES: LabelOffset[] = (() => {
  const vertical: LabelOffset[] = [];
  const horizontal: LabelOffset[] = [];
  for (let d = LABEL_NUDGE_STEP; d <= LABEL_NUDGE_CAP; d += LABEL_NUDGE_STEP) {
    // up before down: a condition reads more naturally above its line than below
    vertical.push({ dx: 0, dy: -d }, { dx: 0, dy: d });
    horizontal.push({ dx: -d, dy: 0 }, { dx: d, dy: 0 });
  }
  return [...vertical, ...horizontal];
})();

/**
 * Where each tag should go, as an offset from where its edge put it.
 *
 * Greedy and in one pass: the obstacles are placed first, then each tag in turn
 * takes the first clear position in the candidate list — and, once placed, becomes
 * an obstacle itself, so the tag after it cannot land on it. A tag whose natural
 * position is already clear is never moved and never appears in the answer.
 *
 * The order tags are considered in is worked out HERE rather than taken from the
 * caller: `nodes` and `edges` are rebuilt on every layout, and a plan that changed
 * with the order they happened to arrive in would make labels twitch on nothing
 * but a re-render. Top-down, then left-to-right, then by id — a total order over
 * boxes, so the same set of tags always answers the same way.
 *
 * A tag the search cannot clear inside the cap keeps its own place and states
 * nothing. Moving it to the edge of its budget and still overlapping would cost
 * the label its association with its edge and buy no legibility back.
 *
 * Zero-sized boxes — jsdom, and the frame before a real chip is measured — overlap
 * nothing by construction, so they neither move nor displace anything.
 */
export function planLabels(tags: LabelTag[], obstacles: Rect[]): Map<string, LabelOffset> {
  const plan = new Map<string, LabelOffset>();
  const taken: Rect[] = [...obstacles];
  const order = [...tags].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const tag of order) {
    if (!taken.some((r) => overlaps(tag.rect, r))) {
      taken.push(tag.rect);
      continue;
    }
    const clear = CANDIDATES.find((c) => {
      const at = shift(tag.rect, c);
      return !taken.some((r) => overlaps(at, r));
    });
    if (!clear) {
      taken.push(tag.rect);
      continue;
    }
    plan.set(tag.id, clear);
    taken.push(shift(tag.rect, clear));
  }

  return plan;
}
