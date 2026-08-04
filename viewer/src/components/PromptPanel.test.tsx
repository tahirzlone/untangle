import { act, fireEvent, render, screen } from '@testing-library/react';
import enrichedDoc from '../test/fixtures/enriched.workflow.json';
import { applySuggestion, createSession } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import { fixture } from '../test/harness';
import { COPIED_MS, PromptPanel } from './PromptPanel';

const enriched = fixture(enrichedDoc, 'enriched');
const FIRECRAWL = 'recA7kQ2mZ9pLxT4b';

const fresh = () => createSession(enriched);
const oneApplied = () => applySuggestion(fresh(), FIRECRAWL);

/**
 * Puts a clipboard where jsdom has none, and takes it away again. Configurable,
 * so the no-clipboard test can also DELETE it and model the http:// session
 * where the API simply does not exist.
 */
function mockClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: spy },
    configurable: true,
  });
  return {
    writeText: spy,
    restore: () => {
      delete (navigator as { clipboard?: unknown }).clipboard;
    },
  };
}

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
