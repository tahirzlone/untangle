import './versions.css';

/**
 * Where the session has got to, and the two ways back.
 *
 * Versions are not stored anywhere in here: the strip is told how many exist and
 * which one is drawn, and a click hands the index back. The canvas rebuilds that
 * version by replaying the applied prefix through the pure reducer, so a chip can
 * never disagree with the graph beside it.
 *
 * One version is no history — nothing has been applied yet, so the strip renders
 * nothing at all rather than a lone V0 chip explaining itself.
 */
export function VersionStrip({
  count,
  at,
  onJump,
  onUndo,
}: {
  /** How many versions the session holds, V0 included. */
  count: number;
  /** Which one is on the canvas. */
  at: number;
  onJump: (index: number) => void;
  onUndo: () => void;
}) {
  if (count <= 1) return null;

  return (
    <div className="sg-versions" data-testid="version-strip" role="group" aria-label="versions">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`sg-version${i === at ? ' sg-version--at' : ''}`}
          data-testid="version-chip"
          aria-current={i === at ? 'true' : undefined}
          onClick={() => onJump(i)}
        >
          V{i}
        </button>
      ))}
      {/* the same ghost-button the toolbar's RESET LAYOUT wears (canvas.css) — the
          theme's one "quiet control" style, not a second invention */}
      <button
        type="button"
        className="sg-ghost-btn sg-undo"
        data-testid="undo-btn"
        // unreachable while the strip is visible (V0 hides it) — defence in depth,
        // so the button can never step off the front of the version list
        disabled={at === 0}
        onClick={onUndo}
      >
        UNDO
      </button>
    </div>
  );
}
