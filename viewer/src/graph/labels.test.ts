import type { Rect } from '@xyflow/react';
import { LABEL_NUDGE_CAP, planLabels, type LabelTag } from './labels';

/**
 * Rectangles written by hand, not measured: this module takes boxes and answers
 * about boxes, so a fixture is four numbers and nothing else. Coordinates are the
 * canvas's own — a tag's rect is where the chip actually sits, top-left first,
 * which is what the reader in GraphCanvas works out from the label point.
 */
function rect(x: number, y: number, width = 60, height = 20): Rect {
  return { x, y, width, height };
}

function tag(id: string, x: number, y: number, width = 60, height = 20): LabelTag {
  return { id, rect: rect(x, y, width, height) };
}

/** Do these two boxes share any area at all? The question the planner answers to. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

function moved(t: LabelTag, plan: Map<string, { dx: number; dy: number }>): Rect {
  const at = plan.get(t.id) ?? { dx: 0, dy: 0 };
  return { ...t.rect, x: t.rect.x + at.dx, y: t.rect.y + at.dy };
}

// A tag the layout dropped onto a card is a condition nobody can read. It moves
// off it — and the move is small enough that it still belongs to its edge.
it('nudges a tag off the card it landed on', () => {
  const card = rect(0, 0, 200, 100);
  // clipping the card's bottom edge by 12px, which one step of the search clears
  const t = tag('e0', 60, 88);

  const plan = planLabels([t], [card]);

  expect(plan.get('e0')).toEqual({ dx: 0, dy: 12 });
  expect(overlaps(moved(t, plan), card)).toBe(false);
});

// The common case by far: most tags sit in clear air, and a planner that touched
// them would be moving labels away from the edges they name for nothing.
it('leaves a tag nobody is standing on exactly where its edge put it', () => {
  const plan = planLabels([tag('e0', 400, 400)], [rect(0, 0, 200, 100)]);

  expect(plan.has('e0')).toBe(false);
  expect(plan.size).toBe(0);
});

// Two conditions written over each other read as one piece of nonsense. The
// second one off the rank moves; the first keeps the place its edge chose.
it('separates two tags that landed on each other', () => {
  const first = tag('e0', 100, 100);
  const second = tag('e1', 110, 104);

  const plan = planLabels([first, second], []);

  expect(plan.has('e0')).toBe(false);
  expect(overlaps(moved(first, plan), moved(second, plan))).toBe(false);
});

// Vertically, because the graph runs left to right: the gutters between the rows
// are the empty space, and a tag pushed sideways travels along its own corridor
// into whatever else is in it.
it('prefers the gutter above or below to a move along the corridor', () => {
  // a card wide enough that a sideways move could clear it too, and short enough
  // that the vertical way out is inside the cap
  const card = rect(0, 0, 300, 30);
  const t = tag('e0', 100, 20);

  const plan = planLabels([t], [card]);

  expect(plan.get('e0')?.dx).toBe(0);
  expect(plan.get('e0')?.dy).not.toBe(0);
});

// The offset is a nudge, not a relocation: a tag that travelled further than this
// would be a label sitting beside an edge it does not belong to.
it('never moves a tag further than the cap', () => {
  const tags = [tag('e0', 100, 100), tag('e1', 104, 102), tag('e2', 108, 104), tag('e3', 112, 106)];

  const plan = planLabels(tags, [rect(60, 60, 120, 40)]);

  for (const at of plan.values()) {
    expect(Math.abs(at.dx)).toBeLessThanOrEqual(LABEL_NUDGE_CAP);
    expect(Math.abs(at.dy)).toBeLessThanOrEqual(LABEL_NUDGE_CAP);
  }
});

// Boxed in on every side within the cap, the honest answer is to state nothing:
// a tag shoved to the edge of its budget and still overlapping has been moved
// away from its edge for no gain at all.
it('states nothing for a tag with nowhere inside the cap to go', () => {
  const wall = rect(-400, -400, 1000, 1000);

  const plan = planLabels([tag('e0', 100, 100)], [wall]);

  expect(plan.has('e0')).toBe(false);
});

// The plan is read every time the graph moves. Two orderings of the same tags
// answering differently would make labels twitch on nothing but a re-render.
it('answers the same whatever order the tags arrive in', () => {
  const cards = [rect(0, 0, 200, 100), rect(220, 0, 200, 100)];
  const tags = [tag('e0', 60, 40), tag('e1', 70, 46), tag('e2', 260, 40), tag('e3', 500, 500)];

  const forward = planLabels(tags, cards);
  const backward = planLabels([...tags].reverse(), cards);

  expect([...backward.entries()].sort()).toEqual([...forward.entries()].sort());
});

// jsdom measures nothing, and a real tag is briefly unmeasured too. A zero-sized
// box overlaps nothing, so it neither moves nor pushes anything else around.
it('ignores a tag that has not been measured yet', () => {
  const plan = planLabels([tag('e0', 60, 40, 0, 0)], [rect(0, 0, 200, 100)]);

  expect(plan.size).toBe(0);
});
