// The rejection panel's rules live alongside the graph index's (both are index
// chrome, and it reuses .sg-card-open). Imported here too so the component
// carries its own styling even if the index is never mounted.
import './gallery.css';

// Enough to diagnose without turning the panel into a scroll marathon; the
// overflow line keeps the real total honest.
const SHOWN = 12;

export function RejectedSheet({ errors, onBack }: { errors: string[]; onBack: () => void }) {
  const n = errors.length;
  return (
    <div className="sg-reject" data-testid="rejected-panel">
      <div className="sg-reject-title">GRAPH REJECTED</div>
      <div className="sg-reject-sub">
        FAILED VALIDATION — {n} {n === 1 ? 'ERROR' : 'ERRORS'}
      </div>
      <ol className="sg-reject-errors">
        {errors.slice(0, SHOWN).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {n > SHOWN ? <li>…and {n - SHOWN} more</li> : null}
      </ol>
      <button className="sg-card-open sg-reject-back" onClick={onBack}>
        BACK TO GRAPHS
      </button>
    </div>
  );
}
