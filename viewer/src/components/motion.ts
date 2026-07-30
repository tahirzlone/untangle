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

/** The cinematic's camera travel onto the next step. */
export const CAMERA_MS = 400;

/** The beat the camera holds on a step before its patch is applied. */
export const BEAT_MS = 300;

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
