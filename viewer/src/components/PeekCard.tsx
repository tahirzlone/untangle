import { createPortal } from 'react-dom';
import { impactLabel, impactParts } from '../graph/metrics';
import type { Suggestion } from '../graph/types';
import { CategoryChip } from './DetailDrawer';
import './peek.css';

/**
 * What the KB has on this step, answered before you commit to asking.
 *
 * The pip on a card says only that there is SOMETHING; finding out what it is
 * costs a click and a panel that covers a quarter of the graph. This is the
 * cheaper question: rest the pointer on a matched card and the first row states
 * itself — what it is, what it claims, what it saves — while the graph stays
 * where it is. The drawer is unchanged and still the only way to act on any of
 * it, so nothing here is a control: the peek reads, the panel commits.
 */

/** How long the pointer has to mean it. Intent, not animation — see the note in GraphCanvas. */
export const PEEK_DELAY_MS = 150;

/** How wide the card is drawn. Stated here rather than in the stylesheet because
 * the side-flip below has to know it — two numbers would put the peek off the
 * screen edge it was flipped away from. */
export const PEEK_WIDTH = 260;

/** The gap between the card and the step it is about, and its margin at a window edge. */
export const PEEK_GAP = 14;

/** Where the peek stands, in screen coordinates. */
export interface PeekAnchor {
  x: number;
  y: number;
}

/** As much of a card's box as the placement needs — a DOMRect satisfies it. */
export interface CardRect {
  left: number;
  right: number;
  top: number;
}

/**
 * Which side of the card the peek can stand on.
 *
 * To the right of the step by default, because the graph runs left→right and the
 * space ahead of a card is the space the eye is already travelling into. A card
 * near the right edge of the window would put the peek half off screen, so there
 * it flips to the left instead — and if neither side fits it is held at the
 * window's own margin rather than pushed out of view.
 */
export function peekAnchor(card: CardRect, windowWidth: number): PeekAnchor {
  const right = card.right + PEEK_GAP;
  const fits = right + PEEK_WIDTH <= windowWidth;
  const x = fits ? right : Math.max(PEEK_GAP, card.left - PEEK_GAP - PEEK_WIDTH);
  return { x, y: card.top };
}

export function PeekCard({ suggestions, at }: { suggestions: Suggestion[]; at: PeekAnchor }) {
  const [first, ...rest] = suggestions;
  // A card the KB matched nothing to has nothing to peek at — the canvas never
  // opens one, and this is the same answer stated where it cannot drift.
  if (!first) return null;

  // The first component this row actually moved, in the order the impact meter
  // states them: one line, and the same reading order everywhere in the app, so
  // the peek is never quietly ranking savings by a rule of its own.
  const [top] = impactParts(first.effect.metrics);

  return createPortal(
    // Fixed to the window rather than placed in the flow: the peek is a screen
    // overlay, so it does not zoom with the graph and cannot be clipped by the
    // pane. `aria-hidden`, because it is a pointer-only echo of the drawer — the
    // keyboard route deliberately does not raise it, and the panel is what
    // announces this row to a screen reader.
    <div
      className="sg-peek"
      data-testid="sg-peek"
      aria-hidden="true"
      style={{ left: at.x, top: at.y, width: PEEK_WIDTH }}
    >
      <div className="sg-peek-head">
        <CategoryChip category={first.category} />
        <span className="sg-peek-name" data-testid="sg-peek-name">
          {first.name}
        </span>
      </div>
      <p className="sg-peek-claim" data-testid="sg-peek-claim">
        {first.claim}
      </p>
      <div className="sg-peek-foot">
        {top ? (
          <span className="sg-peek-metric" data-testid="sg-peek-metric">
            {impactLabel(first.effect.metrics[top.key], top.unit)}
          </span>
        ) : null}
        {/* Two rows on one step is two futures for the same moment, and the peek
            has room for one of them. Saying how many are left is what keeps the
            silence from reading as "this is all there is". */}
        {rest.length > 0 ? (
          <span className="sg-peek-more" data-testid="sg-peek-more">
            +{rest.length} more
          </span>
        ) : null}
        <span className="sg-peek-hint">CLICK FOR DETAILS</span>
      </div>
    </div>,
    document.body,
  );
}
