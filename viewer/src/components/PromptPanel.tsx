import { useMemo } from 'react';
import type { GraphSession } from '../graph/apply';
import { appliedInFlowOrder, assemblePrompt } from '../graph/prompt';
import { CopyButton } from './CopyButton';
import { InstallKit } from './InstallKit';
import './prompt.css';

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
 *
 * The install kit is the panel's second section, for the same reason it is in
 * this panel at all: the commands are the pre-flight for the text above them, and
 * a toolbar button of their own would have separated a paste from the thing it is
 * a paste FOR. Hosting it here also means it inherits every rule this panel
 * already lives under — off with the PROMPT toggle, out of sight with the rail
 * while the wipe is open.
 */
export function PromptPanel({ session }: { session: GraphSession }) {
  // Pure functions of the session, memoized on it: every route that moves the
  // graph — apply, undo, redo, jump — replaces the session, so both the prompt and
  // the kit's rows regenerate exactly when the version on the canvas changes.
  const prompt = useMemo(() => assemblePrompt(session), [session]);
  const applied = useMemo(() => appliedInFlowOrder(session), [session]);

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
      {/* Nothing applied is nothing to install, and the line above already says
          why the prompt is short — a second empty state under it would be the
          panel saying it twice.

          Keyed on the cursor, which is what makes the ticks belong to a version:
          a move remounts the kit, and consent given about one set of steps is
          never inherited by the set the next version has. */}
      {session.cursor > 0 ? <InstallKit rows={applied} key={session.cursor} /> : null}
    </section>
  );
}
