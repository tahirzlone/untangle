/**
 * Every duration the canvas moves on, in one place.
 *
 * The two morph numbers are the ones written into the transitions in canvas.css:
 * TypeScript has to wait exactly as long as CSS takes, and a duration that lives
 * in two files drifts.
 */

/** The FLIP: how long a surviving card takes to travel to its new place. */
export const FLIP_MS = 480;

/** The ghost: how long a consumed card takes to leave. */
export const GHOST_MS = 400;

/**
 * The gap the layout pass opens between an apply and the first frame of the
 * morph — the cards cannot start travelling until ELK has answered where to.
 */
const LAYOUT_BEAT_MS = 220;

/**
 * How long after an apply the graph is still again: the layout pass, then the
 * FLIP it feeds. Derived rather than picked, so a change to the morph's duration
 * carries into the cinematic's pacing on its own.
 */
export const SETTLE_MS = FLIP_MS + LAYOUT_BEAT_MS;

/**
 * The two morph durations, in the form CSS can read them.
 *
 * canvas.css writes `transition: transform var(--flip-ms, 480ms) …` and
 * `animation: sg-ghost-out var(--ghost-ms, 400ms) …`; the canvas stamps this
 * object onto its root so the numbers above are the ones that actually run. The
 * literals in the stylesheet are the fallback for a canvas that never mounted —
 * retuning happens here, in one place, and both sides move together.
 *
 * The `ms` suffix is not decoration: a custom property is substituted as raw
 * text, and a bare `480` in a time position makes the whole shorthand invalid.
 */
export const MOTION_VARS = {
  '--flip-ms': `${FLIP_MS}ms`,
  '--ghost-ms': `${GHOST_MS}ms`,
} as const;

/**
 * The celebration float: how long one saving takes to rise off the applied step
 * and fade. Read by TypeScript (the timer that drops the float) and written onto
 * the element as its animation duration — see Celebration.tsx on why this one is
 * not a CSS variable like the two above.
 */
export const FLOAT_MS = 900;

/** The gap between one saving in a burst and the next, so they rise as a run. */
export const FLOAT_STAGGER_MS = 90;

/** The cinematic's camera travel onto the next step. */
export const CAMERA_MS = 400;

/** The beat the camera holds on a step before its patch is applied. */
export const BEAT_MS = 300;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
