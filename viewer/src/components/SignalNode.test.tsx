import { render, screen } from '@testing-library/react';
import { SignalNodeBody } from './SignalNode';
import type { NodeKind, WorkflowNode } from '../graph/types';

const KINDS: NodeKind[] = ['input', 'process', 'decision', 'loop', 'review', 'output'];

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

it('carries no kind-shaped variant classes — every card is uniform', () => {
  for (const kind of KINDS) {
    const { unmount } = render(<SignalNodeBody node={node({ kind, painLevel: 1 })} />);
    const el = screen.getByTestId('sg-node');
    expect(el.className).toBe('sg-node');
    expect(el.className).not.toContain(`--${kind}`);
    expect(el.className).not.toContain('bp-node');
    unmount();
  }
});
