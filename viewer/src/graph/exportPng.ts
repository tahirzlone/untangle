import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng } from 'html-to-image';

/**
 * The graph, as a file you can put in a slide.
 *
 * This is xyflow's own documented recipe: rasterize the `.react-flow__viewport`
 * element — the thing every card and edge is drawn inside — with a transform that
 * frames the graph's bounds, rather than screenshotting whatever the window
 * happens to be showing. What you get is the WHOLE graph at a readable size, not
 * the part of it that fitted.
 *
 * The dot grid does not come with it. The grid is painted by `.sg-canvas`, which
 * is the backdrop the viewport sits on and not part of the element being
 * captured, so the export lands on a flat `--bg` instead. Carrying the grid over
 * would mean putting a background on the captured element itself — where it would
 * be transformed along with the graph, and a grid that scales with the zoom is a
 * grid that is lying about the canvas. Flat is the honest cheap answer.
 */

/** Breathing room around the graph in the finished image, in CSS pixels. */
export const EXPORT_PADDING = 48;

/**
 * How many image pixels each CSS pixel becomes. 2x is what makes text in the
 * cards survive being pasted into a deck and zoomed.
 */
export const EXPORT_SCALE = 2;

/**
 * The widest image this will produce. A sprawling graph is rendered smaller
 * rather than at a size no chat window, deck or issue tracker will take.
 */
export const EXPORT_MAX_WIDTH = 2560;

/** What a title with nothing filename-safe left in it is called. */
const FALLBACK_SLUG = 'graph';

/** The size of the picture, and the zoom that fills it. */
export interface ExportSize {
  /** Image width in pixels, padding included. */
  width: number;
  /** Image height in pixels, padding included. */
  height: number;
  /** How much bigger than CSS pixels that is — `EXPORT_SCALE`, or less if capped. */
  scale: number;
}

/**
 * How big an image the graph needs, and at what magnification.
 *
 * The padded graph is rendered at `EXPORT_SCALE`, unless that would put it past
 * `EXPORT_MAX_WIDTH` — in which case the scale comes down until it fits. Both
 * axes take the SAME scale, so the picture never distorts to make the cap.
 */
export function exportSize(bounds: Rect): ExportSize {
  const paddedWidth = bounds.width + EXPORT_PADDING * 2;
  const paddedHeight = bounds.height + EXPORT_PADDING * 2;
  const scale = Math.min(EXPORT_SCALE, EXPORT_MAX_WIDTH / paddedWidth);
  return {
    width: Math.round(paddedWidth * scale),
    height: Math.round(paddedHeight * scale),
    scale,
  };
}

/**
 * A title, as something a file system will take.
 *
 * Everything that is not a letter or a digit is a word break — the display face's
 * em dashes and the punctuation around them included — and accents fold onto the
 * letter they are drawn on rather than being dropped, so "Café Ops" is `cafe-ops`
 * and not `caf-ops`.
 */
export function kebab(title: string): string {
  const slug = title
    .normalize('NFKD')
    // the combining marks NFKD just split off
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || FALLBACK_SLUG;
}

/**
 * What the file is called: the graph, and the version of it on screen. Two
 * exports of two versions are two files — the second does not quietly replace
 * the first in the downloads folder.
 */
export function exportFilename(title: string, version: number): string {
  return `flowprint-${kebab(title)}-v${version}.png`;
}

/**
 * The canvas ink, as the page currently resolves it.
 *
 * Read at call time rather than written here as a hex literal: the theme owns its
 * colours, and an exported PNG whose background was pinned in TypeScript would go
 * on being the old background after a token changed.
 *
 * The element first, because that is where a browser answers with the inherited
 * value; the document root second, because jsdom does not implement custom
 * property inheritance and the suite would otherwise be testing nothing. Nothing
 * third: an unresolved token exports a transparent background, which is at least
 * not a colour this file invented.
 */
function resolveToken(el: HTMLElement, name: string): string | undefined {
  const own = getComputedStyle(el).getPropertyValue(name).trim();
  if (own) return own;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/** Hands the browser a file, the only way a page can: an anchor, clicked. */
function download(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

export interface ExportRequest {
  /** React Flow's viewport element — everything the graph is drawn inside. */
  viewportEl: HTMLElement;
  /** Where the cards are, in graph space: what the picture has to contain. */
  nodesBounds: Rect;
  /** The workflow's title, which the file is named after. */
  title: string;
  /** The version on screen, which the file is named after too. */
  version: number;
}

/**
 * Captures the graph and hands it over as a download.
 *
 * Rejects rather than reporting: whether a failed capture is a note beside a
 * button, a toast or a silence is the caller's decision, not this module's.
 */
export async function exportGraphPng({
  viewportEl,
  nodesBounds,
  title,
  version,
}: ExportRequest): Promise<void> {
  const { width, height, scale } = exportSize(nodesBounds);
  // The frame was BUILT for this zoom — the padding is already in `width` and
  // `height` — so the bounds are told to fill it at exactly `scale` rather than
  // being fitted a second time and landing a fraction off.
  const { x, y, zoom } = getViewportForBounds(
    nodesBounds,
    width,
    height,
    scale,
    scale,
    `${EXPORT_PADDING * scale}px`,
  );

  const dataUrl = await toPng(viewportEl, {
    backgroundColor: resolveToken(viewportEl, '--bg'),
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
    // The magnification is already in the frame's own dimensions; left alone,
    // html-to-image would multiply by the device ratio on top and a retina
    // machine would export a 4x file nobody asked for.
    pixelRatio: 1,
  });

  download(dataUrl, exportFilename(title, version));
}
