import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { fixture } from '../test/harness';
import { applySuggestion, createSession, undo } from './apply';
import { buildInstallBlock, hasInstall, installKind } from './installKit';
import { appliedInFlowOrder } from './prompt';
import type { Suggestion } from './types';

/**
 * The fixture carries one row of every kind the kit has to answer for: two MCP
 * servers whose installs are shell commands, a skill whose install is typed
 * inside Claude Code, and a plugin with no install at all.
 */
const enriched = fixture(enrichedDoc, 'enriched');

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';
const REPLAY = 'recC9tS5uH1zXfM7e';
const SCAFFOLD = 'recD2vT6yG4kQnP8s';
const CONVENTIONS = 'recE4wU7zJ3mVbL9d';

const sug = (id: string): Suggestion =>
  enriched.suggestions.find((s) => s.airtableRecordId === id)!;

// ---------------------------------------------------------------------------
// Which half of the block a command belongs in
// ---------------------------------------------------------------------------

it('reads a leading slash as typed inside Claude Code, and everything else as a shell command', () => {
  expect(installKind('/plugin install codebase-conventions')).toBe('slash');
  expect(installKind('claude mcp add firecrawl -- npx -y firecrawl-mcp')).toBe('shell');
  expect(installKind('npx -y some-server@latest')).toBe('shell');

  // off the string, not off the row: the skill's install is the slash one and
  // the MCP server's is the shell one, and neither category was consulted
  expect(installKind(sug(CONVENTIONS).install!)).toBe('slash');
  expect(installKind(sug(FIRECRAWL).install!)).toBe('shell');
});

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

it('writes shell commands bare under the kit header, in the order it was handed them', () => {
  expect(buildInstallBlock([sug(DEVTOOLS), sug(FIRECRAWL)])).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n' +
      'claude mcp add firecrawl -- npx -y firecrawl-mcp\n',
  );
});

// No shell line to run, so the kit is the header and the instruction — never a
// bare `/plugin install`, which is not a command any shell has.
it('comments the Claude Code commands under one line saying where they are typed', () => {
  expect(buildInstallBlock([sug(CONVENTIONS)])).toBe(
    '# Flowprint install kit\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install codebase-conventions\n',
  );
});

// One header over the section, however many commands stand under it: a second
// "inside Claude Code, type:" between two of them would read as two places to
// type, and there is only one.
it('gathers every Claude Code command under a single instruction line', () => {
  expect(buildInstallBlock([sug(SCAFFOLD), sug(CONVENTIONS)])).toBe(
    '# Flowprint install kit\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install scaffold-module\n' +
      '#   /plugin install codebase-conventions\n',
  );
});

it('puts the runnable half first, whatever order the selection arrived in', () => {
  expect(buildInstallBlock([sug(CONVENTIONS), sug(DEVTOOLS)])).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install codebase-conventions\n',
  );
});

// The same MCP suggested at two steps is still one `claude mcp add`, and a
// second one would read as a second server.
it('lists a command once, however many steps suggested it', () => {
  const alsoFirecrawl: Suggestion = { ...sug(FIRECRAWL), nodeId: 'write-code' };
  const alsoConventions: Suggestion = { ...sug(CONVENTIONS), nodeId: 'scaffold-repo' };

  expect(
    buildInstallBlock([sug(FIRECRAWL), alsoFirecrawl, sug(CONVENTIONS), alsoConventions]),
  ).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add firecrawl -- npx -y firecrawl-mcp\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install codebase-conventions\n',
  );
});

it('writes nothing at all for a selection with no command in it', () => {
  expect(buildInstallBlock([])).toBe('');
  // the replay plugin is link-only: a page to follow, nothing to run
  expect(buildInstallBlock([sug(REPLAY)])).toBe('');
});

it('skips the rows with no install rather than refusing the selection they are in', () => {
  expect(buildInstallBlock([sug(REPLAY), sug(DEVTOOLS)])).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n',
  );
});

// The schema puts no floor under `install`, so a generation can hand over a
// field with nothing in it. A blank line in a block the user is invited to
// paste and trust is worse than no line.
it('treats an install field with nothing in it as no command at all', () => {
  const blank: Suggestion = { ...sug(REPLAY), install: '   ' };

  expect(buildInstallBlock([blank])).toBe('');
  expect(buildInstallBlock([blank, sug(CONVENTIONS)])).toBe(
    '# Flowprint install kit\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install codebase-conventions\n',
  );
});

// ---------------------------------------------------------------------------
// The gate the block and the rows on screen both stand behind
// ---------------------------------------------------------------------------

// The surface that lists the kit decides row by row which suggestions are
// runnable and which are a page to follow. It asks THIS, so a row drawn as
// runnable is a row whose command reaches the block — and a row drawn as a link
// is one the block was always going to skip.
it('answers which rows have a command in them, and answers it the way the block does', () => {
  expect(hasInstall(sug(FIRECRAWL))).toBe(true);
  expect(hasInstall(sug(CONVENTIONS))).toBe(true);
  // no install field at all
  expect(hasInstall(sug(REPLAY))).toBe(false);
  // a field with nothing in it is no command, however much whitespace it holds
  expect(hasInstall({ ...sug(REPLAY), install: '   ' })).toBe(false);
  expect(hasInstall({ ...sug(REPLAY), install: '' })).toBe(false);

  // and the agreement itself: what the predicate refuses, the block writes
  // nothing for — while everything it accepts arrives verbatim
  for (const row of [sug(REPLAY), { ...sug(REPLAY), install: '  ' }]) {
    expect(buildInstallBlock([row])).toBe('');
  }
  for (const row of [sug(FIRECRAWL), sug(CONVENTIONS)]) {
    expect(buildInstallBlock([row])).toContain(row.install!);
  }
});

// ---------------------------------------------------------------------------
// The applied set, in the order the work runs it
// ---------------------------------------------------------------------------

it('names the applied suggestions in flow order, not in the order they were pressed', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, DEVTOOLS);
  session = applySuggestion(session, CONVENTIONS);

  // write-code precedes verify-browser in versions[0].nodes, whichever was pressed first
  expect(appliedInFlowOrder(session).map((s) => s.name)).toEqual([
    'codebase-conventions skill',
    'chrome-devtools-mcp',
  ]);
  // nothing applied is nothing to name — not the whole suggestion list
  expect(appliedInFlowOrder(createSession(enriched))).toEqual([]);
});

it('builds a session kit off the applied set, and follows the cursor back out of it', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, DEVTOOLS);
  session = applySuggestion(session, CONVENTIONS);

  expect(buildInstallBlock(appliedInFlowOrder(session))).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n' +
      '# inside Claude Code, type:\n' +
      '#   /plugin install codebase-conventions\n',
  );

  // undo takes the conventions skill out of the kit with it — and the section
  // it was the only line of goes too
  expect(buildInstallBlock(appliedInFlowOrder(undo(session)))).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n',
  );
  // at V0 nothing has been applied, so there is nothing to install
  expect(buildInstallBlock(appliedInFlowOrder(undo(undo(session))))).toBe('');
});

// Two shell installs, applied back to front: the block reads in the order the
// work runs them, because that is the order the kit was handed.
it('keeps flow order inside a class, not the order of the presses', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, DEVTOOLS);
  session = applySuggestion(session, FIRECRAWL);

  expect(buildInstallBlock(appliedInFlowOrder(session))).toBe(
    '# Flowprint install kit\n' +
      'claude mcp add firecrawl -- npx -y firecrawl-mcp\n' +
      'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest\n',
  );
});
