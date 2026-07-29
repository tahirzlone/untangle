import { render, screen, waitFor } from '@testing-library/react';
import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from '../graph/load';
import { BlueprintSheet } from './BlueprintSheet';

const wf = (() => {
  const res = loadWorkflow(gallery);
  if (!res.ok) throw new Error('fixture invalid');
  return res.workflow;
})();

it('renders the full sheet: title block, every node, zone rulers', async () => {
  render(<BlueprintSheet workflow={wf} />);
  await waitFor(() => {
    expect(screen.getAllByTestId('sg-node')).toHaveLength(wf.nodes.length);
  });
  expect(screen.getByText(wf.meta.title.toUpperCase())).toBeInTheDocument();
  expect(screen.getByText(/drawn by/i)).toBeInTheDocument();
  expect(screen.getByText('REV A')).toBeInTheDocument();
  expect(screen.getByText('N.T.S.')).toBeInTheDocument();
  expect(screen.getByText('KB NOT LINKED')).toBeInTheDocument();
  expect(screen.getByTestId('zone-ruler-top')).toBeInTheDocument();
});

it('plots every edge and staples a tag over each labelled one', async () => {
  const { container } = render(<BlueprintSheet workflow={wf} />);
  await waitFor(() => {
    expect(screen.getAllByTestId('sg-node')).toHaveLength(wf.nodes.length);
  });

  // the whole edge layer reaches the DOM through the real React Flow pipeline
  expect(container.querySelectorAll('path.bp-edge')).toHaveLength(wf.edges.length);

  const labelled = wf.edges.filter((e) => e.label);
  const tags = screen.getAllByTestId('edge-tag');
  expect(tags).toHaveLength(labelled.length);

  // short label: one span, matchable whole
  expect(screen.getByText('CI green')).toBeInTheDocument();

  // the long label that used to be clipped by nodes on both sides
  const wrapped = tags.find((t) => t.textContent?.startsWith('changes requested'));
  expect(wrapped).toBeDefined();
  expect(wrapped!.querySelectorAll('span').length).toBeGreaterThanOrEqual(2);
  expect(wrapped!.textContent).toContain('tighter');

  // retry tags are marked so they can be inked in checker red
  const retryCount = labelled.filter((e) => e.kind === 'retry').length;
  expect(tags.filter((t) => t.classList.contains('bp-edge-tag--retry'))).toHaveLength(retryCount);
});
