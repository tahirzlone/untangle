import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { impactLabel, impactParts } from '../graph/metrics';
import type { EffectMetrics } from '../graph/types';
import { FLOAT_MS, FLOAT_STAGGER_MS, prefersReducedMotion } from './motion';
import './celebration.css';

/**
 * The moment a patch lands, said where it happened.
 *
 * The panel on the right is where the totals live, and it is nowhere near the card
 * the user just pressed APPLY on — so what the patch itself bought rises off the
 * step that bought it and is gone. Ephemeral by design: nothing here is a control,
 * nothing takes a pointer, and nothing is announced (the panel's live region says
 * the same thing to a screen reader, once, in words).
 */

/** One burst: every saving a single patch claimed, rising from its step. */
export interface Float {
  id: number;
  /** Screen coordinates — the card's own, read the moment the patch was applied. */
  x: number;
  y: number;
  lines: string[];
}

const NO_FLOATS: Float[] = [];

/** How long a burst stays mounted: the last line's rise, and then it is dropped. */
const burstMs = (lines: number) => FLOAT_MS + (lines - 1) * FLOAT_STAGGER_MS;

export interface Celebration {
  floats: Float[];
  /** Raises what this patch saved off the step it was applied to. */
  celebrate: (nodeId: string, metrics: EffectMetrics) => void;
}

/**
 * Holds the floats in flight.
 *
 * The card's position is read off the DOM at the moment of the press, before the
 * morph moves anything: React Flow owns where a card sits, and the same wrapper
 * the peek measures is the honest source for where the applied step WAS. A step
 * with no card on screen — a graph mid-layout — raises nothing rather than a
 * number floating up from the corner of the canvas.
 */
export function useCelebration(): Celebration {
  const [floats, setFloats] = useState<Float[]>(NO_FLOATS);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  const celebrate = useCallback((nodeId: string, metrics: EffectMetrics) => {
    // Motion is not wanted: the totals still change, the panel still says so, and
    // nothing flies across the screen to announce it.
    if (prefersReducedMotion()) return;
    const parts = impactParts(metrics);
    // A patch that claims nothing has nothing to celebrate — and "−0 tok" rising
    // off a step would be a boast about a zero.
    if (parts.length === 0) return;
    const wrapper = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${nodeId}"]`,
    );
    if (!wrapper) return;

    const box = wrapper.getBoundingClientRect();
    const id = (seq.current += 1);
    const lines = parts.map((p) => impactLabel(metrics[p.key], p.unit));
    setFloats((up) => [...up, { id, x: box.left + box.width / 2, y: box.top, lines }]);

    const timer = window.setTimeout(() => {
      setFloats((up) => up.filter((f) => f.id !== id));
      timers.current = timers.current.filter((t) => t !== timer);
    }, burstMs(lines.length));
    timers.current.push(timer);
  }, []);

  return { floats, celebrate };
}

/**
 * The floats themselves, on the window rather than in the graph.
 *
 * Portalled and fixed for the same reason the peek is: these are screen overlays
 * measured in screen pixels, so they neither zoom with the canvas nor get clipped
 * by the pane. `pointer-events: none` throughout — a number rising past the cursor
 * must not swallow the click the user makes next.
 */
export function CelebrationLayer({ floats }: { floats: Float[] }) {
  if (floats.length === 0) return null;

  return createPortal(
    <div className="sg-floats" data-testid="celebration-layer" aria-hidden="true">
      {floats.map((f) => (
        <div className="sg-float" data-testid="celebration" key={f.id} style={{ left: f.x, top: f.y }}>
          {f.lines.map((line, i) => (
            <span
              className="sg-float-line"
              key={line}
              // The duration is stated on the element, not through a custom
              // property: this layer is portalled onto the body, outside the
              // canvas root the motion variables are stamped on. One constant
              // still drives both the rise and the timer that drops it.
              style={{
                animationDuration: `${FLOAT_MS}ms`,
                animationDelay: `${i * FLOAT_STAGGER_MS}ms`,
              }}
            >
              {line}
            </span>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
