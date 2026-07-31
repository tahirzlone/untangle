import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import type { SessionMetrics } from '../graph/apply';
import type { Suggestion } from '../graph/types';
import { CategoryChip } from './DetailDrawer';
import { impactLabel, impactParts } from './ImpactMeter';
import './scorecard.css';

/**
 * What a finished run did, frozen at the moment it stopped.
 *
 * Deliberately a snapshot and not a view of the session: the panel is a report on
 * something the user watched happen, and a session that moves underneath it — a
 * version jump, an undo — must not be able to rewrite that account into
 * "0 upgrades applied" while it is still on screen.
 */
export interface ScorecardReport {
  /** The rows behind the version the run finished on, in the order they landed. */
  applied: Suggestion[];
  /** The totals for those rows — the same numbers the toolbar meter carried. */
  metrics: SessionMetrics;
  /** Steps in the original graph. */
  before: number;
  /** Steps in the graph the run finished on. */
  after: number;
}

/** Everything the browser will stop on inside the panel, in tab order. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * What the cinematic did, once it has stopped doing it.
 *
 * The report describes the SESSION as the run left it: the totals are summed off
 * the original graph, so the node counts either side of them are measured from the
 * same place, and the rows listed are every row that version was standing on. A
 * tour that finishes work a hand-pressed APPLY started reports all of it, because
 * all of it is what the graph had become.
 *
 * Modal, unlike the detail drawer, and modal in the way the word actually
 * promises: the canvas behind is made inert by the caller, and Tab is kept in here
 * rather than left to geometry — the masthead sits above the backdrop.
 */
export function Scorecard({
  report,
  onClose,
  onExport,
  exportFailed,
}: {
  report: ScorecardReport;
  onClose: () => void;
  /** Captures the graph the run finished on — the one still drawn behind this. */
  onExport: () => void;
  /** The last press asked for from here came back a failure. */
  exportFailed: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // Focus arrives with the panel. The tour was started from a button and ran
  // without the keyboard; landing focus on the way out is what hands it back.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Tab wraps inside the panel.
   *
   * `inert` on the canvas puts the graph, the toolbar and the version strip out of
   * reach, but the masthead lives above the backdrop and would otherwise be one
   * Tab away — two stops in here is two Tabs from the edge, not a containment.
   */
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const stops = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return;
    // Shift+Tab falls off the front of the list, Tab off the back; either way the
    // focus comes round to the other end rather than leaving.
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
    const wrap = e.shiftKey ? stops[stops.length - 1] : stops[0];
    if (document.activeElement !== edge) return;
    e.preventDefault();
    wrap.focus();
  }, []);

  const parts = impactParts(report.metrics);
  const n = report.applied.length;

  return (
    <div
      className="sg-scorecard-back"
      data-testid="scorecard-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="sg-scorecard"
        data-testid="scorecard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sg-scorecard-title"
        ref={panelRef}
        onKeyDown={onKeyDown}
        // the backdrop closes; the panel is not the backdrop
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sg-scorecard-title" id="sg-scorecard-title">
          OPTIMIZED — {n} upgrade{n === 1 ? '' : 's'} applied
        </h2>

        {parts.length > 0 ? (
          <div className="sg-scorecard-metrics" role="group" aria-label="impact">
            {parts.map((p) => (
              <span className="sg-scorecard-metric" data-testid="scorecard-metric" key={p.key}>
                {impactLabel(report.metrics[p.key], p.unit)}
              </span>
            ))}
          </div>
        ) : null}

        <p className="sg-scorecard-count" data-testid="scorecard-count">
          {report.before} → {report.after} nodes
        </p>

        <ul className="sg-scorecard-list" data-testid="scorecard-list">
          {report.applied.map((s) => (
            <li className="sg-scorecard-row" data-testid="scorecard-row" key={s.airtableRecordId}>
              <CategoryChip category={s.category} />
              <span className="sg-scorecard-name" data-testid="scorecard-name">
                {s.name}
              </span>
            </li>
          ))}
        </ul>

        <div className="sg-scorecard-actions">
          {/* Takes the graph the run finished on, which is the one still drawn
              behind this panel. Exporting is not leaving: the report stays up, and
              CLOSE is still the way out. */}
          <button
            type="button"
            className="sg-scorecard-export"
            data-testid="export-png"
            onClick={onExport}
          >
            EXPORT PNG
          </button>
          <button
            type="button"
            className="sg-scorecard-close"
            data-testid="scorecard-close"
            ref={closeRef}
            onClick={onClose}
          >
            CLOSE
          </button>
        </div>
        {exportFailed ? (
          <p
            className="sg-scorecard-note sg-scorecard-note--failed"
            data-testid="scorecard-export-failed"
            role="status"
          >
            EXPORT FAILED
          </p>
        ) : null}
      </section>
    </div>
  );
}
