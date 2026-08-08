import { gzipSync } from 'node:zlib';
import payments from '../../../gallery/ship-a-payments-feature.workflow.json';
import { MAX_DECODED_BYTES, decodeFragment, graphPayload, withoutBom } from './fragment';

/**
 * A link the way the skill's closing stage writes one: the document gzipped,
 * the bytes spelled base64url. Encoded by node's zlib rather than by the
 * platform's own CompressionStream, so a passing round trip says the viewer
 * agrees with the encoder that will really be producing links — not with itself.
 */
function link(document: string): string {
  return `#g=${gzipSync(document, { level: 9 }).toString('base64url')}`;
}

/** Arbitrary bytes as a payload, for the ones no encoder would ever write. */
function payload(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/**
 * The mark an editor puts at the head of a saved file, as an escape: pasted in
 * as itself it would be invisible in every diff of this file.
 */
const BOM = '\ufeff';

/**
 * The decode is unzipping, and unzipping on the platform is a stream. Nothing in
 * `src/test/setup.ts` polyfills it: this is the shipped path, run as shipped.
 */
it('has the platform gzip decoder the shipped path uses', () => {
  expect(typeof DecompressionStream).toBe('function');
});

it('opens the richest gallery graph out of a link', async () => {
  const res = await decodeFragment(link(JSON.stringify(payments)));

  expect(res?.ok).toBe(true);
  if (!res?.ok) throw new Error('the link did not decode');
  expect(res.workflow.meta.title).toBe(payments.meta.title);
  expect(res.workflow.nodes).toHaveLength(payments.nodes.length);
  expect(res.workflow.edges).toHaveLength(payments.edges.length);
});

// The claim the link makes is the WHOLE experience, not a picture of the graph:
// without the suggestions there is nothing to apply, and OPTIMIZE has no work.
it('carries the suggestions, upgrades and metrics intact', async () => {
  const res = await decodeFragment(link(JSON.stringify(payments)));

  if (!res?.ok) throw new Error('the link did not decode');
  expect(res.workflow.suggestions.length).toBeGreaterThan(0);
  expect(res.workflow.suggestions).toEqual(payments.suggestions);
});

// Every character base64url writes is legal in a fragment, so nothing on the way
// to the browser percent-encodes the payload and nothing here has to undo that.
it('writes a payload a URL carries as-is', () => {
  const hash = link(JSON.stringify(payments));

  expect(graphPayload(hash)).toMatch(/^[A-Za-z0-9_-]+$/);
});

it('reads nothing into a URL that carries no graph', async () => {
  expect(graphPayload('')).toBeNull();
  expect(graphPayload('#')).toBeNull();
  expect(graphPayload('#about')).toBeNull();
  // near-misses, which are still not the prefix
  expect(graphPayload('#g')).toBeNull();
  expect(graphPayload('#graph=x')).toBeNull();

  expect(await decodeFragment('')).toBeNull();
  expect(await decodeFragment('#about')).toBeNull();
});

it('says so when the payload is not base64url at all', async () => {
  const res = await decodeFragment('#g=!!!! not base64 !!!!');

  expect(res?.ok).toBe(false);
  if (res?.ok !== false) throw new Error('a malformed payload decoded');
  expect(res.errors).toHaveLength(1);
  expect(res.errors[0]).toMatch(/^link: not valid base64url \(.+\)$/);
});

// Whether the parenthetical is there at all is the engine's business — node's
// gzip stream rejects with no message where a browser's has a sentence — but an
// empty pair of brackets is nobody's idea of a diagnostic.
it('says so when the payload is base64url but not a gzip stream', async () => {
  const plain = await decodeFragment(`#g=${payload(new TextEncoder().encode('{"meta":{}}'))}`);
  expect(plain?.ok).toBe(false);
  if (plain?.ok !== false) throw new Error('unzipped something that was never zipped');
  expect(plain.errors[0]).toMatch(/^link: not a gzipped graph( \(.+\))?$/);

  // A gzip stream that stops halfway — a link a chat client wrapped and a reader
  // copied one line of.
  const whole = gzipSync(JSON.stringify(payments), { level: 9 });
  const half = await decodeFragment(`#g=${payload(new Uint8Array(whole).slice(0, 25))}`);
  expect(half?.ok).toBe(false);
  if (half?.ok !== false) throw new Error('a truncated stream decoded');
  expect(half.errors[0]).toMatch(/^link: not a gzipped graph( \(.+\))?$/);
});

// 25 bytes is 34 base64url characters, which is two short of a whole quantum:
// what `toString('base64url')` writes carries no padding, and the decode restores
// it rather than reporting the encoder's own output as malformed.
it('takes an unpadded payload', async () => {
  const unpadded = payload(new Uint8Array(25).fill(7));

  expect(unpadded).toHaveLength(34);
  const res = await decodeFragment(`#g=${unpadded}`);
  expect(res?.ok).toBe(false);
  if (res?.ok !== false) throw new Error('random bytes decoded');
  expect(res.errors[0]).toMatch(/^link: not a gzipped graph/);
  // it got past the base64, which is the whole point of the padding
  expect(res.errors[0]).not.toMatch(/base64/);
  expect(res.errors[0]).not.toMatch(/\(\)$/);
});

// The bytes come from whoever wrote the link, and gzip does not declare what it
// becomes: a fragment small enough to mail can ask the page for hundreds of
// megabytes, three times over — unzipped, parsed, then walked by the validator.
// Built here rather than committed: a payload this size is one line of repeats.
it('refuses a link that unzips past the cap', async () => {
  const overCap = 'a'.repeat(MAX_DECODED_BYTES + 1024);
  const hash = link(overCap);
  // small enough that nothing between the writer and the page would blink at it
  expect(hash.length).toBeLessThan(4096);

  const res = await decodeFragment(hash);

  expect(res?.ok).toBe(false);
  if (res?.ok !== false) throw new Error('an oversized link decoded');
  expect(res.errors).toEqual(['link: unzips past 2MB, which no workflow graph does']);
});

// A real graph is thousands of times under the cap; the bound is not in its way.
it('opens a graph that is nowhere near the cap', async () => {
  expect(JSON.stringify(payments).length).toBeLessThan(MAX_DECODED_BYTES / 100);

  const res = await decodeFragment(link(JSON.stringify(payments)));

  expect(res?.ok).toBe(true);
});

it('says so when the zipped text is not JSON', async () => {
  const res = await decodeFragment(link('not json {{{'));

  expect(res?.ok).toBe(false);
  if (res?.ok !== false) throw new Error('parsed something that was not JSON');
  expect(res.errors).toHaveLength(1);
  expect(res.errors[0]).toMatch(/^link: not valid JSON \(.+\)$/);
});

// A link is not a way past the gate: what the loader refuses off disk it refuses
// out of a URL, in the loader's own words rather than in this module's.
it('hands a schema-breaking document to the loader and reports what it says', async () => {
  const res = await decodeFragment(link(JSON.stringify({ meta: {} })));

  expect(res?.ok).toBe(false);
  if (res?.ok !== false) throw new Error('an invalid document decoded');
  expect(res.errors.length).toBeGreaterThan(0);
  expect(res.errors.every((e) => e.startsWith('schema:') || e.startsWith('integrity:'))).toBe(true);
});

it('opens a document saved with a byte-order mark', async () => {
  const res = await decodeFragment(link(`${BOM}${JSON.stringify(payments)}`));

  expect(res?.ok).toBe(true);
  expect(withoutBom(`${BOM}{}`)).toBe('{}');
  expect(withoutBom('{}')).toBe('{}');
});

// The one failure that is about the browser rather than the link: it gets plain
// words and the other way in, because there is nothing the holder can fix.
it('tells a browser with no gzip decoder what to do instead', async () => {
  vi.stubGlobal('DecompressionStream', undefined);
  try {
    const res = await decodeFragment(link(JSON.stringify(payments)));

    expect(res?.ok).toBe(false);
    if (res?.ok !== false) throw new Error('decoded without a decompressor');
    expect(res.errors).toEqual([
      'link: this browser cannot unzip a shared graph — open the link in a current browser, or drop the workflow file onto this page',
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
