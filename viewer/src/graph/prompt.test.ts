import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { fixture } from '../test/harness';
import { applySuggestion, createSession, jump, redo, undo } from './apply';
import { assemblePrompt } from './prompt';

/**
 * The v2 assembly contract, pinned string by string: the fragments are prose the
 * assembler passes through, and every install lives in the setup block at the
 * end, where a caller can tick one out without touching a sentence.
 *
 * The fixture carries both routes through the assembler: firecrawl-mcp and
 * chrome-devtools-mcp have authored fragments (firecrawl's is LEGACY — written
 * against v1, it still quotes its own install inside the prose), while the
 * replay plugin (no install at all) and the conventions skill fall back to the
 * template.
 */
const enriched = fixture(enrichedDoc, 'enriched');

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';
const REPLAY = 'recC9tS5uH1zXfM7e';
const CONVENTIONS = 'recE4wU7zJ3mVbL9d';

const fragmentOf = (id: string) =>
  enriched.suggestions.find((s) => s.airtableRecordId === id)!.promptFragment!;

/** The fixture's authored opening — V0's whole prompt. */
const INTRO = enriched.meta.promptIntro!;

const FIRECRAWL_INSTALL = 'claude mcp add firecrawl -- npx -y firecrawl-mcp';
const DEVTOOLS_INSTALL = 'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest';
const CONVENTIONS_INSTALL = '/plugin install codebase-conventions';

/** The setup block as the assembler writes it: the lead line, then one command a line. */
const setup = (...installs: string[]) =>
  [
    'Before you start, install what the steps above rely on:',
    ...installs.map((install) => `- \`${install}\``),
  ].join('\n');

/** The fallback template, exactly as the two fragment-less rows come out — no install in it. */
const CONVENTIONS_LINE =
  'Use codebase-conventions skill (Claude Skill) here: Writes new modules the way this ' +
  'codebase already wires them, so the separate scaffold-and-hook step folds into the ' +
  'coding loop.';
const REPLAY_LINE =
  'Use browser-verify plugin (Claude Plugin) here: Records the click-through once and ' +
  'replays it on every change, so the walk from the top happens without you.';

/** The fixture with some rows' `install` rewritten — the loader still vouches for it. */
const withInstalls = (edits: Record<string, string>, what: string) =>
  fixture(
    {
      ...enrichedDoc,
      suggestions: enrichedDoc.suggestions.map((s) =>
        s.airtableRecordId in edits ? { ...s, install: edits[s.airtableRecordId] } : s,
      ),
    },
    what,
  );

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

it('is the opening alone at V0 — a valid prompt before anything is applied', () => {
  expect(assemblePrompt(createSession(enriched))).toBe(INTRO);
});

it('opens with the task verbatim plus one templated sentence when there is no intro', () => {
  const bare: Record<string, unknown> = { ...enrichedDoc.meta };
  delete bare.promptIntro;
  const plain = fixture({ ...enrichedDoc, meta: bare }, 'no-intro');

  expect(assemblePrompt(createSession(plain))).toBe(
    'Ship a small feature end to end, from brief to release. Take it from start to finish.',
  );

  // a task that already ends its own sentence is not given a second full stop
  const punctuated = fixture(
    { ...enrichedDoc, meta: { ...bare, task: 'Ship the feature.' } },
    'punctuated',
  );
  expect(assemblePrompt(createSession(punctuated))).toBe(
    'Ship the feature. Take it from start to finish.',
  );
});

it('assembles intro, fragments in flow order, then every applied install in the setup block', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, FIRECRAWL);
  session = applySuggestion(session, DEVTOOLS);

  expect(assemblePrompt(session)).toBe(
    [
      INTRO,
      fragmentOf(FIRECRAWL),
      fragmentOf(DEVTOOLS),
      setup(FIRECRAWL_INSTALL, DEVTOOLS_INSTALL),
    ].join('\n\n'),
  );
});

/**
 * The legacy half of the contract, stated as a test so nobody "fixes" it in code.
 *
 * firecrawl's fragment was written against v1 and ends by quoting its own
 * install. v2 does not strip it: an assembler that edited authored prose would
 * be rewriting a sentence it did not write, around a string the user is about to
 * run. So the command is said twice on files like this one — and the setup block
 * still carries it, because the block is what the exclude toggle acts on and a
 * line missing from it is a resource that cannot be ticked. The fix is content.
 */
it('passes a legacy fragment through untouched and still lists the install it quotes', () => {
  const prompt = assemblePrompt(applySuggestion(createSession(enriched), FIRECRAWL));

  expect(prompt).toContain(fragmentOf(FIRECRAWL));
  expect(prompt).toContain(`Add it first with \`${FIRECRAWL_INSTALL}\`.`);
  expect(prompt).toBe([INTRO, fragmentOf(FIRECRAWL), setup(FIRECRAWL_INSTALL)].join('\n\n'));
  // twice, and deliberately: once as the author wrote it, once as a togglable line
  expect(occurrences(prompt, FIRECRAWL_INSTALL)).toBe(2);
});

// The fragments read as a sequence — "as soon as the brief is settled" before
// "once the feature builds" — so the order is the WORK's, not the click's, and
// the setup block below them follows the same order for the same reason.
it('emits fragments and installs in flow order even when applied back to front', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, DEVTOOLS);
  session = applySuggestion(session, FIRECRAWL);

  // identical to the in-order apply above: research-docs precedes verify-browser
  // in versions[0].nodes, whatever order the presses came in
  expect(assemblePrompt(session)).toBe(
    [
      INTRO,
      fragmentOf(FIRECRAWL),
      fragmentOf(DEVTOOLS),
      setup(FIRECRAWL_INSTALL, DEVTOOLS_INSTALL),
    ].join('\n\n'),
  );
});

it('templates a line with no install clause, and lists that install in the block instead', () => {
  // the replay plugin: no fragment AND no install — the template ends at the
  // claim, and there is no block for a row that carries no command
  let session = createSession(enriched);
  session = applySuggestion(session, REPLAY);
  expect(assemblePrompt(session)).toBe([INTRO, REPLAY_LINE].join('\n\n'));

  // the conventions skill: no fragment, but an install — the templated line says
  // nothing about installing, and the block below carries the command alone.
  // Applied second, emitted first: write-code precedes verify-browser in flow order.
  session = applySuggestion(session, CONVENTIONS);
  expect(assemblePrompt(session)).toBe(
    [INTRO, CONVENTIONS_LINE, REPLAY_LINE, setup(CONVENTIONS_INSTALL)].join('\n\n'),
  );
  expect(assemblePrompt(session)).not.toContain('Install:');
});

// The whole point of v2: one resource's command leaves, and not one word of the
// prose above moves with it.
it('drops exactly the excluded resource\'s line and nothing else', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, FIRECRAWL);
  session = applySuggestion(session, DEVTOOLS);
  const body = [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS)];

  expect(assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL]) })).toBe(
    [...body, setup(DEVTOOLS_INSTALL)].join('\n\n'),
  );
  expect(assemblePrompt(session, { excludeInstalls: new Set([DEVTOOLS]) })).toBe(
    [...body, setup(FIRECRAWL_INSTALL)].join('\n\n'),
  );

  // excluding a row does not reach into the prose it wrote: the legacy quote is
  // still there, because prose is the author's and the block is the assembler's
  expect(assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL]) })).toContain(
    `Add it first with \`${FIRECRAWL_INSTALL}\`.`,
  );

  // an id nobody applied excludes nothing — the set names rows, not wishes
  expect(assemblePrompt(session, { excludeInstalls: new Set([REPLAY]) })).toBe(
    assemblePrompt(session),
  );
});

it('writes no setup block at all once every install is excluded', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, FIRECRAWL);
  session = applySuggestion(session, DEVTOOLS);
  const body = [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS)].join('\n\n');

  expect(assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL, DEVTOOLS]) })).toBe(body);

  // and the two ways of asking for nothing to be excluded agree with each other
  const all = [
    INTRO,
    fragmentOf(FIRECRAWL),
    fragmentOf(DEVTOOLS),
    setup(FIRECRAWL_INSTALL, DEVTOOLS_INSTALL),
  ].join('\n\n');
  expect(assemblePrompt(session)).toBe(all);
  expect(assemblePrompt(session, {})).toBe(all);
  expect(assemblePrompt(session, { excludeInstalls: new Set() })).toBe(all);
});

/**
 * Two resources, one command: the same MCP suggested at two steps is one
 * `mcp add`, so it is one line — and the line belongs to the STRING, not to
 * whichever row reached it first. It survives while any includer is left
 * standing, and goes only when the last one is ticked out.
 */
it('says a shared install once, and keeps it while any includer remains', () => {
  const shared = withInstalls({ [DEVTOOLS]: FIRECRAWL_INSTALL }, 'shared-install');
  let session = createSession(shared);
  session = applySuggestion(session, FIRECRAWL);
  session = applySuggestion(session, DEVTOOLS);
  const body = [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS)];

  expect(assemblePrompt(session)).toBe([...body, setup(FIRECRAWL_INSTALL)].join('\n\n'));
  expect(assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL]) })).toBe(
    [...body, setup(FIRECRAWL_INSTALL)].join('\n\n'),
  );
  expect(assemblePrompt(session, { excludeInstalls: new Set([DEVTOOLS]) })).toBe(
    [...body, setup(FIRECRAWL_INSTALL)].join('\n\n'),
  );
  expect(assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL, DEVTOOLS]) })).toBe(
    body.join('\n\n'),
  );
});

// The same gate the paste block and the rows on screen are drawn through: a
// field holding nothing but spaces is not a command, and a line offering one
// would invite the reader to run a blank.
it('lists nothing for a row whose install holds no command', () => {
  const blank = withInstalls({ [REPLAY]: '   ' }, 'blank-install');
  const session = applySuggestion(createSession(blank), REPLAY);

  expect(assemblePrompt(session)).toBe([INTRO, REPLAY_LINE].join('\n\n'));
});

it('answers for wherever the cursor stands — undo, redo, and jump move the prompt', () => {
  const v0 = createSession(enriched);
  const v1 = applySuggestion(v0, DEVTOOLS);
  const v2 = applySuggestion(v1, FIRECRAWL);

  const AT_V0 = INTRO;
  const AT_V1 = [INTRO, fragmentOf(DEVTOOLS), setup(DEVTOOLS_INSTALL)].join('\n\n');
  const AT_V2 = [
    INTRO,
    fragmentOf(FIRECRAWL),
    fragmentOf(DEVTOOLS),
    setup(FIRECRAWL_INSTALL, DEVTOOLS_INSTALL),
  ].join('\n\n');

  expect(assemblePrompt(v0)).toBe(AT_V0);
  expect(assemblePrompt(v1)).toBe(AT_V1);
  expect(assemblePrompt(v2)).toBe(AT_V2);

  // stepping back re-assembles for the shorter prefix — nothing is cached
  const back = undo(v2);
  expect(assemblePrompt(back)).toBe(AT_V1);
  // and forward again, off the same history
  expect(assemblePrompt(redo(back))).toBe(AT_V2);
  // a jump straight home reads as a fresh session would
  expect(assemblePrompt(jump(v2, 0))).toBe(AT_V0);

  // an exclusion is per-call and holds nothing over from one version to the next:
  // the same set, asked twice, answers for the version it was asked about
  const exclude = { excludeInstalls: new Set([DEVTOOLS]) };
  expect(assemblePrompt(v1, exclude)).toBe([INTRO, fragmentOf(DEVTOOLS)].join('\n\n'));
  expect(assemblePrompt(v2, exclude)).toBe(
    [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS), setup(FIRECRAWL_INSTALL)].join('\n\n'),
  );
  expect(assemblePrompt(v2)).toBe(AT_V2);
});
