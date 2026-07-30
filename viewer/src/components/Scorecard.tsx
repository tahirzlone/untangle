import { useEffect, useRef } from 'react';
import type { SessionMetrics } from '../graph/apply';
import type { Suggestion } from '../graph/types';
import { CategoryChip } from './DetailDrawer';
import { impactLabel, impactParts } from './ImpactMeter';
import './scorecard.css';

export interface ScorecardProps {
  /** The rows behind the version on the canvas, in the order they were applied. */
  applied: Suggestion[];
  /** The totals for those rows — the same numbers the toolbar meter carries. */
  metrics: SessionMetrics;
  /** Steps in the original graph. */
  before: number;
  /** Steps in the graph on screen. */
  after: number;
  onClose: () => void;
}

/**
 * What the cinematic did, once it has stopped doing it.
 *
 * The panel describes the SESSION, not the tour: the totals are summed off the
 * original graph, so the node counts either side of them have to be measured from
 * the same place, and the rows listed are every row the version on screen is
 * standing on. A tour that finishes work a hand-pressed APPLY started reports all
 * of it, because all of it is what the graph now is.
 *
 * Modal, unlike the detail drawer: this is the end of a sequence the user set off
 * and watched, and the graph behind it has just stopped moving. There is one way
 * on, and it is in here.
 */
export function Scorecard({ applied, metrics, before, after, onClose }: ScorecardProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus arrives with the panel. The tour was started from a button and ran
  // without the keyboard; landing focus on the way out is what hands it back.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parts = impactParts(metrics);
  const n = applied.length;

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
                {impactLabel(metrics[p.key], p.unit)}
              </span>
            ))}
          </div>
        ) : null}

        <p className="sg-scorecard-count" data-testid="scorecard-count">
          {before} → {after} nodes
        </p>

        <ul className="sg-scorecard-list" data-testid="scorecard-list">
          {applied.map((s) => (
            <li className="sg-scorecard-row" data-testid="scorecard-row" key={s.airtableRecordId}>
              <CategoryChip category={s.category} />
              <span className="sg-scorecard-name" data-testid="scorecard-name">
                {s.name}
              </span>
            </li>
          ))}
        </ul>

        <div className="sg-scorecard-actions">
          <button
            type="button"
            className="sg-scorecard-export"
            data-testid="export-png"
            // Wired up by the export task. Disabled and saying so beats a button
            // that looks live and does nothing.
            disabled
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
        <p className="sg-scorecard-note">EXPORT ARRIVES WITH T3</p>
      </section>
    </div>
  );
}
