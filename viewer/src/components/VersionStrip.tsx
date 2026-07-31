import './versions.css';

/**
 * Where the session has got to, and the three ways through it.
 *
 * Versions are not stored anywhere in here: the strip is told how many exist and
 * which one is drawn, and a click hands the index back. The canvas moves its
 * cursor onto the version the reducer already built, so a chip can never disagree
 * with the graph beside it.
 *
 * Chips past the cursor are versions the session walked back out of. They are
 * drawn dimmed and left clickable — the history is still there until a new patch
 * branches over it, and saying so is the whole point of showing them.
 *
 * One version is no history — nothing has been applied yet, so the strip renders
 * nothing at all rather than a lone V0 chip explaining itself.
 */
export function VersionStrip({
  count,
  at,
  onJump,
  onUndo,
  onRedo,
}: {
  /** How many versions the session holds, V0 included. */
  count: number;
  /** Which one is on the canvas. */
  at: number;
  onJump: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  if (count <= 1) return null;

  return (
    <div className="sg-versions" data-testid="version-strip" role="group" aria-label="versions">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`sg-version${i === at ? ' sg-version--at' : ''}${
            i > at ? ' sg-version--future' : ''
          }`}
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
        // reachable at V0 now that the strip outlives the versions it stepped off:
        // the button goes quiet rather than the strip disappearing
        disabled={at === 0}
        onClick={onUndo}
      >
        UNDO
      </button>
      <button
        type="button"
        className="sg-ghost-btn sg-redo"
        data-testid="redo-btn"
        // nothing forward to walk into — either nothing was undone, or a new patch
        // branched over what was
        disabled={at === count - 1}
        onClick={onRedo}
      >
        REDO
      </button>
    </div>
  );
}
