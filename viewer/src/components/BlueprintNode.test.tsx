import { render, screen } from '@testing-library/react';
import { BlueprintNodeBody } from './BlueprintNode';
import type { WorkflowNode } from '../graph/types';

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: 'test-node',
  label: 'Debug flaky selectors',
  kind: 'process',
  description: 'Chase timing-dependent failures.',
  painLevel: 4,
  ...over,
});

it('renders label, kind eyebrow, and pain attributes', () => {
  render(<BlueprintNodeBody node={node()} />);
  expect(screen.getByText('Debug flaky selectors')).toBeInTheDocument();
  expect(screen.getByText('PROC')).toBeInTheDocument();
  const el = screen.getByTestId('bp-node');
  expect(el).toHaveAttribute('data-kind', 'process');
  expect(el).toHaveAttribute('data-pain', '4');
});

it('renders one tally stroke per pain level', () => {
  render(<BlueprintNodeBody node={node({ painLevel: 5 })} />);
  expect(screen.getAllByTestId('pain-tick')).toHaveLength(5);
});

it('marks decision nodes with the diamond modifier', () => {
  render(<BlueprintNodeBody node={node({ kind: 'decision' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--decision');
  expect(screen.getByText('DEC')).toBeInTheDocument();
});

it('uses terminal styling for input and output', () => {
  const { rerender } = render(<BlueprintNodeBody node={node({ kind: 'input' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--input');
  rerender(<BlueprintNodeBody node={node({ kind: 'output' })} />);
  expect(screen.getByTestId('bp-node').className).toContain('bp-node--output');
});
