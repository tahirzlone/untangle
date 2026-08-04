import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { fixture } from '../test/harness';
import { applySuggestion, createSession, jump, redo, undo } from './apply';
import { assemblePrompt } from './prompt';

/**
 * The fixture carries both routes through the assembler: firecrawl-mcp and
 * chrome-devtools-mcp have authored fragments (firecrawl's quotes its install,
 * devtools' deliberately does not), while the replay plugin (no install at all)
 * and the conventions skill fall back to the template.
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

/**
 * The closing line for a session where only chrome-devtools' install went
 * unmentioned: firecrawl's fragment quotes its own verbatim, so repeating it
 * here would read as two tools where there is one.
 */
const CLOSING =
  'Before you start, install what the steps above rely on: ' +
  '`claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest`.';

/** The fallback template, exactly as the two fragment-less rows come out. */
const CONVENTIONS_LINE =
  'Use codebase-conventions skill (Claude Skill) here: Writes new modules the way this ' +
  'codebase already wires them, so the separate scaffold-and-hook step folds into the ' +
  'coding loop. Install: /plugin install codebase-conventions';
const REPLAY_LINE =
  'Use browser-verify plugin (Claude Plugin) here: Records the click-through once and ' +
  'replays it on every change, so the walk from the top happens without you.';

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

it('assembles intro, fragments in flow order, and the installs no fragment mentioned', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, FIRECRAWL);
  session = applySuggestion(session, DEVTOOLS);

  expect(assemblePrompt(session)).toBe(
    [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS), CLOSING].join('\n\n'),
  );
});

// The fragments read as a sequence — "as soon as the brief is settled" before
// "once the feature builds" — so the order is the WORK's, not the click's.
it('emits fragments in flow order even when applied back to front', () => {
  let session = createSession(enriched);
  session = applySuggestion(session, DEVTOOLS);
  session = applySuggestion(session, FIRECRAWL);

  // identical to the in-order apply above: research-docs precedes verify-browser
  // in versions[0].nodes, whatever order the presses came in
  expect(assemblePrompt(session)).toBe(
    [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS), CLOSING].join('\n\n'),
  );
});

it('templates a line for a suggestion with no fragment, dropping the Install clause with the install', () => {
  // the replay plugin: no fragment AND no install — the template ends at the claim
  let session = createSession(enriched);
  session = applySuggestion(session, REPLAY);
  expect(assemblePrompt(session)).toBe([INTRO, REPLAY_LINE].join('\n\n'));

  // the conventions skill: no fragment, but an install — templated into the line,
  // which is why no closing line repeats it. Applied second, emitted first:
  // write-code precedes verify-browser in flow order.
  session = applySuggestion(session, CONVENTIONS);
  expect(assemblePrompt(session)).toBe([INTRO, CONVENTIONS_LINE, REPLAY_LINE].join('\n\n'));
});

it('answers for wherever the cursor stands — undo, redo, and jump move the prompt', () => {
  const v0 = createSession(enriched);
  const v1 = applySuggestion(v0, DEVTOOLS);
  const v2 = applySuggestion(v1, FIRECRAWL);

  const AT_V0 = INTRO;
  const AT_V1 = [INTRO, fragmentOf(DEVTOOLS), CLOSING].join('\n\n');
  const AT_V2 = [INTRO, fragmentOf(FIRECRAWL), fragmentOf(DEVTOOLS), CLOSING].join('\n\n');

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
});
