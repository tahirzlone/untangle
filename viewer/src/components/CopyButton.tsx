import { useCallback, useEffect, useRef, useState } from 'react';
import './copyButton.css';

/** How long the button says COPIED before it offers again. */
export const COPIED_MS = 1600;

/**
 * COPY, and the moment after it: the label swaps to COPIED and the button
 * flashes once, then goes back to offering. Shared by the prompt panel, the
 * install kit inside it, and the scorecard — the same deliverables are copied
 * from all of them, and two buttons that behaved differently about the same text
 * would be two claims about one fact.
 *
 * In its own module for that last reason made structural: the kit is drawn
 * INSIDE the prompt panel, so a control the child borrowed from its parent would
 * be a circle in the module graph. What three surfaces share belongs to none of
 * them.
 *
 * The clipboard is permission-gated and absent entirely off HTTPS, so the copy
 * only ever CLAIMS after the write resolved: a COPIED over a rejected write
 * would be the button lying about the one thing it exists to do. No clipboard
 * at all — the press is a quiet no-op rather than a crash.
 *
 * `disabled` is for a press with nothing behind it: a kit with every row cleared
 * has no block to hand over, and a COPIED flashed over an empty string would be
 * claiming a paste that pastes nothing. Native `disabled` rather than the
 * `aria-disabled` the drawer's APPLY wears, because there is nothing here to
 * explain — the empty selection is on screen, in the boxes that were just
 * cleared — and every other stood-down control on the canvas is disabled the
 * same way, down to the styling `.sg-ghost-btn:disabled` already carries.
 *
 * The flash is CSS (copyButton.css) and stands down under prefers-reduced-motion;
 * the label swap is instant either way, which is the reduced-motion answer.
 */
export function CopyButton({
  text,
  testId,
  disabled = false,
}: {
  text: string;
  testId: string;
  disabled?: boolean;
}) {
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
      disabled={disabled}
      // the label is the announcement: COPIED is spoken when it lands
      aria-live="polite"
      onClick={onCopy}
    >
      {copied ? 'COPIED' : 'COPY'}
    </button>
  );
}
