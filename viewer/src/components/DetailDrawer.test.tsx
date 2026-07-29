import { fireEvent, render, screen } from '@testing-library/react';
import { DetailDrawer } from './DetailDrawer';
import type { WorkflowNode } from '../graph/types';

const node = (over: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id: 'debug-flaky',
  label: 'Debug flaky selectors & timing races',
  kind: 'process',
  description:
    'Re-run single specs over and over to reproduce intermittent failures, chase races with animations and late-loading data.',
  painLevel: 5,
  ...over,
});

it('states the node in full: kind, label, pain, description', () => {
  render(<DetailDrawer node={node()} onClose={() => {}} />);

  expect(screen.getByTestId('detail-drawer')).toBeInTheDocument();
  expect(screen.getByText('Debug flaky selectors & timing races')).toBeInTheDocument();
  expect(screen.getByTestId('drawer-kind')).toHaveTextContent('process');
  expect(screen.getByText(/Re-run single specs over and over/)).toBeInTheDocument();
});

// The card clamps its description to three lines; the drawer is where the whole
// paragraph finally gets read, so the full string must be present verbatim.
it('carries the description unclamped and uncut', () => {
  const n = node();
  render(<DetailDrawer node={n} onClose={() => {}} />);
  expect(screen.getByTestId('drawer-desc')).toHaveTextContent(n.description);
});

it('reuses the five-segment pain meter at the node’s level', () => {
  render(<DetailDrawer node={node({ painLevel: 3 })} onClose={() => {}} />);
  expect(screen.getByTestId('sg-meter')).toHaveAttribute('data-pain', '3');
  expect(screen.getAllByTestId('sg-meter-seg')).toHaveLength(5);
});

// Task 4 fills this section with suggestion cards; until then it is deliberately
// present and deliberately empty.
it('holds an empty suggestions section', () => {
  render(<DetailDrawer node={node()} onClose={() => {}} />);
  expect(screen.getByTestId('drawer-suggestions')).toBeEmptyDOMElement();
});

it('closes on the X button', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.click(screen.getByTestId('drawer-close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes on Escape from anywhere', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('ignores every other key', () => {
  const onClose = vi.fn();
  render(<DetailDrawer node={node()} onClose={onClose} />);

  fireEvent.keyDown(window, { key: 'a' });
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onClose).not.toHaveBeenCalled();
});

// A listener that outlives its drawer would keep firing onClose for a panel that
// is no longer on screen.
it('stops listening once unmounted', () => {
  const onClose = vi.fn();
  const { unmount } = render(<DetailDrawer node={node()} onClose={onClose} />);

  unmount();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});
