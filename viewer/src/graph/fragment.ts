import { loadWorkflow } from './load';
import type { LoadResult } from './types';

/**
 * A graph that arrived in the URL.
 *
 * The skill ends every run by printing `…/untangle/#g=<base64url(gzip(document))>`,
 * and this is the other half of it. A fragment is never sent anywhere — no
 * request a browser makes carries the part after the `#` — so the decode is
 * entirely local, and a link discloses the graph to nobody but whoever opens it.
 *
 * The decoded document goes through `loadWorkflow` untouched, which is the same
 * gate a dropped file passes. A link is not a second way in with a second set of
 * rules: what the page will not open from disk it will not open from an address.
 */

/** What marks a URL as carrying a graph. Any other hash is a plain visit. */
const PREFIX = '#g=';

/** A leading byte-order mark: editors write it into JSON, JSON.parse refuses it. */
const BOM = 0xfeff;

/**
 * Text with its byte-order mark removed.
 *
 * Shared with the file-drop path rather than written twice: the same documents
 * arrive both ways, and a mark stripped in one place only is a file that opens
 * from disk and not from a link.
 */
export function withoutBom(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/**
 * What a `#g=` link carries, or `null` for a hash that is not one — an empty
 * fragment, or anything else a URL might have in it.
 *
 * Takes the raw `location.hash`, `#` included, so no caller has to know how a
 * browser spells "no fragment".
 */
export function graphPayload(hash: string): string | null {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null;
}

/**
 * base64url as bytes. Throws, as `atob` does, on anything outside the alphabet.
 *
 * `Buffer#toString('base64url')` — what writes these links — swaps two
 * characters of the alphabet and drops the padding; `atob` takes neither.
 */
function bytesOf(payload: string): Uint8Array {
  const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The bytes unzipped, as text. Rejects on anything that is not a gzip stream.
 *
 * Fed from a stream written here rather than from `new Blob([bytes]).stream()`:
 * jsdom's Blob (26.x) implements neither `stream` nor `text`, and the drop path
 * already carries one note about that surface.
 */
async function gunzip(bytes: Uint8Array): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  // whatever is left of a character split across the last two chunks
  return text + decoder.decode();
}

/**
 * What the engine said, in brackets — or nothing, when it said nothing.
 *
 * Not every engine explains itself: a browser's gzip stream rejects with "The
 * compressed data was not valid", node's with a TypeError carrying no message at
 * all, and an empty pair of brackets on the rejection panel tells a reader less
 * than no brackets does.
 */
function detail(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message !== '' ? ` (${message})` : '';
}

/**
 * The workflow a `#g=` link carries, or `null` when the hash is not one and the
 * caller should carry on to the index.
 *
 * Async because unzipping on the platform is a stream. Every failure comes back
 * in `loadWorkflow`'s own shape, so a link that will not open says why in the
 * same panel and the same words a file that will not open says it.
 */
export async function decodeFragment(hash: string): Promise<LoadResult | null> {
  const payload = graphPayload(hash);
  if (payload === null) return null;

  // Checked before the payload is touched: on a browser this old, nothing said
  // about the base64 would be the reason the link does not open.
  if (typeof DecompressionStream === 'undefined') {
    return {
      ok: false,
      errors: [
        'link: this browser cannot unzip a shared graph — open the link in a current browser, or drop the workflow file onto this page',
      ],
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = bytesOf(payload);
  } catch (err) {
    return { ok: false, errors: [`link: not valid base64url${detail(err)}`] };
  }

  let text: string;
  try {
    text = await gunzip(bytes);
  } catch (err) {
    return { ok: false, errors: [`link: not a gzipped graph${detail(err)}`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(withoutBom(text));
  } catch (err) {
    return { ok: false, errors: [`link: not valid JSON${detail(err)}`] };
  }

  return loadWorkflow(raw);
}
