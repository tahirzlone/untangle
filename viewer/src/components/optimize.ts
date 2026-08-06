import { useCallback, useEffect, useRef, useState } from 'react';
import { applySuggestion, current, type GraphSession } from '../graph/apply';
import type { Suggestion } from '../graph/types';
import { BEAT_MS, CAMERA_MS, prefersReducedMotion, SETTLE_MS } from './motion';

/**
 * Would the reducer take this patch on this session? Answered by running it on a
 * session nobody keeps — the same dry run the drawer's APPLY button is disabled
 * by, because a patch can satisfy the schema and still describe a graph that
 * cannot exist.
 */
function appliable(session: GraphSession, airtableRecordId: string): boolean {
  try {
    applySuggestion(session, airtableRecordId);
    return true;
  } catch {
    return false;
  }
}

/**
 * The patches the reducer will take on this session, in the order the tour should
 * visit them: left to right across the canvas, which is the order the work itself
 * runs in.
 *
 * `xOf` answers where a step is drawn right now. A step with no position yet — a
 * card React Flow has not mounted — sorts to the end rather than to the front, so
 * an unmeasured node never hijacks the opening shot. Ties keep the order the KB
 * answered in: two rows on one step are two futures for the same moment.
 */
export function orderAppliable(
  session: GraphSession,
  xOf: (nodeId: string) => number | undefined,
): Suggestion[] {
  return current(session)
    .suggestions.filter((s) => appliable(session, s.airtableRecordId))
    .map((s, i) => ({ s, i, x: xOf(s.nodeId) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.x - b.x || a.i - b.i)
    .map((e) => e.s);
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * A finished run, in the terms the canvas answers a finished run in.
 *
 * The session comes back WITH the count rather than being fetched afterwards: the
 * instant route commits every patch inside one React batch, so at the moment it
 * finishes there is no re-render yet and no fresh session to go and ask for. The
 * route that produced it is the only thing that knows.
 */
export interface TourResult {
  /** How many patches the reducer actually took. */
  applied: number;
  /** The session they produced, or null when none landed. */
  session: GraphSession | null;
}

/**
 * Everything the tour needs from the canvas it is running on.
 *
 * Handed over as callbacks rather than as state, because every one of them has to
 * answer for the graph as it is at that step — the tour applies patches, and the
 * session, the layout and the appliability of everything still on the list all
 * move underneath it while it runs.
 */
export interface CinematicDeps {
  /** The session as it is right now. */
  getSession: () => GraphSession | null;
  /** Where a step's card sits on the canvas, or null when it is not drawn. */
  boxOf: (nodeId: string) => { x: number; y: number; width: number; height: number } | null;
  /** Puts the camera on a point in graph space. */
  lookAt: (x: number, y: number) => void;
  /** One patch, through the same route the drawer's APPLY drives. */
  applyOne: (airtableRecordId: string) => void;
  /** Every patch in one commit, for when motion is not wanted. */
  applyAll: (airtableRecordIds: string[]) => TourResult;
  /** The run has stopped, and this is what it left behind. */
  onDone: (result: TourResult) => void;
}

export interface Cinematic {
  /** True from the press of OPTIMIZE until the last apply has settled. */
  running: boolean;
  start: () => void;
  cancel: () => void;
}

/**
 * The OPTIMIZE tour: fly to a step, hold a beat, apply its patch, let the graph
 * settle, move on.
 *
 * No new mutation route — `applyOne` is the drawer's own APPLY, so a patch landed
 * by the tour is indistinguishable from one landed by hand: same reducer, same
 * morph, same version chip. Which also means a tour started from a version the
 * cursor stepped back to BRANCHES over the forward history, exactly as a
 * hand-pressed APPLY does. That is the reducer's rule, not a decision taken here.
 *
 * The order is planned once, at the press: it is a camera path across a graph the
 * user can see, and re-sorting it mid-flight would send the camera back the way it
 * came. Appliability is asked again at every step, because it genuinely changes —
 * a patch that consolidates two steps takes the other row on them with it.
 */
export function useCinematic(deps: CinematicDeps): Cinematic {
  const [running, setRunning] = useState(false);
  const latest = useRef(deps);
  const cancelled = useRef(false);
  const live = useRef(true);
  const busy = useRef(false);

  // Written from an effect rather than during render: the loop reads this AFTER
  // each apply has been committed, and the commit is what makes the next session
  // visible here at all.
  useEffect(() => {
    latest.current = deps;
  });

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
  }, []);

  const start = useCallback(() => {
    if (busy.current) return;
    const opening = latest.current;
    const session = opening.getSession();
    if (!session) return;
    const planned = orderAppliable(session, (id) => opening.boxOf(id)?.x);
    if (planned.length === 0) return;
    const ids = planned.map((s) => s.airtableRecordId);

    // Motion is not wanted: no camera and no pacing, so the whole tour is one
    // commit — the same reducer calls in the same order, with nothing between them.
    if (prefersReducedMotion()) {
      opening.onDone(opening.applyAll(ids));
      return;
    }

    busy.current = true;
    cancelled.current = false;
    setRunning(true);

    void (async () => {
      let applied = 0;
      for (const step of planned) {
        // CANCEL and unmount are both read here, at the top of a step: a step
        // already under way plays out, and an apply is a single reducer call, so
        // there is never half of one left behind.
        if (cancelled.current || !live.current) break;
        const now = latest.current;
        const here = now.getSession();
        if (!here) break;
        // Asked again every step: the apply before this one may have consumed the
        // step this row describes, along with the row itself.
        if (!appliable(here, step.airtableRecordId)) continue;

        const box = now.boxOf(step.nodeId);
        if (box) {
          now.lookAt(box.x + box.width / 2, box.y + box.height / 2);
          await wait(CAMERA_MS);
        }
        await wait(BEAT_MS);
        if (!live.current) break;
        now.applyOne(step.airtableRecordId);
        applied += 1;
        await wait(SETTLE_MS);
      }
      busy.current = false;
      if (!live.current) return;
      setRunning(false);
      // Read here rather than carried through the loop: every apply committed and
      // re-rendered before the settle that followed it, so this is the session the
      // last one produced.
      latest.current.onDone({ applied, session: latest.current.getSession() });
    })();
  }, []);

  // Escape is the tour's way out as much as the button is, and it is listened for
  // only while the tour is running — the moment it stops, the keystroke belongs to
  // whatever the run put on screen.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, running]);

  return { running, start, cancel };
}
