import { render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { EdgeTag, SignalEdge } from './SignalEdge';
import type { EdgeKind } from '../graph/types';

// The ports SignalNode declares: source at the right edge middle of a
// 252×148 card, target at the left edge middle of the card in the next layer.
const PORTS = {
  id: 'e0',
  source: 'a',
  target: 'b',
  sourceX: 252,
  sourceY: 74,
  targetX: 342,
  targetY: 278,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

function edgeProps(data: {
  kind: EdgeKind;
  label?: string;
  index: number;
  critical?: boolean;
}): EdgeProps {
  return { ...PORTS, data } as EdgeProps;
}

/**
 * The palette, where the app keeps it: tokens on the root.
 *
 * jsdom loads no stylesheet, so this is the only place `--accent` and the rest
 * resolve from here — and it is what the edge reads at render time, so an ink
 * literal in the component would fail these outright.
 */
const INK: Record<string, string> = {
  '--accent': 'rgb(163, 230, 53)',
  '--ember': 'rgb(249, 115, 22)',
  '--line': 'rgb(35, 42, 59)',
  '--edge-branch': 'rgb(93, 127, 56)',
  '--edge-stroke': '2',
  '--edge-stroke-critical': '3.5',
  '--edge-cap': 'round',
  '--edge-opacity': '0.75',
  '--edge-opacity-retry': '0.9',
  '--edge-dash': '1',
  '--edge-dash-retry': '0.04 0.02',
};

function installTokens(): () => void {
  for (const [name, value] of Object.entries(INK)) {
    document.documentElement.style.setProperty(name, value);
  }
  return () => {
    for (const name of Object.keys(INK)) document.documentElement.style.removeProperty(name);
  };
}

function reducedMotion(matches: boolean) {
  const original = window.matchMedia;
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    ...original(query),
    matches: query.includes('prefers-reduced-motion') ? matches : false,
  });
  return () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = original;
  };
}

it('curves from the source port to the target port', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...edgeProps({ kind: 'sequence', index: 0 })} />
    </svg>,
  );
  const path = container.querySelector('path.sg-edge')!;
  const d = path.getAttribute('d')!;
  // a real cubic between the declared handles — not an ELK polyline
  expect(d.startsWith('M252,74')).toBe(true);
  expect(d).toContain('C');
  expect(d.endsWith('342,278')).toBe(true);
  expect(path.getAttribute('marker-end')).toBe('url(#fp-arrow)');
  expect(path.getAttribute('pathLength')).toBe('1');
});

it('inks retry edges in their own class and skips the flow dot', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...edgeProps({ kind: 'retry', index: 2 })} />
    </svg>,
  );
  const path = container.querySelector('path.sg-edge')!;
  expect(path.classList.contains('sg-edge--retry')).toBe(true);
  expect(container.querySelector('circle.sg-flow-dot')).toBeNull();
});

it('sends a flow dot down the same curve a sequence edge draws', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...edgeProps({ kind: 'sequence', index: 1 })} />
    </svg>,
  );
  const d = container.querySelector('path.sg-edge')!.getAttribute('d');
  const dot = container.querySelector('circle.sg-flow-dot')!;
  const motion = dot.querySelector('animateMotion')!;
  expect(motion.getAttribute('path')).toBe(d);
  expect(motion.getAttribute('repeatCount')).toBe('indefinite');
});

it('withholds the flow dot when reduced motion is requested', () => {
  const restore = reducedMotion(true);
  try {
    const { container } = render(
      <svg>
        <SignalEdge {...edgeProps({ kind: 'sequence', index: 0 })} />
      </svg>,
    );
    expect(container.querySelector('path.sg-edge')).not.toBeNull();
    expect(container.querySelector('circle.sg-flow-dot')).toBeNull();
  } finally {
    restore();
  }
});

it('staggers each edge by its index', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...edgeProps({ kind: 'branch', index: 4 })} />
    </svg>,
  );
  const group = container.querySelector('g.sg-edge-group')!;
  expect(group.getAttribute('style')).toContain('--i: 4');
  expect(container.querySelector('path.sg-edge')!.classList.contains('sg-edge--branch')).toBe(true);
});

// ELK reverses edges to break the retry cycles, so ordinary sequence edges come
// back pointing right-to-left. Those get routed around the cards, not through them.
const REVERSED = { ...PORTS, sourceX: 2317, sourceY: 284, targetX: 1038, targetY: 92.3 };

it('loops a right-to-left edge below the rows instead of curving under the cards', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...({ ...REVERSED, data: { kind: 'sequence', index: 0 } } as EdgeProps)} />
    </svg>,
  );
  const d = container.querySelector('path.sg-edge')!.getAttribute('d')!;
  expect(d.startsWith('M2317,284')).toBe(true);
  expect(d.endsWith('L1038,92.3')).toBe(true);
  // an orthogonal loop with quadratic corners, never a cubic
  expect(d).not.toContain('C');
  expect(d.match(/Q/g)).toHaveLength(4);
  // the long run clears the lower card row (284 + 148/2 = 358)
  expect(d).toContain(',390');
});

it('withholds the flow dot on a back-edge even when it is a sequence edge', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...({ ...REVERSED, data: { kind: 'sequence', index: 0 } } as EdgeProps)} />
    </svg>,
  );
  expect(container.querySelector('circle.sg-flow-dot')).toBeNull();
});

it('EdgeTag renders one span per wrapped line', () => {
  const { getByTestId } = render(
    <EdgeTag id="e0" lines={['flaky selector /', 'timing race']} kind="retry" x={10} y={50} />,
  );
  const spans = getByTestId('edge-tag').querySelectorAll('span');
  expect(spans).toHaveLength(2);
  expect(spans[0].textContent).toBe('flaky selector /');
  expect(spans[1].textContent).toBe('timing race');
});

it('EdgeTag marks retry edges and leaves other kinds unmarked', () => {
  const { getByTestId, unmount } = render(
    <EdgeTag id="e0" lines={['retrying']} kind="retry" x={0} y={0} />,
  );
  expect(getByTestId('edge-tag').classList.contains('sg-edge-tag--retry')).toBe(true);
  unmount();
  const { getByTestId: get2 } = render(
    <EdgeTag id="e1" lines={['CI green']} kind="branch" x={0} y={0} />,
  );
  expect(get2('edge-tag').classList.contains('sg-edge-tag--retry')).toBe(false);
});

it('EdgeTag centres itself on the label point', () => {
  const { getByTestId } = render(
    <EdgeTag id="e0" lines={['mid']} kind="sequence" x={120} y={64} />,
  );
  const style = getByTestId('edge-tag').getAttribute('style')!;
  expect(style).toContain('translate(-50%, -50%)');
  expect(style).toContain('translate(120px, 64px)');
});

// The collision pass answers in offsets from the point the curve chose, and the
// chip has to state BOTH: the point it moves to, and the point it was moved from.
// Re-measuring the moved position would let a tag walk a nudge further away on
// every pass over the same unchanged graph.
it('EdgeTag applies the collision offset and still states where its curve put it', () => {
  const { getByTestId } = render(
    <EdgeTag id="e3" lines={['CI green']} kind="branch" x={120} y={64} offset={{ dx: 0, dy: -12 }} />,
  );
  const tag = getByTestId('edge-tag');
  expect(tag.getAttribute('style')).toContain('translate(120px, 52px)');
  expect(tag.dataset.tagId).toBe('e3');
  expect(tag.dataset.tagX).toBe('120');
  expect(tag.dataset.tagY).toBe('64');
});

// ---------------------------------------------------------------------------
// Ink the export can see
// ---------------------------------------------------------------------------

/**
 * An exported PNG is a clone of the DOM with no stylesheet behind it, and
 * html-to-image does not carry CSS-derived presentation onto cloned SVG
 * children — a graph whose edges live entirely in a class exports with no edges
 * at all. So the path states its own ink as presentation attributes, which sit
 * BELOW author CSS in the cascade: edge.css still governs every pixel on screen,
 * including the draw-in that owns the dash, and these only speak once the
 * stylesheet is gone.
 */
it('states a sequence edge’s ink as attributes the export can carry', () => {
  const restore = installTokens();
  try {
    const { container } = render(
      <svg>
        <SignalEdge {...edgeProps({ kind: 'sequence', index: 0 })} />
      </svg>,
    );
    const path = container.querySelector('path.sg-edge')!;
    expect(path.getAttribute('stroke')).toBe(INK['--accent']);
    expect(path.getAttribute('stroke-width')).toBe(INK['--edge-stroke']);
    expect(path.getAttribute('stroke-linecap')).toBe(INK['--edge-cap']);
    expect(path.getAttribute('opacity')).toBe(INK['--edge-opacity']);
    // the finished state of the draw-in: one dash over a path normalized to 1
    expect(path.getAttribute('stroke-dasharray')).toBe(INK['--edge-dash']);
    // and the dot, which would otherwise export as SVG's default black
    expect(container.querySelector('circle.sg-flow-dot')!.getAttribute('fill')).toBe(
      INK['--accent'],
    );
  } finally {
    restore();
  }
});

it('carries the retry edge’s ember and its dash rhythm', () => {
  const restore = installTokens();
  try {
    const { container } = render(
      <svg>
        <SignalEdge {...edgeProps({ kind: 'retry', index: 0 })} />
      </svg>,
    );
    const path = container.querySelector('path.sg-edge')!;
    expect(path.getAttribute('stroke')).toBe(INK['--ember']);
    expect(path.getAttribute('opacity')).toBe(INK['--edge-opacity-retry']);
    // the state sg-draw-dashed ends on — a retry exports dashed, as it is drawn
    expect(path.getAttribute('stroke-dasharray')).toBe(INK['--edge-dash-retry']);
  } finally {
    restore();
  }
});

// Derived from --accent and --line at render time rather than read off a frozen
// token: the installed palette here is the real one, and the mix of it IS the
// stated --edge-branch — so this goes red the day the two stop agreeing.
it('carries the branch edge’s quieter ink, mixed from the palette', () => {
  const restore = installTokens();
  try {
    const { container } = render(
      <svg>
        <SignalEdge {...edgeProps({ kind: 'branch', index: 0 })} />
      </svg>,
    );
    expect(container.querySelector('path.sg-edge')!.getAttribute('stroke')).toBe(
      INK['--edge-branch'],
    );
  } finally {
    restore();
  }
});

// The route CRITICAL PATH is pointing at draws heavier and at full strength. Same
// values `.sg-edge--critical` states in edge.css, carried as attributes for the
// same reason every other ink is: the export has no stylesheet to read them from,
// and a shared picture must agree with the screen about which run is expensive.
it('states the critical run’s heavier ink as attributes too', () => {
  const restore = installTokens();
  try {
    const { container } = render(
      <svg>
        <SignalEdge {...edgeProps({ kind: 'branch', index: 0, critical: true })} />
      </svg>,
    );
    const path = container.querySelector('path.sg-edge')!;
    expect(path.classList.contains('sg-edge--critical')).toBe(true);
    // accent, not the branch's quieter mix — the route outranks the kind
    expect(path.getAttribute('stroke')).toBe(INK['--accent']);
    expect(path.getAttribute('stroke-width')).toBe(INK['--edge-stroke-critical']);
    expect(path.getAttribute('opacity')).toBe('1');
  } finally {
    restore();
  }
});

// Nothing is invented when the tokens are absent: the attribute is left off and
// the stylesheet — which is all a browser needs — remains in charge.
it('states nothing it cannot resolve', () => {
  const { container } = render(
    <svg>
      <SignalEdge {...edgeProps({ kind: 'sequence', index: 0 })} />
    </svg>,
  );
  expect(container.querySelector('path.sg-edge')!.hasAttribute('stroke')).toBe(false);
});
