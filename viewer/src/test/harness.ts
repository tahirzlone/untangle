import { fireEvent, screen, waitFor } from '@testing-library/react';
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
