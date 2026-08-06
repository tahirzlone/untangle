import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession, type GraphSession } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import type { Suggestion } from '../graph/types';
import { fixture, mockClipboard } from '../test/harness';
import { ResultsWindow } from './ResultsWindow';

/**
 * The Results Window on its own: what the three sections state, what a tick
 * changes, and how the modal holds the keyboard. The wiring that opens it — the
 * post-optimize button, the PROMPT entry, the inert canvas — is driven through
 * GraphCanvas in Optimize.test.tsx and Prompt.test.tsx; the assembly the AFTER
 * pane shows is pinned string-by-string in graph/prompt.test.ts.
 */

const enriched = fixture(enrichedDoc, 'enriched');

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';
/** The plugin with no install at all: a page to follow, nothing to run. */
const REPLAY = 'recC9tS5uH1zXfM7e';
const CONVENTIONS = 'recE4wU7zJ3mVbL9d';

const FIRECRAWL_CMD = 'claude mcp add firecrawl -- npx -y firecrawl-mcp';
const DEVTOOLS_CMD = 'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest';

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

/** A session with these record ids applied, in this order, through the real reducer. */
function sessionWith(base = enriched, ...ids: string[]): GraphSession {
  return ids.reduce((s, id) => applySuggestion(s, id), createSession(base));
}

/**
 * The window under a host that owns the exclusions the way GraphCanvas does:
 * default nothing excluded, a row's members moving together. The window is a
 * controlled component, and the tests drive it the way its one caller does.
 */
function Host({ session, onClose = () => {} }: { session: GraphSession; onClose?: () => void }) {
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <ResultsWindow
      session={session}
      excludeInstalls={excluded}
      onToggleInstalls={(ids, include) =>
        setExcluded((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (include) next.delete(id);
            else next.add(id);
          }
          return next;
        })
      }
      onClose={onClose}
    />
  );
}

const afterText = () => screen.getByTestId('results-after').textContent;
const rowNames = () => screen.getAllByTestId('results-name').map((el) => el.textContent);
const boxes = () => screen.getAllByTestId('results-check');

/** Presses a copy and lets the clipboard's promise settle before anything is asked. */
async function copy(testId: string) {
  fireEvent.click(screen.getByTestId(testId));
  await act(async () => {});
}

// ---------------------------------------------------------------------------
// 1. The summary
// ---------------------------------------------------------------------------

it('states what changed, live off the session it is handed', () => {
  render(<Host session={sessionWith(enriched, FIRECRAWL, DEVTOOLS)} />);

  expect(screen.getByTestId('results-window')).toHaveTextContent('RESULTS — 2 upgrades applied');
  expect(screen.getAllByTestId('results-metric').map((el) => el.textContent)).toEqual([
    '−2 steps',
    '−65 min',
    '−9000 tok',
    '−4 manual',
  ]);
  expect(screen.getByTestId('results-count')).toHaveTextContent('6 → 6 nodes · 6 → 6 edges');
  expect(screen.getByTestId('results-pain')).toHaveTextContent('pain 18 → 12 (−33%)');
  expect(screen.queryByTestId('results-none')).not.toBeInTheDocument();
});

it('opens honestly at V0: empty summary, empty resource list, both panes anyway', () => {
  render(<Host session={createSession(enriched)} />);

  expect(screen.getByTestId('results-none')).toHaveTextContent('NO UPGRADES APPLIED YET');
  expect(screen.getByTestId('results-rows-none')).toHaveTextContent('NO RESOURCES APPLIED YET');
  // no figures for a session that has done nothing — a 6 → 6 line here would be
  // the template showing through
  expect(screen.queryByTestId('results-metric')).not.toBeInTheDocument();
  expect(screen.queryByTestId('results-count')).not.toBeInTheDocument();
  // no kit copy either: there is nothing it could ever hand over
  expect(screen.queryByTestId('results-kit-copy')).not.toBeInTheDocument();

  // the panes stand regardless: BEFORE is the user's ask verbatim, AFTER is the
  // intro-only prompt — nearly the same text, honestly so
  expect(screen.getByTestId('results-before').textContent).toBe(enriched.meta.task);
  expect(afterText()).toBe(enriched.meta.promptIntro);
});

// ---------------------------------------------------------------------------
// 2. The resource rows
// ---------------------------------------------------------------------------

it('lists each applied resource with chip, command, and a neutral include control', () => {
  render(<Host session={sessionWith(enriched, DEVTOOLS, FIRECRAWL)} />);

  // flow order, the order the prompt introduces them in — not the apply order
  expect(rowNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);
  expect(screen.getAllByTestId('results-cmd').map((el) => el.textContent)).toEqual([
    FIRECRAWL_CMD,
    DEVTOOLS_CMD,
  ]);
  const chips = screen.getAllByTestId('sg-sug-cat');
  expect(chips.map((el) => el.textContent)).toEqual(['MCP Server', 'MCP Server']);

  // every runnable row starts ticked, and the label claims exactly one thing —
  // no installed/needed language, nothing about the user's machine
  const rows = screen.getAllByTestId('results-row');
  for (const row of rows) {
    expect(within(row).getByLabelText(/^include install steps/)).toBeChecked();
    expect(within(row).getByText('include install steps')).toBeInTheDocument();
  }
  // consent is per-string: the box is described by the command it includes
  expect(screen.getByRole('checkbox', { name: /firecrawl-mcp/ })).toHaveAccessibleDescription(
    FIRECRAWL_CMD,
  );
});

it('shows a row with no command as a page to follow, and never as something to run', () => {
  render(<Host session={sessionWith(enriched, REPLAY)} />);

  const box = boxes()[0];
  expect(box).toBeDisabled();
  expect(box).not.toBeChecked();
  expect(screen.queryByTestId('results-cmd')).not.toBeInTheDocument();

  const link = screen.getByTestId('results-manual');
  expect(link).toHaveTextContent('no install command — follow its page');
  expect(link).toHaveAttribute('href', 'https://github.com/anthropics/claude-code');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(box).toHaveAccessibleDescription('no install command — follow its page');

  // nothing to hand over: the kit copy stands rather than vanishing, and claims nothing
  expect(screen.getByTestId('results-kit-copy')).toBeDisabled();
});

// The schema puts no floor under `install`: a field of spaces is not a command,
// and a row drawn ticked and runnable over one would contribute nothing but a
// blank line to everything the tick promises.
it('treats an install field with nothing in it as a row with no command', () => {
  const blank = withInstalls({ [REPLAY]: '   ' }, 'blank-install');
  render(<Host session={sessionWith(blank, REPLAY)} />);

  expect(boxes()[0]).toBeDisabled();
  expect(screen.queryByTestId('results-cmd')).not.toBeInTheDocument();
  expect(screen.getByTestId('results-manual')).toBeInTheDocument();
  expect(screen.queryByTestId('results-badge')).not.toBeInTheDocument();
});

// `/plugin install` is not a command any shell has. The badge says so on the
// row, before the kit says it again in a comment — and only on those rows.
// (devtools beside conventions, not firecrawl: firecrawl's patch wires an edge
// into the step the conventions patch removes, so the cascade forbids the pair.)
it('badges the rows that are typed inside Claude Code, and only those', () => {
  render(<Host session={sessionWith(enriched, DEVTOOLS, CONVENTIONS)} />);

  const badges = screen.getAllByTestId('results-badge');
  expect(badges).toHaveLength(1);
  expect(badges[0]).toHaveTextContent('TYPED INSIDE CLAUDE CODE');
  // read off the row it is inside, not off the order
  const conventionsRow = screen
    .getAllByTestId('results-row')
    .find((row) => row.textContent?.includes('codebase-conventions'))!;
  expect(conventionsRow).toContainElement(badges[0]);
});

/**
 * Task-1 requirement, pinned: rows sharing an identical install string collapse
 * into ONE checkbox row naming both resources — one command, one consent, one
 * line, exactly as SKILL.md's checklist rule words it.
 */
it('collapses rows sharing an install string into one row naming both resources', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const shared = withInstalls({ [DEVTOOLS]: FIRECRAWL_CMD }, 'shared-install');
    render(<Host session={sessionWith(shared, FIRECRAWL, DEVTOOLS)} />);

    // one row, both names on it, both category chips, ONE box and ONE command
    expect(rowNames()).toEqual(['firecrawl-mcp + chrome-devtools-mcp']);
    expect(boxes()).toHaveLength(1);
    expect(screen.getAllByTestId('results-cmd').map((el) => el.textContent)).toEqual([
      FIRECRAWL_CMD,
    ]);
    expect(screen.getAllByTestId('sg-sug-cat')).toHaveLength(2);

    // the one tick answers for the one line, in the prompt and the kit alike
    await copy('results-kit-copy');
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      `# Untangle install kit\n${FIRECRAWL_CMD}\n`,
    );

    fireEvent.click(boxes()[0]);
    expect(boxes()[0]).not.toBeChecked();
    const session = sessionWith(shared, FIRECRAWL, DEVTOOLS);
    expect(afterText()).toBe(
      assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL, DEVTOOLS]) }),
    );
    expect(afterText()).not.toContain('Before you start, install');
    expect(screen.getByTestId('results-kit-copy')).toBeDisabled();

    // and back in: the line returns to both surfaces together
    fireEvent.click(boxes()[0]);
    expect(boxes()[0]).toBeChecked();
    expect(afterText()).toBe(assemblePrompt(session));
  } finally {
    clip.restore();
  }
});

/**
 * Task-1 requirement, pinned: the multi-line treatment. The row shows every
 * physical line of the string (pre-wrap in the stylesheet), wears no badge, and
 * its command's ONE home is the kit's commented section — the AFTER pane's
 * setup block never lists it (graph/prompt.test.ts pins that side), and the
 * kit hands it over under the header that says the kit is not offering it.
 */
it('shows a multi-line install whole, badge-less, and hands it over commented', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const twoLine = withInstalls(
      { [CONVENTIONS]: '/plugin install codebase-conventions\nrm -rf x' },
      'two-line-install',
    );
    // devtools beside the two-line row — firecrawl's patch and conventions'
    // cannot coexist, see the badge test above
    render(<Host session={sessionWith(twoLine, DEVTOOLS, CONVENTIONS)} />);

    // textContent, not toHaveTextContent: the matcher normalizes whitespace,
    // which is precisely the thing under test
    const conventionsCmd = screen
      .getAllByTestId('results-cmd')
      .find((el) => el.textContent?.includes('rm -rf'))!;
    expect(conventionsCmd.textContent).toBe('/plugin install codebase-conventions\nrm -rf x');
    // no badge, however the string starts: the kit demotes it wholesale
    expect(screen.queryByTestId('results-badge')).not.toBeInTheDocument();

    // the declaration that keeps the two lines apart, read off the stylesheet
    // the way railHeight.test.ts reads its bounds
    const css = readFileSync('src/components/resultsWindow.css', 'utf8');
    expect(css).toMatch(/\.sg-results-cmd\s*\{[^}]*white-space:\s*pre-wrap/);

    // the AFTER pane lists the single-line neighbour and nothing of this string
    expect(afterText()).toContain(`- \`${DEVTOOLS_CMD}\``);
    expect(afterText()).not.toContain('rm -rf x');

    // the kit agrees with the row: both lines commented, neither bare
    await copy('results-kit-copy');
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Untangle install kit\n' +
        `${DEVTOOLS_CMD}\n` +
        '# more than one line — read it, then run it yourself:\n' +
        '#   /plugin install codebase-conventions\n' +
        '#   rm -rf x\n',
    );

    // its tick still governs the kit — unticked, the demoted section goes too
    const conventionsBox = screen.getByRole('checkbox', { name: /codebase-conventions/ });
    fireEvent.click(conventionsBox);
    await copy('results-kit-copy');
    expect(clip.writeText).toHaveBeenLastCalledWith(
      `# Untangle install kit\n${DEVTOOLS_CMD}\n`,
    );
  } finally {
    clip.restore();
  }
});

// ---------------------------------------------------------------------------
// The tick → the AFTER pane and the kit, instantly
// ---------------------------------------------------------------------------

it('drives the AFTER pane and the kit from the same tick, and restores both', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const session = sessionWith(enriched, FIRECRAWL, DEVTOOLS);
    render(<Host session={session} />);
    expect(afterText()).toBe(assemblePrompt(session));

    fireEvent.click(screen.getByRole('checkbox', { name: /firecrawl-mcp/ }));
    expect(afterText()).toBe(
      assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL]) }),
    );
    // exactly that line left; the excluded row's PROSE is not the toggle's to touch
    expect(afterText()).not.toContain(`- \`${FIRECRAWL_CMD}\``);
    expect(afterText()).toContain(`- \`${DEVTOOLS_CMD}\``);

    await copy('results-kit-copy');
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      `# Untangle install kit\n${DEVTOOLS_CMD}\n`,
    );

    // a tick restored is a command restored, in its own place in both texts
    fireEvent.click(screen.getByRole('checkbox', { name: /firecrawl-mcp/ }));
    expect(afterText()).toBe(assemblePrompt(session));
    await copy('results-kit-copy');
    expect(clip.writeText).toHaveBeenLastCalledWith(
      `# Untangle install kit\n${FIRECRAWL_CMD}\n${DEVTOOLS_CMD}\n`,
    );
  } finally {
    clip.restore();
  }
});

it('clears the setup block and stands the kit down once every row is unticked', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const session = sessionWith(enriched, FIRECRAWL, DEVTOOLS);
    render(<Host session={session} />);

    for (const box of boxes()) fireEvent.click(box);
    for (const box of boxes()) expect(box).not.toBeChecked();

    // the prompt keeps every word of prose and loses the whole setup block
    expect(afterText()).toBe(
      assemblePrompt(session, { excludeInstalls: new Set([FIRECRAWL, DEVTOOLS]) }),
    );
    expect(afterText()).not.toContain('Before you start, install');

    // and COPY INSTALL KIT is a control with nothing behind it: disabled, quiet
    const kitCopy = screen.getByTestId('results-kit-copy');
    expect(kitCopy).toBeDisabled();
    await copy('results-kit-copy');
    expect(clip.writeText).not.toHaveBeenCalled();
  } finally {
    clip.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. The panes and their copies
// ---------------------------------------------------------------------------

it('copies each pane its own text — the ask and the assembly', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const session = sessionWith(enriched, FIRECRAWL);
    render(<Host session={session} />);

    await copy('results-before-copy');
    expect(clip.writeText).toHaveBeenLastCalledWith(enriched.meta.task);

    await copy('results-after-copy');
    expect(clip.writeText).toHaveBeenLastCalledWith(assemblePrompt(session));

    // the panes are prose to take away: focusable, scrollable regions
    expect(screen.getByTestId('results-before')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('results-after')).toHaveAttribute('tabindex', '0');
  } finally {
    clip.restore();
  }
});

// ---------------------------------------------------------------------------
// The modal grammar
// ---------------------------------------------------------------------------

it('keeps Tab inside the window, both ways round', () => {
  render(<Host session={sessionWith(enriched, FIRECRAWL)} />);

  const close = screen.getByTestId('results-close');
  const lastPane = screen.getByTestId('results-after');
  // focus arrives with the window, on the way out
  expect(document.activeElement).toBe(close);

  // CLOSE is the first stop, so Shift+Tab comes round to the last — the AFTER pane
  const back = createEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  fireEvent(close, back);
  expect(back.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(lastPane);

  // and Tab off the last stop comes round to the first
  const forward = createEvent.keyDown(lastPane, { key: 'Tab' });
  fireEvent(lastPane, forward);
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(close);
});

it('closes on Escape and on the backdrop, and not on its own body', () => {
  const onClose = vi.fn();
  render(<Host session={sessionWith(enriched, FIRECRAWL)} onClose={onClose} />);

  fireEvent.click(screen.getByTestId('results-window'));
  expect(onClose).not.toHaveBeenCalled();

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);

  // a plain backdrop press: down and up both on the backdrop itself — the
  // pointer pair a real click always arrives as
  const backdrop = screen.getByTestId('results-backdrop');
  fireEvent.pointerDown(backdrop);
  fireEvent.pointerUp(backdrop);
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(2);

  // dialog semantics carried the same way the scorecard carried them
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAccessibleName(/RESULTS/);
});

/**
 * The panes are text to take, and taking text is a drag — one that routinely
 * overshoots the window's edge (the AFTER pane sits ~25px from it). The
 * release then lands on the backdrop, and the browser dispatches the CLICK on
 * the two targets' common ancestor — the backdrop — where no stopPropagation
 * of the panel's can reach it. A bare onClick there closed the window and
 * destroyed the selection. Closing therefore requires the press AND the
 * release to have both originated on the backdrop itself.
 */
it('keeps the window when a selection drag overshoots onto the backdrop', () => {
  const onClose = vi.fn();
  render(<Host session={sessionWith(enriched, FIRECRAWL)} onClose={onClose} />);
  const backdrop = screen.getByTestId('results-backdrop');
  const pane = screen.getByTestId('results-after');

  // the overshoot, as the browser dispatches it: press in the pane, release on
  // the backdrop, click synthesized on their common ancestor
  fireEvent.pointerDown(pane);
  fireEvent.pointerUp(backdrop);
  fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();

  // the reverse overshoot — press on the backdrop, release in the pane — is a
  // gesture that touched the window too, and keeps it for the same reason
  fireEvent.pointerDown(backdrop);
  fireEvent.pointerUp(pane);
  fireEvent.click(backdrop);
  expect(onClose).not.toHaveBeenCalled();

  // and the way out still works: both ends on the backdrop
  fireEvent.pointerDown(backdrop);
  fireEvent.pointerUp(backdrop);
  fireEvent.click(backdrop);
  expect(onClose).toHaveBeenCalledTimes(1);
});

// The window arrives quietly when motion is not wanted: the entrance animations
// stand down in the stylesheet, the same contract every overlay here keeps.
it('stands its entrance down under reduced motion', () => {
  const css = readFileSync('src/components/resultsWindow.css', 'utf8');
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sg-results \{ animation: none; \}/,
  );
});
