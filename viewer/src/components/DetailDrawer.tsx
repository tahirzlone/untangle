import { useEffect } from 'react';
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
        <span
          className={`sg-sug-cat sg-sug-cat--${CAT_CLASS[suggestion.category]}`}
          data-testid="sg-sug-cat"
        >
          {suggestion.category}
        </span>
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
  // Escape is listened for on the window, not the panel: the click that opened
  // the drawer leaves focus on the node card behind it, so a panel-scoped
  // handler would never hear the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      className="sg-drawer"
      data-testid="detail-drawer"
      role="complementary"
      aria-label={`${node.label} detail`}
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
          onClick={onClose}
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
