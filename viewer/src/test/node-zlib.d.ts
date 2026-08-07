/**
 * The one compression call the suite touches, declared rather than depended on
 * for the reason `node-fs.d.ts` gives.
 *
 * `fragment.test.ts` writes the links it decodes the way the skill's closing
 * stage writes them — gzip the document, spell the bytes base64url — so the
 * round trip is proved against the encoder that actually produces links, not
 * against the browser's own compressor agreeing with its own decompressor.
 */
declare module 'node:zlib' {
  /** Bytes that can also spell themselves: as much of Buffer as this needs. */
  export function gzipSync(
    data: string | Uint8Array,
    options?: { level?: number },
  ): Uint8Array & { toString(encoding: 'base64url'): string };
}
