import { useEffect } from 'react';
import type { WorkflowNode } from '../graph/types';
import { PainMeter } from './SignalNode';
import './drawer.css';

/**
 * The whole of one step, stated where there is room for it.
 *
 * The card on the canvas is a summary — three clamped lines and a meter. Clicking
 * it opens this panel, which repeats nothing and clamps nothing: the full
 * description, the kind, the pain level, and (from Task 4 on) the suggestions
 * matched to this node.
 *
 * Mounting IS the open animation — the panel is rendered only while a node is
 * selected, so `.sg-drawer`'s entrance runs on mount and there is no closed,
 * off-screen copy sitting in the DOM collecting stale focus.
 */
export function DetailDrawer({
  node,
  onClose,
}: {
  node: WorkflowNode;
  onClose: () => void;
}) {
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
      <button
        type="button"
        className="sg-drawer-x"
        data-testid="drawer-close"
        aria-label="Close detail"
        onClick={onClose}
      >
        ✕
      </button>
      <span className="sg-drawer-kind" data-testid="drawer-kind">
        {node.kind}
      </span>
      <h2 className="sg-drawer-label">{node.label}</h2>
      <div className="sg-drawer-pain">
        <span className="sg-drawer-cap">pain</span>
        <PainMeter pain={node.painLevel} />
      </div>
      <p className="sg-drawer-desc" data-testid="drawer-desc">
        {node.description}
      </p>
      {/* Task 4 fills this with the Airtable-matched suggestion cards. */}
      <div data-testid="drawer-suggestions" />
    </aside>
  );
}
