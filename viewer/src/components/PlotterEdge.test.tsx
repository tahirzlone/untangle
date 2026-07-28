import { render } from '@testing-library/react';
import { PlotterEdgePath } from './PlotterEdge';

const pts = [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }];

it('renders a retry edge dashed in checker red with its label', () => {
  const { container, getByText } = render(
    <svg><PlotterEdgePath points={pts} kind="retry" label="flaky - fix and rerun" index={2} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.getAttribute('d')).toBe('M 0 0 L 0 40 L 60 40');
  expect(path.classList.contains('bp-edge--retry')).toBe(true);
  expect(getByText('flaky - fix and rerun')).toBeInTheDocument();
});

it('renders sequence edges solid without a label element', () => {
  const { container } = render(
    <svg><PlotterEdgePath points={pts} kind="sequence" index={0} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.classList.contains('bp-edge--retry')).toBe(false);
  expect(container.querySelector('.bp-edge-label')).toBeNull();
});
