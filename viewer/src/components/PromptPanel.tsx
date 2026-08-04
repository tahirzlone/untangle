import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphSession } from '../graph/apply';
import { assemblePrompt } from '../graph/prompt';
import './prompt.css';

/** How long the button says COPIED before it offers again. */
export const COPIED_MS = 1600;

/**
 * COPY, and the moment after it: the label swaps to COPIED and the button
 * flashes once, then goes back to offering. Shared by the rail panel and the
 * scorecard — the same deliverable is copied from both, and two buttons that
 * behaved differently about the same text would be two claims about one fact.
 *
 * The clipboard is permission-gated and absent entirely off HTTPS, so the copy
 * only ever CLAIMS after the write resolved: a COPIED over a rejected write
 * would be the button lying about the one thing it exists to do. No clipboard
 * at all — the press is a quiet no-op rather than a crash.
 *
 * The flash is CSS (prompt.css) and stands down under prefers-reduced-motion;
 * the label swap is instant either way, which is the reduced-motion answer.
 */
export function CopyButton({ text, testId }: { text: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = useCallback(() => {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) return;
    clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      },
      // refused — the clipboard said no, so the button claims nothing
      () => {},
    );
  }, [text]);

  return (
    <button
      type="button"
      className={`sg-ghost-btn sg-copy-btn${copied ? ' sg-copy-btn--copied' : ''}`}
      data-testid={testId}
      // the label is the announcement: COPIED is spoken when it lands
      aria-live="polite"
      onClick={onCopy}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}

/**
 * The optimized prompt, in the rail: what to paste into Claude to run this task
 * with everything the session has applied, assembled fresh for whatever version
 * the cursor is on. Toggled from the toolbar's PROMPT button; stands under the
 * impact panel in the same right-hand column — the rail is a column, and a
 * second panel joins it by being rendered beside the first.
 *
 * At V0 the prompt is the opening alone, and the panel says so rather than
 * hiding: the task as a prompt is a valid prompt, just one nothing has improved
 * yet. The mono block is selectable and scrollable — it is text to take, not a
 * picture of text.
 */
export function PromptPanel({ session }: { session: GraphSession }) {
  // A pure function of the session, memoized on it: every route that moves the
  // graph — apply, undo, redo, jump — replaces the session, so the prompt
  // regenerates exactly when the version on the canvas changes.
  const prompt = useMemo(() => assemblePrompt(session), [session]);

  return (
    <section className="sg-prompt" data-testid="prompt-panel" aria-label="optimized prompt">
      <div className="sg-prompt-head">
        <span className="sg-prompt-title">OPTIMIZED PROMPT</span>
        <CopyButton text={prompt} testId="prompt-copy" />
      </div>
      {session.cursor === 0 ? (
        <p className="sg-prompt-none" data-testid="prompt-none">
          NO UPGRADES APPLIED YET
        </p>
      ) : null}
      {/* tabIndex: a scrollable region the keyboard can reach and arrow through */}
      <pre className="sg-prompt-text" data-testid="prompt-text" tabIndex={0}>
        {prompt}
      </pre>
    </section>
  );
}
