import { gzipSync } from 'node:zlib';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import addE2eTests from '../../gallery/add-e2e-tests.workflow.json';
import payments from '../../gallery/ship-a-payments-feature.workflow.json';
import App from './App';
import { LAYOUT_WAIT } from './test/harness';

/** A share link the way the skill's closing stage writes one. */
function linkTo(document: unknown): string {
  return `#g=${gzipSync(JSON.stringify(document), { level: 9 }).toString('base64url')}`;
}

/** Puts the app at a URL, the way opening one would — without a history entry. */
function arriveAt(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
}

// The address bar is shared state for a file's worth of tests: a hash left
// behind by one is a link the next one never asked to arrive on.
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

it('renders the graph-index masthead', () => {
  render(<App />);
  expect(screen.getByText(/untangle/i)).toBeInTheDocument();
  expect(screen.getByText(/graph index/i)).toBeInTheDocument();
});

it('opens a gallery graph into the canvas view and returns', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  fireEvent.click(screen.getByText(/graph index/i));
  expect(screen.getAllByText('OPEN GRAPH').length).toBeGreaterThan(0);
});

it('shows GRAPH REJECTED for an invalid dropped file', async () => {
  render(<App />);
  const input = document.querySelector('input[type="file"]')!;
  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
  expect(screen.getByText('GRAPH REJECTED')).toBeInTheDocument();
  expect(screen.getByText(/failed validation — \d+ errors?/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText('BACK TO GRAPHS'));
  expect(screen.getAllByText('OPEN GRAPH').length).toBeGreaterThan(0);
});

it('shows GRAPH REJECTED for a file that is not JSON at all', async () => {
  render(<App />);
  const input = document.querySelector('input[type="file"]')!;
  const bad = new File(['not json {{{'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
  expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  // a single diagnostic is counted in the singular
  expect(screen.getByText('FAILED VALIDATION — 1 ERROR')).toBeInTheDocument();
});

it('opens a valid dropped file onto the canvas', async () => {
  render(<App />);
  const galleryRaw = JSON.stringify((await import('../../gallery/add-e2e-tests.workflow.json')).default);
  const input = document.querySelector('input[type="file"]')!;
  const good = new File([galleryRaw], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [good] } });
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
});

// Drop is a window-level affordance, not a gallery-only one: without the app-wide
// guard the browser navigates away from the SPA to render the dropped file.
it('opens a valid file dropped while a graph is already on the canvas', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  const raw = (await import('../../gallery/add-e2e-tests.workflow.json')).default as Record<
    string,
    unknown
  >;
  const renamed = JSON.stringify({
    ...raw,
    meta: { ...(raw.meta as Record<string, unknown>), title: 'Dropped in canvas view' },
  });
  const good = new File([renamed], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.drop(document.body, { dataTransfer: { files: [good] } });

  await waitFor(() => expect(screen.getByText('Dropped in canvas view')).toBeInTheDocument());
  expect(screen.getByTestId('canvas')).toBeInTheDocument();
});

it('rejects an invalid file dropped while a graph is already on the canvas', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.drop(document.body, { dataTransfer: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
});

// A run of the skill ends in a link, and this is what the link is worth: the
// whole canvas, opened from the address bar, with nothing left for the reader
// to do first.
it('opens a #g= link straight onto the canvas', async () => {
  arriveAt(linkTo(payments));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  expect(screen.getByText(payments.meta.title)).toBeInTheDocument();
});

it('shows GRAPH REJECTED for a link that will not decode, and forgets it on the way back', async () => {
  arriveAt('#g=!!!!');
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
  expect(screen.getByText(/not valid base64url/i)).toBeInTheDocument();

  fireEvent.click(screen.getByText('BACK TO GRAPHS'));
  expect(screen.getAllByText('OPEN GRAPH').length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('');
});

// The URL must not claim a graph that is not on screen.
it('forgets the link when the masthead leaves the graph it carried', async () => {
  arriveAt(linkTo(payments));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  expect(window.location.hash).not.toBe('');

  fireEvent.click(screen.getByText(/graph index/i));
  expect(screen.getAllByText('OPEN GRAPH').length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('');
});

// The index is on screen while the link is still being unzipped, so a reader who
// opens a graph from it is not overruled a moment later by one they navigated
// away from — and the URL stops claiming the one they left.
it('keeps the gallery graph opened while the link was still decoding', async () => {
  arriveAt(linkTo(addE2eTests));
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  expect(window.location.hash).toBe('');

  await waitFor(
    () => expect(screen.getAllByTestId('sg-node')).toHaveLength(payments.nodes.length),
    LAYOUT_WAIT,
  );
  expect(screen.getByText(payments.meta.title)).toBeInTheDocument();
  expect(screen.queryByText(addE2eTests.meta.title)).not.toBeInTheDocument();
});

// Dropping a file onto a linked graph IS the view leaving that link. Left in
// place, the URL would name a graph the reader has replaced: copying it would
// send the wrong one, and a reload would quietly put it back over theirs.
it('forgets the link when a dropped file replaces the graph it carried', async () => {
  arriveAt(linkTo(payments));
  render(<App />);
  await waitFor(() => expect(screen.getByText(payments.meta.title)).toBeInTheDocument());

  const mine = new File([JSON.stringify(addE2eTests)], 'mine.workflow.json', {
    type: 'application/json',
  });
  fireEvent.drop(document.body, { dataTransfer: { files: [mine] } });

  // Waited out to the painted cards: swapping the workflow re-runs the layout,
  // and the canvas is back to COMPILING GRAPH in between.
  await waitFor(
    () => expect(screen.getAllByTestId('sg-node')).toHaveLength(addE2eTests.nodes.length),
    LAYOUT_WAIT,
  );
  expect(screen.getByText(addE2eTests.meta.title)).toBeInTheDocument();
  expect(window.location.hash).toBe('');
});

// A file the loader refuses replaces the linked graph just as surely: the panel
// is on screen, so the URL has no graph left to claim.
it('forgets the link when a dropped file is rejected over the graph it carried', async () => {
  arriveAt(linkTo(payments));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.drop(document.body, { dataTransfer: { files: [bad] } });

  await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
  expect(window.location.hash).toBe('');
});

// The third way a dropped file can end: not read at all. jsdom's own FileReader
// never fails, so the branch is reachable only through a reader that does — and
// it spends the link exactly as the other two do, because the panel is what is
// on screen.
it('forgets the link when a dropped file cannot be read at all', async () => {
  arriveAt(linkTo(payments));
  render(<App />);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  class FailingReader {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    error = new Error('the drive went away');
    result: string | null = null;
    readAsText() {
      setTimeout(() => this.onerror?.(), 0);
    }
  }
  vi.stubGlobal('FileReader', FailingReader);
  try {
    const gone = new File(['{}'], 'gone.workflow.json', { type: 'application/json' });
    fireEvent.drop(document.body, { dataTransfer: { files: [gone] } });

    await waitFor(() => expect(screen.getByTestId('rejected-panel')).toBeInTheDocument());
    expect(screen.getByText('file: could not be read (the drive went away)')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  } finally {
    vi.unstubAllGlobals();
  }
});

// A hash the app did not write is none of its business — it neither opens it nor
// rewrites it.
it('leaves a URL that carries no graph exactly as it found it', async () => {
  arriveAt('#somewhere-else');
  render(<App />);
  expect(screen.getAllByText('OPEN GRAPH').length).toBeGreaterThan(0);

  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  expect(window.location.hash).toBe('#somewhere-else');
});

// The copy sweep is a product decision, not a style preference: nothing in the
// running app may speak the retired drafting-office vocabulary.
it('speaks no drafting vocabulary anywhere in the rendered index', () => {
  const { container } = render(<App />);
  expect(container.textContent).not.toMatch(/drawing|sheet|blueprint|plotting/i);
});
