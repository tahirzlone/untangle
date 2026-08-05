import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import type { Suggestion } from '../graph/types';
import { fixture, mockClipboard } from '../test/harness';
import { InstallKit } from './InstallKit';

/**
 * The kit as a control surface: what the rows say, what a tick means, and what
 * comes out of COPY when the ticks have been moved. The block's own format is
 * pinned string-by-string in graph/installKit.test.ts — what is under test here
 * is that the surface and the block agree about every row.
 */

const enriched = fixture(enrichedDoc, 'enriched');

const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';
/** The plugin with no install at all: a page to follow, nothing to run. */
const REPLAY = 'recC9tS5uH1zXfM7e';
const SCAFFOLD = 'recD2vT6yG4kQnP8s';
const CONVENTIONS = 'recE4wU7zJ3mVbL9d';

const sug = (id: string): Suggestion => enriched.suggestions.find((s) => s.airtableRecordId === id)!;

const FIRECRAWL_CMD = 'claude mcp add firecrawl -- npx -y firecrawl-mcp';
const DEVTOOLS_CMD = 'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest';

const boxes = () => screen.getAllByTestId('kit-check');
const rowNames = () => screen.getAllByTestId('kit-row').map((el) => el.querySelector('label')?.textContent);

/** Presses COPY and lets the clipboard's promise settle before anything is asked. */
async function copy() {
  fireEvent.click(screen.getByTestId('kit-copy'));
  await act(async () => {});
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

it('lists the rows in the order it was handed them, each with its command shown', () => {
  render(<InstallKit rows={[sug(FIRECRAWL), sug(CONVENTIONS), sug(DEVTOOLS)]} />);

  // flow order in, flow order out: the panel above introduces them in this order
  // and a reader checking one against the other is reading one list twice
  expect(rowNames()).toEqual([
    'firecrawl-mcp',
    'codebase-conventions skill',
    'chrome-devtools-mcp',
  ]);

  // consent is per-string, so the string is on screen — and it is what the box
  // is described by, not just what sits near it
  const cmds = screen.getAllByTestId('kit-cmd');
  expect(cmds.map((c) => c.textContent)).toEqual([
    FIRECRAWL_CMD,
    '/plugin install codebase-conventions',
    DEVTOOLS_CMD,
  ]);
  const box = screen.getByLabelText('firecrawl-mcp');
  expect(box).toBeChecked();
  expect(box).toHaveAccessibleDescription(FIRECRAWL_CMD);
});

// `/plugin install` is not a command any shell has. The badge says so on the row,
// before the block says it again in a comment.
it('badges the rows that are typed inside Claude Code, and only those', () => {
  render(<InstallKit rows={[sug(FIRECRAWL), sug(CONVENTIONS)]} />);

  const badges = screen.getAllByTestId('kit-badge');
  expect(badges).toHaveLength(1);
  expect(badges[0]).toHaveTextContent('TYPED INSIDE CLAUDE CODE');
  // the badged row is the slash one — read off the row it is inside, not off the order
  expect(screen.getAllByTestId('kit-row')[1]).toContainElement(badges[0]);
});

it('shows a row with no command as a page to follow, and never as something to run', () => {
  render(<InstallKit rows={[sug(REPLAY)]} />);

  const box = boxes()[0];
  expect(box).toBeDisabled();
  expect(box).not.toBeChecked();
  expect(screen.queryByTestId('kit-cmd')).not.toBeInTheDocument();

  // a real link to the resource's own page, and the explanation the dead box
  // points at — one Tab away from it rather than nowhere
  const link = screen.getByTestId('kit-manual');
  expect(link).toHaveTextContent('no install command — follow its page');
  expect(link).toHaveAttribute('href', sug(REPLAY).url);
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(box).toHaveAccessibleDescription('no install command — follow its page');

  // nothing to hand over: the kit is here to be SEEN, but COPY claims nothing
  expect(screen.getByTestId('kit-copy')).toBeDisabled();
});

// The schema puts no floor under `install`, so a generation can hand over a field
// with nothing in it. Gated on the trimmed string and not on the field, or the row
// would be drawn ticked and runnable while contributing nothing to the block —
// and `installKind('')` would badge it as a shell command besides.
it('treats an install field with nothing in it as a row with no command', () => {
  const blank: Suggestion = { ...sug(REPLAY), install: '   ' };
  render(<InstallKit rows={[blank, sug(FIRECRAWL)]} />);

  expect(boxes()[0]).toBeDisabled();
  expect(boxes()[0]).not.toBeChecked();
  expect(screen.queryByTestId('kit-badge')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('kit-cmd')).toHaveLength(1);
  expect(screen.getByTestId('kit-manual')).toBeInTheDocument();
});

// The install text is remote content, and consent here is per-string: what the row
// shows has to be the whole of what the block carries. A newline drawn as a space
// would show one innocuous command over a string that is two — the row vouching
// for a line it never displayed.
it('shows every line of a command that carries a line break, and hands it over commented', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const smuggled: Suggestion = { ...sug(CONVENTIONS), install: '/plugin install a\nrm -rf x' };
    render(<InstallKit rows={[smuggled]} />);

    // textContent, not toHaveTextContent: the matcher normalizes whitespace, which
    // is precisely the thing under test
    expect(screen.getByTestId('kit-cmd').textContent).toBe('/plugin install a\nrm -rf x');

    // jsdom lays nothing out and vitest never loads the CSS, so the declaration
    // that keeps the two lines apart is read off the stylesheet — the same way
    // railHeight.test.ts reads the bounds it pins
    const css = readFileSync('src/components/installKit.css', 'utf8');
    expect(css).toMatch(/\.sg-kit-cmd\s*\{[^}]*white-space:\s*pre-wrap/);

    // and the tick's block agrees with the row: both lines commented, neither bare
    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Flowprint install kit\n' +
        '# more than one line — read it, then run it yourself:\n' +
        '#   /plugin install a\n' +
        '#   rm -rf x\n',
    );
  } finally {
    clip.restore();
  }
});

it('says so when there is nothing in the kit at all, and offers no copy', () => {
  render(<InstallKit rows={[]} />);

  expect(screen.getByTestId('kit-none')).toHaveTextContent('NOTHING TO INSTALL');
  expect(screen.queryByTestId('kit-list')).not.toBeInTheDocument();
  // a disabled COPY beside an empty list would be a control standing in for a sentence
  expect(screen.queryByTestId('kit-copy')).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// What COPY hands over
// ---------------------------------------------------------------------------

it('copies the whole kit while every row is still ticked', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<InstallKit rows={[sug(FIRECRAWL), sug(CONVENTIONS), sug(DEVTOOLS)]} />);
    await copy();

    // the runnable half first and bare, the typed half commented under its line —
    // the rows are in flow order, the BLOCK is in paste order
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Flowprint install kit\n' +
        `${FIRECRAWL_CMD}\n` +
        `${DEVTOOLS_CMD}\n` +
        '# inside Claude Code, type:\n' +
        '#   /plugin install codebase-conventions\n',
    );
    expect(screen.getByTestId('kit-copy')).toHaveTextContent('COPIED');
  } finally {
    clip.restore();
  }
});

it('drops a cleared row out of the block and leaves the rest of it alone', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<InstallKit rows={[sug(FIRECRAWL), sug(DEVTOOLS)]} />);

    fireEvent.click(screen.getByLabelText('firecrawl-mcp'));
    expect(screen.getByLabelText('firecrawl-mcp')).not.toBeChecked();
    expect(screen.getByLabelText('chrome-devtools-mcp')).toBeChecked();

    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      `# Flowprint install kit\n${DEVTOOLS_CMD}\n`,
    );

    // and back: a tick restored is a command restored, in its own place
    fireEvent.click(screen.getByLabelText('firecrawl-mcp'));
    await copy();
    expect(clip.writeText).toHaveBeenLastCalledWith(
      `# Flowprint install kit\n${FIRECRAWL_CMD}\n${DEVTOOLS_CMD}\n`,
    );
  } finally {
    clip.restore();
  }
});

// Nothing ticked is nothing to paste, and a COPIED over an empty string would be
// the button claiming a paste that pastes nothing.
it('stands COPY down once every row has been cleared', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<InstallKit rows={[sug(FIRECRAWL), sug(CONVENTIONS)]} />);
    for (const box of boxes()) fireEvent.click(box);

    const button = screen.getByTestId('kit-copy');
    expect(button).toBeDisabled();
    await copy();
    expect(clip.writeText).not.toHaveBeenCalled();
    expect(button).toHaveTextContent('COPY');

    // one row back is a block again
    fireEvent.click(boxes()[1]);
    expect(button).toBeEnabled();
    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Flowprint install kit\n' +
        '# inside Claude Code, type:\n' +
        '#   /plugin install codebase-conventions\n',
    );
  } finally {
    clip.restore();
  }
});

// Nothing a shell can run: the block is the header and the instruction, and every
// line under it is commented — a bare `/plugin install` would fail on paste.
it('copies an all-slash selection as commented lines under one header', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<InstallKit rows={[sug(SCAFFOLD), sug(CONVENTIONS)]} />);
    expect(screen.getAllByTestId('kit-badge')).toHaveLength(2);

    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      '# Flowprint install kit\n' +
        '# inside Claude Code, type:\n' +
        '#   /plugin install scaffold-module\n' +
        '#   /plugin install codebase-conventions\n',
    );
  } finally {
    clip.restore();
  }
});

// The same server suggested at two steps is one `claude mcp add`, and the block
// has always said so — two boxes over one line would leave one of them looking
// broken the moment it was cleared and the command stayed.
it('lists one row per command, however many steps asked for it', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    const alsoFirecrawl: Suggestion = { ...sug(FIRECRAWL), airtableRecordId: 'recDup', nodeId: 'write-code' };
    render(<InstallKit rows={[sug(FIRECRAWL), alsoFirecrawl, sug(DEVTOOLS)]} />);

    expect(rowNames()).toEqual(['firecrawl-mcp', 'chrome-devtools-mcp']);

    // and the one box answers for the one line: clearing it empties that half
    fireEvent.click(screen.getByLabelText('firecrawl-mcp'));
    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      `# Flowprint install kit\n${DEVTOOLS_CMD}\n`,
    );
  } finally {
    clip.restore();
  }
});

// A link-only row is not a row that was cleared: there is no command for a tick to
// put in the block, so it is never counted in one.
it('leaves the link-only rows out of the block while still listing them', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  try {
    render(<InstallKit rows={[sug(REPLAY), sug(DEVTOOLS)]} />);
    expect(screen.getAllByTestId('kit-row')).toHaveLength(2);

    await copy();
    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(
      `# Flowprint install kit\n${DEVTOOLS_CMD}\n`,
    );
  } finally {
    clip.restore();
  }
});
