import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { applyOn, cardFor, cardLabels, cardsOf, fixture, LAYOUT_WAIT } from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

/**
 * The read-only route overlay: the most painful way through whatever version is
 * on screen. It changes nothing about the session — which is why it gets its
 * own suite: everything here is about what the canvas SHOWS, not about what it
 * does to the graph. (The other read-only view, the VS ORIGINAL wipe, has its
 * own suite in WipeCompare.test.tsx.)
 */

/**
 * A graph with two ways through it: a hand-run pair of steps, and a nightly job
 * that does the same work for less. The painful route is the one worth pointing
 * at — and the suggestion on it consolidates BOTH hand steps, which moves the
 * route onto the other branch rather than merely shortening this one.
 */
const BRANCHED = {
  meta: {
    task: 'reconcile the ledger every morning',
    title: 'Reconcile the Ledger',
    generatedAt: '2026-07-30T09:00:00Z',
    model: 'claude-fable-5',
    kbSource: 'airtable',
  },
  nodes: [
    { id: 'intake', label: 'Take the day’s ledger', kind: 'input', description: 'Pull the file.', painLevel: 1 },
    { id: 'manual-a', label: 'Copy the rows by hand', kind: 'process', description: 'Row by row into the sheet.', painLevel: 5 },
    { id: 'manual-b', label: 'Check the copy by hand', kind: 'review', description: 'Read both columns back.', painLevel: 4 },
    { id: 'auto', label: 'Let the nightly job run', kind: 'process', description: 'It already does this.', painLevel: 2 },
    { id: 'ship', label: 'Post the reconciliation', kind: 'output', description: 'File it.', painLevel: 1 },
  ],
  edges: [
    { from: 'intake', to: 'manual-a', kind: 'sequence' },
    // labelled so the suite has a tag ON the route to hold against the ones off it
    { from: 'manual-a', to: 'manual-b', kind: 'sequence', label: 'row by row' },
    { from: 'manual-b', to: 'ship', kind: 'sequence' },
    { from: 'intake', to: 'auto', kind: 'branch', label: 'overnight' },
    { from: 'auto', to: 'ship', kind: 'branch' },
    // spans the whole graph right-to-left, so its return run has to clear every
    // row between the two ends — the case the lane plan exists for
    { from: 'ship', to: 'intake', kind: 'retry', label: 'breaks' },
  ],
  suggestions: [
    {
      nodeId: 'manual-a',
      airtableRecordId: 'recZ9yX8wV7uT6sR5',
      name: 'ledger-reconcile skill',
      url: 'https://github.com/anthropics/skills',
      category: 'Claude Skill',
      claim: 'Copies the rows and reads them back in one pass.',
      effect: {
        removeNodes: ['manual-a', 'manual-b'],
        mergeNodes: [],
        replaceWith: {
          id: 'assisted',
          label: 'Reconcile in one pass',
          kind: 'process',
          description: 'The copy and the read-back happen together.',
          painLevel: 1,
        },
        newEdges: [
          { from: 'intake', to: 'assisted', kind: 'sequence' },
          { from: 'assisted', to: 'ship', kind: 'sequence' },
        ],
        metrics: { stepsSaved: 1, estTimeSavedMin: 45, estTokensSaved: 0, manualInterventionsRemoved: 2 },
      },
    },
  ],
};

const branched = fixture(BRANCHED, 'branched');

/**
 * Three steps in a ring, so the sweep can settle none of them: a graph whose
 * logical edges form a cycle has no longest path, and `criticalPath` answers
 * NO_PATH rather than inventing one. The canvas has nothing to point at — which
 * is exactly the case where stepping the rest of the graph back would dim the
 * WHOLE picture with nothing left lit to explain why.
 */
const CYCLIC = {
  meta: {
    task: 'chase the approval round and round',
    title: 'Approval Merry-Go-Round',
    generatedAt: '2026-07-30T09:00:00Z',
    model: 'claude-fable-5',
    kbSource: 'airtable',
  },
  nodes: [
    { id: 'draft', label: 'Draft the note', kind: 'process', description: 'Write it up.', painLevel: 3 },
    { id: 'review', label: 'Send it for review', kind: 'review', description: 'Wait on a reply.', painLevel: 4 },
    { id: 'revise', label: 'Revise and resend', kind: 'process', description: 'Round we go.', painLevel: 5 },
  ],
  edges: [
    { from: 'draft', to: 'review', kind: 'sequence' },
    { from: 'review', to: 'revise', kind: 'sequence' },
    // a BRANCH, not a retry: retries are excluded from the logical graph, so this
    // is what actually leaves the sweep with a cycle it cannot answer about
    { from: 'revise', to: 'draft', kind: 'branch', label: 'again' },
  ],
  suggestions: [],
};

const cyclic = fixture(CYCLIC, 'cyclic');

const HAND_COPY = 'Copy the rows by hand';
const NIGHTLY = 'Let the nightly job run';

/**
 * How far off-path elements step back — the value tokens.css states.
 *
 * jsdom loads no stylesheet, so the token has to be installed by hand for the
 * edge to resolve it at render time. Installed for the whole suite because
 * nothing else reads it: a graph with no route up asks for it and gets nothing
 * back, exactly as it does in a browser.
 */
const DIM = '0.35';

beforeEach(() => {
  document.documentElement.style.setProperty('--critpath-dim-opacity', DIM);
});
afterEach(() => {
  document.documentElement.style.removeProperty('--critpath-dim-opacity');
});

const labelsOf = (els: Element[]) =>
  els.map((el) => el.querySelector('.sg-label')?.textContent ?? '');

/** The steps the glow is on, whatever version is drawn. */
const criticalLabels = () => labelsOf([...document.querySelectorAll('.sg-node--critical')]);
/** The steps the glow is NOT on, which is what steps back while it is up. */
const offPathLabels = () => labelsOf([...document.querySelectorAll('.sg-node-shell--offpath')]);

/** What the stepped-back tags say — the conditions hanging off the dimmed edges. */
const offPathTagText = () =>
  [...document.querySelectorAll('.sg-edge-tag--offpath')].map((el) => el.textContent ?? '');

const critBtn = () => screen.getByTestId('critpath-btn');

// ---------------------------------------------------------------------------
// Critical path: the most painful way through
// ---------------------------------------------------------------------------

it('glows the most painful route and leaves the cheap branch alone', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  expect(critBtn()).toHaveTextContent('CRITICAL PATH');
  expect(critBtn()).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  expect(critBtn()).toHaveAttribute('aria-pressed', 'true');
  expect(criticalLabels()).toContain(HAND_COPY);
  expect(criticalLabels()).not.toContain(NIGHTLY);
  // the three hops along it, and neither of the two around the cheap branch
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(3);
  }, LAYOUT_WAIT);
});

it('takes the glow off again when the toggle is released', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0));
  expect(document.querySelectorAll('path.sg-edge--critical')).toHaveLength(0);
  // and the graph comes all the way back up with it: nothing is left standing at
  // the dim, in either the class or the attribute that carries it into a picture
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);
  expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-edge-tag--offpath')).toHaveLength(0);
  expect(container.querySelectorAll(`path.sg-edge[opacity="${DIM}"]`)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The inversion. The route keeps the treatment it has always had; what changes
// is the rest of the graph, which steps back out of its way.
// ---------------------------------------------------------------------------

it('steps the off-path graph back — nodes, edges and the tags on them', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  // nothing steps back until there is a route to step back FROM
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);

  fireEvent.click(critBtn());
  await waitFor(() => expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(4));

  // the one step off the route, and only it
  await waitFor(() => expect(offPathLabels()).toEqual([NIGHTLY]));
  // the route's own cards keep exactly what they had: glow, and no dim
  expect(criticalLabels()).toContain(HAND_COPY);
  for (const card of document.querySelectorAll('.sg-node--critical')) {
    expect(card.closest('.sg-node-shell')!.classList.contains('sg-node-shell--offpath')).toBe(
      false,
    );
  }

  // the two branch hops around the cheap route and the retry that spans the
  // graph — every edge the route does not run along
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);
  expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(3);
  // and never both at once
  expect(container.querySelectorAll('path.sg-edge--critical.sg-edge--offpath')).toHaveLength(0);

  // the conditions hanging off those edges go with them; the one on the route stays
  expect(offPathTagText()).toEqual(expect.arrayContaining(['overnight', 'breaks']));
  expect(offPathTagText()).not.toContain('row by row');
});

/**
 * The T3 lesson, pinned at the level it actually bites: html-to-image does not
 * carry CSS-derived presentation onto cloned SVG children, so a dim that lived
 * only in a class would export as a graph where nothing stepped back — the
 * shared picture would contradict the screen about which run is expensive.
 */
it('states the off-path dim as an attribute, so an exported picture carries it', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);

  const dimmed = [...container.querySelectorAll('path.sg-edge--offpath')];
  expect(dimmed.map((p) => p.getAttribute('opacity'))).toEqual([DIM, DIM, DIM]);
  // the route is untouched — full strength, as it has always been
  for (const path of container.querySelectorAll('path.sg-edge--critical')) {
    expect(path.getAttribute('opacity')).toBe('1');
  }
});

// Stepped back is not switched off. The cheap branch is still a step you can ask
// about — dimming it says "not the expensive route", not "not available".
it('leaves a stepped-back card open to a pointer', async () => {
  render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(offPathLabels()).toEqual([NIGHTLY]));

  fireEvent.click(cardFor(NIGHTLY, screen.getAllByTestId('sg-node')));
  expect(await screen.findByTestId('detail-drawer')).toHaveTextContent(NIGHTLY);
});

// A graph the sweep cannot answer about points at nothing — and a dim with
// nothing lit beside it is a whole picture stepped back for no stated reason.
it('steps nothing back on a graph with no route to point at', async () => {
  const { container } = render(<GraphCanvas workflow={cyclic} />);
  await cardsOf(cyclic);

  fireEvent.click(critBtn());
  // the toggle is down and the canvas says so, but there is no answer to draw
  expect(critBtn()).toHaveAttribute('aria-pressed', 'true');
  // waited on a POSITIVE fact, so the absences below are read off a graph that
  // has actually drawn its edges rather than one that has not got to them yet
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge')).toHaveLength(cyclic.edges.length);
  }, LAYOUT_WAIT);

  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-node-shell--offpath')).toHaveLength(0);
  expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(0);
  expect(document.querySelectorAll('.sg-edge-tag--offpath')).toHaveLength(0);
});

// The payoff: consolidating the two hand steps makes the nightly branch the worst
// way through, and the glow moves onto it without the toggle being touched.
it('recomputes the route on the version that is on screen', async () => {
  const { container } = render(<GraphCanvas workflow={branched} />);
  await cardsOf(branched);

  fireEvent.click(critBtn());
  await waitFor(() => expect(criticalLabels()).toContain(HAND_COPY));

  await applyOn(HAND_COPY);
  await waitFor(() => expect(cardLabels()).toContain('Reconcile in one pass'), LAYOUT_WAIT);

  await waitFor(() => expect(criticalLabels()).toEqual(expect.arrayContaining([NIGHTLY])));
  expect(criticalLabels()).not.toContain('Reconcile in one pass');
  expect(document.querySelectorAll('.sg-node--critical')).toHaveLength(3);
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--critical')).toHaveLength(2);
  }, LAYOUT_WAIT);

  // and the boundary moves with the glow: the step that used to BE the route is
  // now the cheap way through, so it is the one that steps back
  await waitFor(() => expect(offPathLabels()).toEqual(['Reconcile in one pass']));
  await waitFor(() => {
    expect(container.querySelectorAll('path.sg-edge--offpath')).toHaveLength(3);
  }, LAYOUT_WAIT);
});
