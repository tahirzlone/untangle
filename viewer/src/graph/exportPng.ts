import { getViewportForBounds, type Rect } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { resolveToken } from './tokens';

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
  return `untangle-${kebab(title)}-v${version}.png`;
}

/** The smallest rect holding every rect handed in, or an empty one from nothing. */
export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const box = rects.reduce(
    (b, r) => ({
      left: Math.min(b.left, r.x),
      top: Math.min(b.top, r.y),
      right: Math.max(b.right, r.x + r.width),
      bottom: Math.max(b.bottom, r.y + r.height),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
  return { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top };
}

/**
 * Where the edges actually go, in flow coordinates.
 *
 * Measured off the paths rather than worked out from the routes: `getBBox`
 * answers in the SVG's own user space, which IS flow space (React Flow's edge
 * layer is an untransformed child of the transformed viewport), and it covers
 * everything a route can do — a back-edge's return lane running below the lowest
 * card, a bezier's belly — without this file knowing how any of it is planned.
 *
 * jsdom implements no SVG geometry, so there `getBBox` is simply absent and the
 * edges contribute nothing. That is a measurement gap in the suite, not a
 * silently wrong number: the node bounds still frame the picture.
 */
export function edgeRects(root: ParentNode = document): Rect[] {
  const rects: Rect[] = [];
  for (const path of root.querySelectorAll<SVGGraphicsElement>('path.sg-edge')) {
    if (typeof path.getBBox !== 'function') continue;
    const { x, y, width, height } = path.getBBox();
    rects.push({ x, y, width, height });
  }
  return rects;
}

/**
 * Where the edge tags sit, in flow coordinates.
 *
 * A tag is an HTML chip in React Flow's edge-label layer, centred on its point by
 * the same `translate(-50%, -50%) translate(Xpx, Ypx)` EdgeTag writes — so the
 * point is read back off that transform and the chip's own box comes from its
 * offset size, which is unscaled because the layer above it carries the zoom.
 */
export function tagRects(root: ParentNode = document): Rect[] {
  const rects: Rect[] = [];
  for (const tag of root.querySelectorAll<HTMLElement>('.sg-edge-tag')) {
    const at = tag.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    if (!at) continue;
    const width = tag.offsetWidth;
    const height = tag.offsetHeight;
    rects.push({ x: Number(at[1]) - width / 2, y: Number(at[2]) - height / 2, width, height });
  }
  return rects;
}

/**
 * Everything the picture has to contain: the cards, the edges between them, and
 * the tags on those edges.
 *
 * Node bounds alone are not the graph. A back-edge's return lane runs below the
 * lowest card by design, and a tag hangs half its own width past the point it is
 * centred on — framing on the cards clips both.
 */
export function contentBounds(nodeBounds: Rect, root: ParentNode = document): Rect {
  return unionRects([nodeBounds, ...edgeRects(root), ...tagRects(root)]);
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
  /**
   * What the picture has to contain, in graph space — cards, edges and tags.
   * `contentBounds` is how a caller works that out; node bounds alone clip.
   */
  bounds: Rect;
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
  bounds,
  title,
  version,
}: ExportRequest): Promise<void> {
  const { width, height, scale } = exportSize(bounds);
  // The frame was BUILT for this zoom — the padding is already in `width` and
  // `height` — so the bounds are told to fill it at exactly `scale` rather than
  // being fitted a second time and landing a fraction off.
  const { x, y, zoom } = getViewportForBounds(
    bounds,
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
