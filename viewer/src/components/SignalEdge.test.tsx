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

function edgeProps(data: { kind: EdgeKind; label?: string; index: number }): EdgeProps {
  return { ...PORTS, data } as EdgeProps;
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

it('EdgeTag renders one span per wrapped line', () => {
  const { getByTestId } = render(
    <EdgeTag lines={['flaky selector /', 'timing race']} kind="retry" x={10} y={50} />,
  );
  const spans = getByTestId('edge-tag').querySelectorAll('span');
  expect(spans).toHaveLength(2);
  expect(spans[0].textContent).toBe('flaky selector /');
  expect(spans[1].textContent).toBe('timing race');
});

it('EdgeTag marks retry edges and leaves other kinds unmarked', () => {
  const { getByTestId, unmount } = render(
    <EdgeTag lines={['retrying']} kind="retry" x={0} y={0} />,
  );
  expect(getByTestId('edge-tag').classList.contains('sg-edge-tag--retry')).toBe(true);
  unmount();
  const { getByTestId: get2 } = render(<EdgeTag lines={['CI green']} kind="branch" x={0} y={0} />);
  expect(get2('edge-tag').classList.contains('sg-edge-tag--retry')).toBe(false);
});

it('EdgeTag centres itself on the label point', () => {
  const { getByTestId } = render(<EdgeTag lines={['mid']} kind="sequence" x={120} y={64} />);
  const style = getByTestId('edge-tag').getAttribute('style')!;
  expect(style).toContain('translate(-50%, -50%)');
  expect(style).toContain('translate(120px, 64px)');
});
