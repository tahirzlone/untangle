import { render } from '@testing-library/react';
import { EdgeTag, PlotterEdgePath } from './PlotterEdge';

const pts = [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }];

it('renders a retry edge dashed in checker red', () => {
  const { container } = render(
    <svg><PlotterEdgePath points={pts} kind="retry" index={2} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.getAttribute('d')).toBe('M 0 0 L 0 40 L 60 40');
  expect(path.classList.contains('bp-edge--retry')).toBe(true);
  expect(path.getAttribute('marker-end')).toBe('url(#fp-arrow)');
});

it('renders sequence edges solid and draws no text in the edge svg', () => {
  const { container } = render(
    <svg><PlotterEdgePath points={pts} kind="sequence" index={0} /></svg>,
  );
  const path = container.querySelector('path.bp-edge')!;
  expect(path.classList.contains('bp-edge--retry')).toBe(false);
  expect(container.querySelector('text')).toBeNull();
});

it('EdgeTag renders one span per wrapped line', () => {
  const { getByTestId } = render(
    <EdgeTag lines={['flaky selector /', 'timing race']} kind="retry" anchor={{ x: 10, y: 50, vertical: true }} />,
  );
  const spans = getByTestId('edge-tag').querySelectorAll('span');
  expect(spans).toHaveLength(2);
  expect(spans[0].textContent).toBe('flaky selector /');
  expect(spans[1].textContent).toBe('timing race');
});

it('EdgeTag marks retry edges and leaves other kinds unmarked', () => {
  const { getByTestId, unmount } = render(
    <EdgeTag lines={['retrying']} kind="retry" anchor={{ x: 0, y: 0, vertical: false }} />,
  );
  expect(getByTestId('edge-tag').classList.contains('bp-edge-tag--retry')).toBe(true);
  unmount();
  const { getByTestId: get2 } = render(
    <EdgeTag lines={['CI green']} kind="branch" anchor={{ x: 0, y: 0, vertical: false }} />,
  );
  expect(get2('edge-tag').classList.contains('bp-edge-tag--retry')).toBe(false);
});

it('EdgeTag sits beside a vertical run and above a horizontal one', () => {
  const { getByTestId, unmount } = render(
    <EdgeTag lines={['vertical']} kind="sequence" anchor={{ x: 10, y: 50, vertical: true }} />,
  );
  const vertical = getByTestId('edge-tag').getAttribute('style')!;
  expect(vertical).toContain('translate(0, -50%)');
  expect(vertical).toContain('translate(18px, 50px)');
  unmount();
  const { getByTestId: get2 } = render(
    <EdgeTag lines={['horizontal']} kind="sequence" anchor={{ x: 10, y: 50, vertical: false }} />,
  );
  const horizontal = get2('edge-tag').getAttribute('style')!;
  expect(horizontal).toContain('translate(-50%, -100%)');
  expect(horizontal).toContain('translate(10px, 44px)');
});
