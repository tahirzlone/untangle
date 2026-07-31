import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toPng } from 'html-to-image';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import {
  applyOn,
  captureDownloads,
  cardLabels,
  cardsOf,
  fixture,
  LAYOUT_WAIT,
  reduceMotion,
} from '../test/harness';
import { GraphCanvas } from './GraphCanvas';

// The rasterizer is a stub here for the same reason it is in exportPng.test.ts:
// jsdom paints nothing. What this suite watches is the BUTTONS — when they are
// on offer, what they ask for, and what they say when the answer is a failure.
vi.mock('html-to-image', () => ({ toPng: vi.fn() }));
const rasterize = vi.mocked(toPng);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
/** The canvas ink, as the app carries it: a token on the root, not a literal. */
const BG = 'rgb(11, 14, 20)';

const plain = fixture(gallery, 'gallery');
const enriched = fixture(enrichedDoc, 'enriched');
const RESEARCH = 'Research the libraries & read the docs';
const RESEARCH_MCP = 'Pull the docs in-session';

/** A paced tour is real time — a camera move, a beat, an apply, a morph. */
const TOUR_BUDGET = 25000;

let downloads: ReturnType<typeof captureDownloads>;

beforeEach(() => {
  rasterize.mockReset();
  rasterize.mockResolvedValue(PNG);
  downloads = captureDownloads();
  // jsdom loads no stylesheet, so the token is put where the cascade would have
  // it — the export resolves it from there rather than carrying a colour of its own.
  document.documentElement.style.setProperty('--bg', BG);
});

afterEach(() => {
  downloads.restore();
  document.documentElement.style.removeProperty('--bg');
});

const exportBtn = () => screen.getByTestId('export-btn');

/** The one call the rasterizer took, once it has been made. */
async function captured() {
  await waitFor(() => expect(rasterize).toHaveBeenCalledTimes(1));
  return rasterize.mock.calls[0][1];
}

it('exports the graph on screen, in the theme it is drawn in', async () => {
  render(<GraphCanvas workflow={plain} />);
  await cardsOf(plain);

  fireEvent.click(exportBtn());

  const options = await captured();
  expect(options?.backgroundColor).toBe(BG);
  expect(options?.width).toBeGreaterThan(0);

  await waitFor(() => expect(downloads.links).toHaveLength(1));
  expect(downloads.links[0].download).toBe(
    'flowprint-add-e2e-tests-to-an-existing-web-app-v0.png',
  );
  expect(downloads.links[0].href).toBe(PNG);
});

// The file is named after what is on screen, and after an APPLY that is V1 — so
// two exports of the same graph are two files, not one overwriting the other.
it('names the file after the version the cursor is on', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    await applyOn(RESEARCH);
    await waitFor(() => expect(cardLabels()).toContain(RESEARCH_MCP), LAYOUT_WAIT);

    fireEvent.click(exportBtn());
    await waitFor(() => expect(downloads.links).toHaveLength(1));
    expect(downloads.links[0].download).toBe('flowprint-ship-a-feature-end-to-end-v1.png');
  } finally {
    restore();
  }
});

// The camera is mid-flight and the graph is mid-morph: a capture taken now is a
// picture of a half-applied version nobody asked for.
it(
  'stands down while the tour is running',
  async () => {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);

    fireEvent.click(screen.getByTestId('optimize-btn'));
    expect(screen.queryByTestId('export-btn')).not.toBeInTheDocument();

    // CANCEL stops it after the patch in flight, and the way out comes back
    fireEvent.click(screen.getByTestId('optimize-btn'));
    await screen.findByTestId('scorecard', {}, LAYOUT_WAIT);
    expect(exportBtn()).toBeInTheDocument();
  },
  TOUR_BUDGET,
);

// ---------------------------------------------------------------------------
// The scorecard's own
// ---------------------------------------------------------------------------

it('exports from the scorecard, and stays open afterwards', async () => {
  const restore = reduceMotion();
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(screen.getByTestId('optimize-btn'));
    const card = await screen.findByTestId('scorecard');

    const button = screen.getByTestId('export-png');
    expect(button).toBeEnabled();
    // the placeholder the cinematic shipped with is gone, not merely disabled
    expect(card).not.toHaveTextContent('EXPORT ARRIVES WITH T3');

    fireEvent.click(button);
    await waitFor(() => expect(downloads.links).toHaveLength(1));
    // V2 of this graph: the run applied both patches on offer
    expect(downloads.links[0].download).toBe('flowprint-ship-a-feature-end-to-end-v2.png');
    // the panel is a report, not a wizard — exporting is not leaving
    expect(screen.getByTestId('scorecard')).toBeInTheDocument();
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// When the capture fails
// ---------------------------------------------------------------------------

it('says so, near the button, when the capture fails', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  rasterize.mockRejectedValue(new Error('tainted canvas'));
  try {
    render(<GraphCanvas workflow={plain} />);
    await cardsOf(plain);

    fireEvent.click(exportBtn());

    expect(await screen.findByTestId('export-failed')).toHaveTextContent('EXPORT FAILED');
    expect(downloads.links).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
  }
});

it('says so inside the scorecard when that is where the press came from', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const restore = reduceMotion();
  rasterize.mockRejectedValue(new Error('tainted canvas'));
  try {
    render(<GraphCanvas workflow={enriched} />);
    await cardsOf(enriched);
    fireEvent.click(screen.getByTestId('optimize-btn'));
    await screen.findByTestId('scorecard');

    fireEvent.click(screen.getByTestId('export-png'));

    expect(await screen.findByTestId('scorecard-export-failed')).toHaveTextContent('EXPORT FAILED');
    // the note belongs where the press was, not on the toolbar behind the backdrop
    expect(screen.queryByTestId('export-failed')).not.toBeInTheDocument();
  } finally {
    restore();
    warn.mockRestore();
  }
});
