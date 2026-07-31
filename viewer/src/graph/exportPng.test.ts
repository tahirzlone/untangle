import { toPng } from 'html-to-image';
import { captureDownloads } from '../test/harness';
import {
  EXPORT_MAX_WIDTH,
  EXPORT_PADDING,
  EXPORT_SCALE,
  exportFilename,
  exportGraphPng,
  exportSize,
  kebab,
} from './exportPng';

// jsdom cannot rasterize a thing, so the rasterizer is a stub: what this suite
// pins is everything AROUND it — the size it is asked for, the transform, the
// background it is handed, and the download that follows. The picture itself is
// the reviewer's job, in a real browser.
vi.mock('html-to-image', () => ({ toPng: vi.fn() }));
const rasterize = vi.mocked(toPng);

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * Every capture in here ends in a download, and jsdom answers an anchor click
 * with "Not implemented: navigation" on a timer — so the route is stubbed for the
 * whole file rather than around the two tests that read from it.
 */
let downloads: ReturnType<typeof captureDownloads>;

beforeEach(() => {
  rasterize.mockReset();
  rasterize.mockResolvedValue(PNG);
  downloads = captureDownloads();
  document.body.innerHTML = '';
});

afterEach(() => {
  downloads.restore();
});

/**
 * A stand-in for React Flow's viewport element, carrying the theme token the
 * export has to read its background off. Set inline because jsdom resolves
 * inline custom properties and nothing else — in the app the same value arrives
 * by inheritance from `:root`.
 */
function stubViewport(bg = 'rgb(11, 14, 20)'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'react-flow__viewport';
  el.style.setProperty('--bg', bg);
  document.body.append(el);
  return el;
}

const BOUNDS = { x: 0, y: 0, width: 800, height: 600 };

// ---------------------------------------------------------------------------
// The slug
// ---------------------------------------------------------------------------

it('turns a title into a filename-safe slug', () => {
  expect(kebab('Add E2E Tests to an Existing Web App')).toBe(
    'add-e2e-tests-to-an-existing-web-app',
  );
  // the display face's em dash is a word break, not a letter
  expect(kebab('Payments — Refund Flow')).toBe('payments-refund-flow');
  expect(kebab('Ship it!  (v2)')).toBe('ship-it-v2');
  // punctuation at either end leaves no dash hanging off the filename
  expect(kebab('  /Release/  ')).toBe('release');
  // accents fold to the letter they are drawn on rather than vanishing
  expect(kebab('Café Ops')).toBe('cafe-ops');
});

it('falls back to a name rather than an empty one', () => {
  expect(kebab('———')).toBe('graph');
  expect(kebab('')).toBe('graph');
});

it('names the file after the graph and the version on screen', () => {
  expect(exportFilename('Payments — Refund Flow', 3)).toBe(
    'flowprint-payments-refund-flow-v3.png',
  );
  expect(exportFilename('Ship a Feature End to End', 0)).toBe(
    'flowprint-ship-a-feature-end-to-end-v0.png',
  );
});

// ---------------------------------------------------------------------------
// How big the picture is
// ---------------------------------------------------------------------------

it('pads the graph and renders it at 2x', () => {
  const size = exportSize(BOUNDS);
  expect(size.scale).toBe(EXPORT_SCALE);
  expect(size.width).toBe((800 + EXPORT_PADDING * 2) * EXPORT_SCALE);
  expect(size.height).toBe((600 + EXPORT_PADDING * 2) * EXPORT_SCALE);
});

it('caps how wide the image gets, without distorting it', () => {
  const wide = { x: 0, y: 0, width: 4000, height: 1000 };
  const size = exportSize(wide);

  expect(size.width).toBe(EXPORT_MAX_WIDTH);
  expect(size.scale).toBeLessThan(EXPORT_SCALE);
  // the padded graph's own proportions, kept: nothing is squashed to fit
  const padded = (4000 + EXPORT_PADDING * 2) / (1000 + EXPORT_PADDING * 2);
  expect(size.width / size.height).toBeCloseTo(padded, 2);
});

it('never scales past 2x, however small the graph', () => {
  const size = exportSize({ x: 0, y: 0, width: 10, height: 10 });
  expect(size.scale).toBe(EXPORT_SCALE);
  expect(size.width).toBeLessThanOrEqual(EXPORT_MAX_WIDTH);
});

// ---------------------------------------------------------------------------
// The capture
// ---------------------------------------------------------------------------

it('hands the rasterizer the resolved background, not a colour of its own', async () => {
  const el = stubViewport('rgb(1, 2, 3)');
  await exportGraphPng({ viewportEl: el, nodesBounds: BOUNDS, title: 'Whatever', version: 0 });

  expect(rasterize).toHaveBeenCalledTimes(1);
  const [node, options] = rasterize.mock.calls[0];
  expect(node).toBe(el);
  // read off the element at call time — change the token and the picture changes
  expect(options?.backgroundColor).toBe('rgb(1, 2, 3)');
});

it('asks for a padded, centred, 2x frame of the graph', async () => {
  const el = stubViewport();
  await exportGraphPng({ viewportEl: el, nodesBounds: BOUNDS, title: 'Whatever', version: 0 });

  const options = rasterize.mock.calls[0][1];
  const { width, height } = exportSize(BOUNDS);
  expect(options?.width).toBe(width);
  expect(options?.height).toBe(height);
  expect(options?.style?.width).toBe(`${width}px`);
  expect(options?.style?.height).toBe(`${height}px`);
  // 48px of padding, at 2x: the graph starts 96 device pixels in on both axes
  expect(options?.style?.transform).toBe('translate(96px, 96px) scale(2)');
  // the 2x is in the frame itself, so the device must not double it again
  expect(options?.pixelRatio).toBe(1);
});

it('downloads what came back, under the graph’s name', async () => {
  await exportGraphPng({
    viewportEl: stubViewport(),
    nodesBounds: BOUNDS,
    title: 'Payments — Refund Flow',
    version: 2,
  });

  expect(downloads.links).toHaveLength(1);
  expect(downloads.links[0].download).toBe('flowprint-payments-refund-flow-v2.png');
  expect(downloads.links[0].href).toBe(PNG);
});

it('lets a failed capture through to the caller, and downloads nothing', async () => {
  rasterize.mockRejectedValue(new Error('tainted canvas'));

  await expect(
    exportGraphPng({ viewportEl: stubViewport(), nodesBounds: BOUNDS, title: 'Nope', version: 0 }),
  ).rejects.toThrow('tainted canvas');
  expect(downloads.links).toHaveLength(0);
});
