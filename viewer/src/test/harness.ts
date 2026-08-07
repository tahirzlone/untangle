import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import { loadWorkflow } from '../graph/load';
import type { Workflow } from '../graph/types';

/**
 * The moves every canvas test makes, in one place.
 *
 * Shared rather than copied: the canvas suite and the cinematic suite drive the
 * same component through the same async layout, and a helper that drifts between
 * two files is a helper that stops meaning the same thing in both.
 */

/** Loads a fixture document through the real loader, refusing an invalid one loudly. */
export function fixture(raw: unknown, what: string): Workflow {
  const res = loadWorkflow(raw);
  if (!res.ok) throw new Error(`${what} fixture invalid: ${res.errors.join('; ')}`);
  return res.workflow;
}

/**
 * The budget for anything that waits on a layout. Generous for the ELK pass, not
 * for flakiness: a whole layout run sits between a render and the first card, and
 * on a loaded machine that outlasts the 1s default long before anything is wrong.
 */
export const LAYOUT_WAIT = { timeout: 5000 };

/** Waits out the async layout pass and hands back the painted cards. */
export async function cardsOf(graph: Workflow): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(screen.getAllByTestId('sg-node')).toHaveLength(graph.nodes.length);
  }, LAYOUT_WAIT);
  return screen.getAllByTestId('sg-node');
}

export function cardFor(label: string, all: HTMLElement[]): HTMLElement {
  const card = all.find((el) => el.textContent?.includes(label));
  if (!card) throw new Error(`no card for ${label}`);
  return card;
}

/**
 * The labels on real cards. Ghosts wear `.sg-label` too — they are copies of the
 * card that just left — so every "is it still on the canvas" question is asked of
 * the cards themselves, never of the document text.
 */
export const cardLabels = () =>
  screen.getAllByTestId('sg-node').map((el) => el.querySelector('.sg-label')?.textContent ?? '');

/** Opens a step's panel and presses APPLY on the nth row it lists. */
export async function applyOn(label: string, index = 0) {
  fireEvent.click(cardFor(label, screen.getAllByTestId('sg-node')));
  await screen.findByTestId('detail-drawer');
  fireEvent.click(screen.getAllByTestId('sg-sug-apply')[index]);
}

/**
 * One step of a pointer gesture, with `event.view` populated.
 *
 * Real pointers slip, and React Flow hands `nodeClickDistance` to d3-drag, which
 * swallows the trailing click of any gesture that travelled further. d3-drag
 * works in mouse events, so the whole gesture is reachable from jsdom — with one
 * catch: it binds its mousemove/mouseup listeners to `event.view` and hands that
 * same window to `yesdrag`, which is what installs (or doesn't) the click guard.
 * jsdom's MouseEvent constructor refuses a `view` member here, so it is defined
 * on the instance instead. That field is the only thing supplied by hand;
 * everything the assertions depend on is real d3-drag driving real React Flow.
 */
export function mouse(
  type: 'mouseDown' | 'mouseMove' | 'mouseUp' | 'click',
  target: Element | Window,
  x: number,
) {
  const event = createEvent[type](target, { clientX: x, clientY: 100, button: 0 });
  Object.defineProperty(event, 'view', { value: window });
  fireEvent(target, event);
}

/**
 * One end of a pointer gesture, carrying the two fields a real device always
 * sends: which button, and whether this is the primary pointer.
 *
 * jsdom has no PointerEvent, so testing-library builds these on the base Event
 * constructor and both fields are dropped — they are defined on the instance
 * instead, the same move `mouse` makes for d3-drag's `view`. Defaults are a
 * plain left press, so a caller only names a field when that is the point.
 */
export function press(
  type: 'pointerDown' | 'pointerUp',
  target: Element,
  init: { button?: number; isPrimary?: boolean } = {},
) {
  const event = createEvent[type](target);
  Object.defineProperty(event, 'button', { value: init.button ?? 0 });
  Object.defineProperty(event, 'isPrimary', { value: init.isPrimary ?? true });
  fireEvent(target, event);
}

/**
 * Takes the browser's own download route out of play, and keeps what was asked of it.
 *
 * A download is an anchor click, and jsdom answers one with "Not implemented:
 * navigation" on a timer — noise in the output, and nothing a test can read a
 * filename off. Swapping the prototype's `click` leaves the ELEMENT alone, which
 * is where `download` and `href` are.
 */
export function captureDownloads(): { links: HTMLAnchorElement[]; restore: () => void } {
  const links: HTMLAnchorElement[] = [];
  const real = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    links.push(this);
  };
  return {
    links,
    restore: () => {
      HTMLAnchorElement.prototype.click = real;
    },
  };
}

/**
 * Puts a clipboard where jsdom has none, and takes it away again. Configurable,
 * so a test can hand back a rejection, and the no-clipboard test can DELETE it
 * and model the http:// session where the API simply does not exist.
 *
 * Here rather than in one suite because several surfaces copy now — the results
 * window's two panes and its install kit — and a clipboard mocked three subtly
 * different ways would be three different claims about one API.
 */
export function mockClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  });
  return {
    writeText: spy,
    restore: () => {
      delete (navigator as { clipboard?: unknown }).clipboard;
    },
  };
}

/**
 * The impact panel's numerals, keyed by the component each one states — e.g.
 * `{ stepsSaved: '1', estTimeSavedMin: '25' }`.
 *
 * Empty while nothing has been applied, and never carrying a key for a component
 * the applied patches did not move: the panel states what changed and nothing
 * else, and a helper that invented zeroes would hide that.
 */
export function impactStats(): Record<string, string> {
  const stats: Record<string, string> = {};
  for (const stat of screen.queryAllByTestId('impact-metric')) {
    const key = stat.getAttribute('data-part') ?? '';
    stats[key] = stat.querySelector('.sg-impact-value')?.textContent ?? '';
  }
  return stats;
}

/** Reports the whole session as unwanted motion, the way a real OS setting does. */
export function reduceMotion(): () => void {
  const original = window.matchMedia;
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  return () => {
    window.matchMedia = original;
  };
}
