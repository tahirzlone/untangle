// The rejection sheet's rules live alongside the gallery's (both are index
// chrome, and it reuses .bp-card-open). Imported here too so the component
// carries its own styling even if the gallery is never mounted.
import './gallery.css';

export function RejectedSheet({ errors, onBack }: { errors: string[]; onBack: () => void }) {
  return (
    <div className="bp-rejected" data-testid="rejected-sheet">
      <div className="bp-rejected-stamp">DRAWING REJECTED</div>
      <div className="bp-rejected-sub">RETURNED FOR CORRECTION — SEE NOTES</div>
      <ol className="bp-rejected-notes">
        {errors.slice(0, 12).map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {errors.length > 12 ? <li>…and {errors.length - 12} more</li> : null}
      </ol>
      <button className="bp-card-open bp-rejected-back" onClick={onBack}>
        BACK TO DRAWING INDEX
      </button>
    </div>
  );
}
