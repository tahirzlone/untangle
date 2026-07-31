import { render, screen } from '@testing-library/react';
import { SignalNodeBody } from './SignalNode';
import enriched from '../test/fixtures/enriched.workflow.json';
import type { NodeKind, Suggestion, WorkflowNode } from '../graph/types';

const KINDS: NodeKind[] = ['input', 'process', 'decision', 'loop', 'review', 'output'];

/** Real rows off the enriched fixture — the pip counts what the KB matched. */
const matched = (nodeId: string): Suggestion[] =>
  (enriched.suggestions as Suggestion[]).filter((s) => s.nodeId === nodeId);

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: 'test-node',
  label: 'Debug flaky selectors',
  kind: 'process',
  description: 'Chase timing-dependent failures.',
  painLevel: 4,
  ...over,
});

it('renders the label, the kind chip abbreviation, and pain attributes', () => {
  render(<SignalNodeBody node={node()} />);
  expect(screen.getByText('Debug flaky selectors')).toBeInTheDocument();
  expect(screen.getByText('PR')).toBeInTheDocument();
  expect(screen.getByText('Chase timing-dependent failures.')).toBeInTheDocument();

  const el = screen.getByTestId('sg-node');
  expect(el).toHaveAttribute('data-kind', 'process');
  expect(el).toHaveAttribute('data-pain', '4');
  expect(el).toHaveAttribute('title', 'Chase timing-dependent failures.');
});

it('abbreviates every kind in the icon chip', () => {
  const abbrs: Record<NodeKind, string> = {
    input: 'IN',
    process: 'PR',
    decision: 'DC',
    loop: 'LP',
    review: 'RV',
    output: 'OUT',
  };
  for (const kind of KINDS) {
    const { unmount } = render(<SignalNodeBody node={node({ kind })} />);
    expect(screen.getByText(abbrs[kind])).toBeInTheDocument();
    unmount();
  }
});

it('renders a five-segment pain meter whose container carries the level', () => {
  render(<SignalNodeBody node={node({ painLevel: 2 })} />);
  expect(screen.getAllByTestId('sg-meter-seg')).toHaveLength(5);
  expect(screen.getByTestId('sg-meter')).toHaveAttribute('data-pain', '2');
});

it('marks pain 5 hot, pain 4 warm, and leaves pain 3 unglowed', () => {
  const { rerender } = render(<SignalNodeBody node={node({ painLevel: 5 })} />);
  expect(screen.getByTestId('sg-node').className).toContain('sg-node--hot');

  rerender(<SignalNodeBody node={node({ painLevel: 4 })} />);
  expect(screen.getByTestId('sg-node').className).toContain('sg-node--warm');
  expect(screen.getByTestId('sg-node').className).not.toContain('sg-node--hot');

  rerender(<SignalNodeBody node={node({ painLevel: 3 })} />);
  expect(screen.getByTestId('sg-node').className).not.toContain('--hot');
  expect(screen.getByTestId('sg-node').className).not.toContain('--warm');
});

it('pips the card with how many suggestions matched it', () => {
  const two = matched('verify-browser');
  expect(two).toHaveLength(2);

  const { rerender } = render(<SignalNodeBody node={node()} suggestions={two} />);
  expect(screen.getByTestId('sg-badge')).toHaveTextContent('2');

  rerender(<SignalNodeBody node={node()} suggestions={matched('research-docs')} />);
  expect(screen.getByTestId('sg-badge')).toHaveTextContent('1');
});

// Most nodes match nothing, and a pip reading "0" would be a claim about the KB
// that the KB never made.
it('wears no pip when nothing matched it', () => {
  const { rerender } = render(<SignalNodeBody node={node()} />);
  expect(screen.queryByTestId('sg-badge')).not.toBeInTheDocument();

  rerender(<SignalNodeBody node={node()} suggestions={[]} />);
  expect(screen.queryByTestId('sg-badge')).not.toBeInTheDocument();
});

// The pip straddles the card's corner, so it cannot live inside the card — the
// card clips its own overflow to keep its rounded border. Sibling, not child.
it('hangs the pip outside the clipped card', () => {
  render(<SignalNodeBody node={node()} suggestions={matched('verify-browser')} />);
  expect(screen.getByTestId('sg-node')).not.toContainElement(screen.getByTestId('sg-badge'));
});

/**
 * The middle of the work is uniform — the ONE thing a card's kind changes is
 * whether it is an end of the graph.
 *
 * The exact-match is what forbids the old kind-shaped variants coming back: a
 * `sg-node--decision` would fail this outright, while start and end are named
 * for what they are rather than for the kind that produces them.
 */
it('carries no kind-shaped variant classes but the two ends', () => {
  const ENDS: Partial<Record<NodeKind, string>> = {
    input: 'sg-node sg-node--start',
    output: 'sg-node sg-node--end',
  };
  for (const kind of KINDS) {
    const { unmount } = render(<SignalNodeBody node={node({ kind, painLevel: 1 })} />);
    const el = screen.getByTestId('sg-node');
    expect(el.className).toBe(ENDS[kind] ?? 'sg-node');
    expect(el.className).not.toContain(`--${kind}`);
    unmount();
  }
});

// Kind-driven and nothing else: a graph may open in two places and finish in two
// others, and every one of them is an end of the work.
it('states which end of the work each endpoint card is', () => {
  const { rerender } = render(<SignalNodeBody node={node({ kind: 'input' })} />);
  let chip = screen.getByTestId('sg-endpoint');
  expect(chip).toHaveTextContent('START');
  expect(chip).toHaveAttribute('data-endpoint', 'start');

  rerender(<SignalNodeBody node={node({ kind: 'output' })} />);
  chip = screen.getByTestId('sg-endpoint');
  expect(chip).toHaveTextContent('END');
  expect(chip).toHaveAttribute('data-endpoint', 'end');
});

it('wears no endpoint chip on a step in the middle of the work', () => {
  for (const kind of KINDS.filter((k) => k !== 'input' && k !== 'output')) {
    const { unmount } = render(<SignalNodeBody node={node({ kind })} />);
    expect(screen.queryByTestId('sg-endpoint')).not.toBeInTheDocument();
    unmount();
  }
});

// Same bargain as the pip, on the other corner: the card clips its own overflow,
// so a chip drawn inside it would lose the half that straddles the border — and
// the two never collide on an output step the KB matched.
it('hangs the endpoint chip outside the clipped card, beside the pip', () => {
  render(
    <SignalNodeBody node={node({ kind: 'output' })} suggestions={matched('verify-browser')} />,
  );
  const chip = screen.getByTestId('sg-endpoint');
  expect(screen.getByTestId('sg-node')).not.toContainElement(chip);
  expect(screen.getByTestId('sg-badge')).not.toContainElement(chip);
});
