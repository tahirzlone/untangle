// kb-snapshot.mjs — mirror the public knowledge-base feed into kb/kb.json.
//
// This reads Tahir's own public feed (the same tier-2 endpoint the skill uses)
// and nothing else — there is no Airtable code here and none belongs here. The
// point of the file it writes is the skill's tier 2.5: a bundled snapshot that
// keeps suggestions working when the feed is unreachable.
//
// The serialization is deliberately stable — records sorted by id, `id` first
// then keys in byte order, 2-space indent, trailing newline — so a diff of
// kb/kb.json is a real change in the knowledge base, never an artifact of
// response ordering. `fetchedAt` (when this snapshot was taken, embedded so the
// skill's staleness note needs no git archaeology) would defeat that on its
// own, so the comparison is records-only: when the records match what is
// already on disk, nothing is written and the old `fetchedAt` stands — the
// snapshot's age IS the age of its content. (`updatedAt`, the feed's own
// refresh timestamp, churns even faster and is carried through on the same
// terms: written only when the records changed.)
//
// Any failure — non-200, timeout, malformed body, empty records, a bad id —
// exits non-zero with one clear line and writes nothing. A broken fetch must
// never clobber a good snapshot.

import { readFileSync, writeFileSync } from 'node:fs';

const FEED_URL = process.env.UNTANGLE_KB_URL ?? 'https://tahirlone.com/api/untangle/kb';
const OUT_PATH = new URL('../kb/kb.json', import.meta.url);
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

const fail = (message) => {
  throw new Error(message);
};

/** One record with `id` first and every other key in byte order. */
const normalizeRecord = (record) => {
  const out = { id: record.id };
  for (const key of Object.keys(record).sort()) {
    if (key !== 'id') out[key] = record[key];
  }
  return out;
};

const main = async () => {
  let response;
  try {
    response = await fetch(FEED_URL, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    fail(`could not reach ${FEED_URL} (${error?.cause?.code ?? error?.name ?? error})`);
  }
  if (!response.ok) fail(`${FEED_URL} answered HTTP ${response.status}, expected 200`);

  let feed;
  try {
    feed = await response.json();
  } catch {
    fail('the response body is not JSON');
  }
  if (!Array.isArray(feed?.records)) fail('the response carries no records array');
  if (feed.records.length === 0) fail('the feed returned zero records — refusing to write an empty snapshot');
  for (const record of feed.records) {
    if (typeof record?.id !== 'string' || !RECORD_ID.test(record.id)) {
      fail(`a record id does not match ^rec[A-Za-z0-9]{14}$: ${JSON.stringify(record?.id)}`);
    }
  }

  const records = feed.records
    .map(normalizeRecord)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let existing = null;
  try {
    existing = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  } catch {
    // No snapshot yet, or an unreadable one — either way this run writes fresh.
  }
  if (existing && JSON.stringify(existing.records) === JSON.stringify(records)) {
    return `unchanged — ${records.length} records, still the snapshot of ${existing.fetchedAt}`;
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    ...(typeof feed.updatedAt === 'string' ? { updatedAt: feed.updatedAt } : {}),
    recordCount: records.length,
    records,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  return `wrote ${records.length} records (fetchedAt ${snapshot.fetchedAt})`;
};

main().then(
  (message) => console.log(`kb-snapshot: ${message}`),
  (error) => {
    console.error(`kb-snapshot: FAILED — ${error.message}`);
    process.exitCode = 1;
  },
);
