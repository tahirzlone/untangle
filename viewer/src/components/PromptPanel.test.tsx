import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession, undo } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import { fixture, mockClipboard } from '../test/harness';
import { COPIED_MS } from './CopyButton';
import { PromptPanel } from './PromptPanel';

const enriched = fixture(enrichedDoc, 'enriched');
const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';
const DEVTOOLS = 'recB3nR8vY6wJdK2q';

const fresh = () => createSession(enriched);
const oneApplied = () => applySuggestion(fresh(), FIRECRAWL);

it('shows the assembled prompt for the session it is handed', () => {
  const session = oneApplied();
  render(<PromptPanel session={session} />);

  const block = screen.getByTestId('prompt-text');
  expect(block.textContent).toBe(assemblePrompt(session));
  // prose to take away: the block is a focusable, scrollable region
  expect(block).toHaveAttribute('tabindex', '0');
});

it('labels the opening-alone state instead of hiding it', () => {
  const { rerender } = render(<PromptPanel session={fresh()} />);

  // V0 is still a valid prompt — the intro — and it is SHOWN, with the label
  expect(screen.getByTestId('prompt-none')).toHaveTextContent('NO UPGRADES APPLIED YET');
  expect(screen.getByTestId('prompt-text').textContent).toBe(enriched.meta.promptIntro);

  rerender(<PromptPanel session={oneApplied()} />);
  expect(screen.queryByTestId('prompt-none')).not.toBeInTheDocument();
});

// The kit is a section of THIS panel, so it inherits the panel's rules for free:
// off with the PROMPT toggle, out of sight with the rail while the wipe is open.
it('holds the install kit under the prompt, once something has been applied', () => {
  const { rerender } = render(<PromptPanel session={fresh()} />);
  // nothing applied is nothing to install, and NO UPGRADES APPLIED YET already
  // says why the prompt is short — a second empty state would say it twice
  expect(screen.queryByTestId('install-kit')).not.toBeInTheDocument();

  rerender(<PromptPanel session={oneApplied()} />);
  expect(screen.getByTestId('prompt-panel')).toContainElement(screen.getByTestId('install-kit'));
  expect(screen.getByTestId('kit-cmd')).toHaveTextContent(
    'claude mcp add firecrawl -- npx -y firecrawl-mcp',
  );
});

// A tick is consent to install one command as part of one version's kit. The row
// set moved, so the consent given about the old one does not come along.
it('starts the ticks again when the version cursor moves', () => {
  const two = applySuggestion(oneApplied(), DEVTOOLS);
  const { rerender } = render(<PromptPanel session={two} />);
  const boxes = () => screen.getAllByTestId('kit-check');

  expect(boxes()).toHaveLength(2);
  for (const box of boxes()) fireEvent.click(box);
  for (const box of boxes()) expect(box).not.toBeChecked();
  expect(screen.getByTestId('kit-copy')).toBeDisabled();

  // undo is a different version standing on a different row set
  rerender(<PromptPanel session={undo(two)} />);
  expect(boxes()).toHaveLength(1);
  expect(boxes()[0]).toBeChecked();
  expect(screen.getByTestId('kit-copy')).toBeEnabled();
});

it('copies the prompt, flashes COPIED, and goes back to offering', async () => {
  const clip = mockClipboard(() => Promise.resolve());
  vi.useFakeTimers();
  try {
    const session = oneApplied();
    render(<PromptPanel session={session} />);
    const button = screen.getByTestId('prompt-copy');
    expect(button).toHaveTextContent('COPY');

    fireEvent.click(button);
    // the label only swaps once the write RESOLVED — flush that microtask
    await act(async () => {});

    expect(clip.writeText).toHaveBeenCalledExactlyOnceWith(assemblePrompt(session));
    expect(button).toHaveTextContent('COPIED');
    expect(button.className).toContain('sg-copy-btn--copied');

    // and the moment passes on its own
    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(button).toHaveTextContent('COPY');
    expect(button.className).not.toContain('sg-copy-btn--copied');
  } finally {
    vi.useRealTimers();
    clip.restore();
  }
});

/**
 * And the accent the flash is made of actually reaches the screen.
 *
 * `.sg-ghost-btn` in canvas.css states `color` and `border-color` at the same
 * specificity as a single-class copy rule, and it is emitted after this
 * stylesheet — so the one-class version lost the tie and COPIED rendered in
 * `--dim`, the earned colour never once painting. jsdom computes no cascade and
 * vitest loads no CSS, so what is pinned here is the shape of the fix: the rule
 * carries BOTH classes and outranks the ghost button wherever either sheet lands.
 */
it('writes the COPIED accent at a specificity the ghost button cannot outrank', () => {
  const css = readFileSync('src/components/copyButton.css', 'utf8');
  const accent = css.match(/\.sg-ghost-btn\.sg-copy-btn--copied\s*\{([^}]*)\}/);
  expect(accent).not.toBeNull();
  expect(accent![1]).toMatch(/color:\s*var\(--accent\)/);
  expect(accent![1]).toMatch(/border-color:\s*var\(--accent\)/);
  // the flash stays on the single class, which is what the reduced-motion rule
  // is written against — moving it up would put the stand-down out of reach
  expect(css).toMatch(/\n\.sg-copy-btn--copied\s*\{[^}]*animation:\s*sg-copy-flash/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
});

// The clipboard API is permission-gated and absent entirely off HTTPS. A press
// with nothing behind it does nothing — and above all claims nothing.
it('is a quiet no-op when there is no clipboard at all', async () => {
  expect(navigator.clipboard).toBeUndefined();
  render(<PromptPanel session={oneApplied()} />);

  fireEvent.click(screen.getByTestId('prompt-copy'));
  await act(async () => {});

  expect(screen.getByTestId('prompt-copy')).toHaveTextContent('COPY');
  expect(screen.getByTestId('prompt-copy')).not.toHaveTextContent('COPIED');
});

it('claims nothing when the clipboard refuses the write', async () => {
  const clip = mockClipboard(() => Promise.reject(new Error('denied')));
  try {
    render(<PromptPanel session={oneApplied()} />);
    fireEvent.click(screen.getByTestId('prompt-copy'));
    await act(async () => {});

    expect(clip.writeText).toHaveBeenCalledOnce();
    expect(screen.getByTestId('prompt-copy')).toHaveTextContent('COPY');
  } finally {
    clip.restore();
  }
});
