import { useCallback, useEffect, useRef } from 'react';
import type { Suggestion, SuggestionCategory, WorkflowNode } from '../graph/types';
import { PainMeter } from './SignalNode';
import './drawer.css';

/**
 * Which token inks the chip. The three Claude categories each get their own;
 * Connector and Other share the neutral, because the palette is a signal about
 * what kind of thing this is, not a rainbow.
 */
const CAT_CLASS: Record<SuggestionCategory, string> = {
  'Claude Skill': 'skill',
  'Claude Plugin': 'plugin',
  'MCP Server': 'mcp',
  Connector: 'other',
  Other: 'other',
};

/**
 * What kind of resource this is, in its own ink.
 *
 * Exported because the scorecard lists the same rows at the end of a cinematic,
 * and a chip that reads a different colour there would break the one thing the
 * palette is for: a row wears the same colour wherever it is named.
 */
export function CategoryChip({ category }: { category: SuggestionCategory }) {
  return (
    <span className={`sg-sug-cat sg-sug-cat--${CAT_CLASS[category]}`} data-testid="sg-sug-cat">
      {category}
    </span>
  );
}

/**
 * A drawer that shows suggestion cards must also be told how to dry-run them and
 * what to do when one is applied. Expressed as a union so a card can never reach
 * the screen with an APPLY button nobody is behind: pass all three, or none.
 */
type SuggestionProps =
  | { suggestions?: never; canApply?: never; onApply?: never }
  | {
      suggestions: Suggestion[];
      /** False when the reducer refuses this patch — the button is then inert. */
      canApply: (airtableRecordId: string) => boolean;
      onApply: (airtableRecordId: string) => void;
    };

export type DetailDrawerProps = { node: WorkflowNode; onClose: () => void } & SuggestionProps;

/** One matched Airtable row, stated as something the user can act on. */
function SuggestionCard({
  suggestion,
  appliable,
  onApply,
}: {
  suggestion: Suggestion;
  appliable: boolean;
  onApply: () => void;
}) {
  return (
    <article className="sg-sug-card" data-testid="sg-sug-card">
      <div className="sg-sug-head">
        <CategoryChip category={suggestion.category} />
        {/* the row's own link, opened away from the graph — and noreferrer with
            noopener so the new tab gets no handle on this one */}
        <a
          className="sg-sug-name"
          href={suggestion.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {suggestion.name}
        </a>
      </div>
      <p className="sg-sug-claim" data-testid="sg-sug-claim">
        {suggestion.claim}
      </p>
      {suggestion.install ? (
        // user-select: all in the stylesheet — one click takes the whole command
        <code className="sg-sug-install" data-testid="sg-sug-install">
          {suggestion.install}
        </code>
      ) : null}
      <button
        type="button"
        className="sg-sug-apply"
        data-testid="sg-sug-apply"
        disabled={!appliable}
        onClick={onApply}
      >
        APPLY
      </button>
      {appliable ? null : (
        <span className="sg-sug-invalid" data-testid="sg-sug-invalid">
          PATCH INVALID
        </span>
      )}
    </article>
  );
}

/**
 * The whole of one step, stated where there is room for it.
 *
 * The card on the canvas is a summary — three clamped lines and a meter. Clicking
 * it opens this panel, which repeats nothing and clamps nothing: the full
 * description, the kind, the pain level, and the suggestions the KB matched to
 * this node.
 *
 * Two regions, deliberately: a header that never scrolls (so the way out stays on
 * screen however long the suggestion list runs) and a body that does.
 *
 * Mounting IS the open animation — the panel is rendered only while a node is
 * selected, so `.sg-drawer`'s entrance runs on mount and there is no closed,
 * off-screen copy sitting in the DOM collecting stale focus.
 */
export function DetailDrawer({
  node,
  onClose,
  suggestions = [],
  canApply,
  onApply,
}: DetailDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * Opening puts focus in the panel, on the first thing in the header.
   *
   * Without this the keyboard route opens a drawer nobody can reach: focus stays
   * on the card behind it, so APPLY is one Tab per remaining card away — N tabs on
   * an N-node graph — and a screen reader is told nothing appeared at all.
   *
   * Keyed on the node, not on mount: clicking a second card while the panel is
   * open is another open, and focus follows the panel's new subject.
   */
  useEffect(() => {
    closeRef.current?.focus();
  }, [node.id]);

  /**
   * Closing hands focus back where it came from — the card whose detail this was.
   *
   * Guarded because the card need not still be there: Task 5's apply can consume
   * the very node the drawer is describing, and a focus call into a removed
   * element would strand focus on <body> either way.
   */
  const closeAndRestore = useCallback(() => {
    const card = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${node.id}"]`);
    onClose();
    card?.focus();
  }, [node.id, onClose]);

  // Escape is listened for on the window, not the panel: it must close the drawer
  // whether focus is inside it or back out on the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestore();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAndRestore]);

  return (
    <aside
      className="sg-drawer"
      data-testid="detail-drawer"
      // A dialog, so its arrival is announced and its label is read — but not a
      // modal one: the graph behind it stays draggable and clickable.
      role="dialog"
      aria-modal={false}
      aria-label={node.label}
    >
      <div className="sg-drawer-head">
        <span className="sg-drawer-kind" data-testid="drawer-kind">
          {node.kind}
        </span>
        <button
          type="button"
          className="sg-drawer-x"
          data-testid="drawer-close"
          aria-label="Close detail"
          ref={closeRef}
          onClick={closeAndRestore}
        >
          ✕
        </button>
      </div>
      <div className="sg-drawer-body" data-testid="drawer-scroll">
        <h2 className="sg-drawer-label">{node.label}</h2>
        <div className="sg-drawer-pain">
          <span className="sg-drawer-cap">pain</span>
          <PainMeter pain={node.painLevel} />
        </div>
        <p className="sg-drawer-desc" data-testid="drawer-desc">
          {node.description}
        </p>
        <div className="sg-sug-list" data-testid="drawer-suggestions">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.airtableRecordId}
              suggestion={s}
              // No dry-runner, no claim: a button that might throw is worse than
              // one that says why it cannot.
              appliable={canApply?.(s.airtableRecordId) ?? false}
              onApply={() => onApply?.(s.airtableRecordId)}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
