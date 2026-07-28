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
    expect(screen.getAllByTestId('bp-node')).toHaveLength(wf.nodes.length);
  });
  expect(screen.getByText(wf.meta.title.toUpperCase())).toBeInTheDocument();
  expect(screen.getByText(/drawn by/i)).toBeInTheDocument();
  expect(screen.getByText('REV A')).toBeInTheDocument();
  expect(screen.getByText('N.T.S.')).toBeInTheDocument();
  expect(screen.getByText('KB NOT LINKED')).toBeInTheDocument();
  expect(screen.getByTestId('zone-ruler-top')).toBeInTheDocument();
});
