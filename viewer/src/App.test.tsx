import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

it('renders the drawing-index masthead', () => {
  render(<App />);
  expect(screen.getByText(/flowprint/i)).toBeInTheDocument();
  expect(screen.getByText(/drawing index/i)).toBeInTheDocument();
});

it('opens a gallery drawing into the canvas view and returns', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
  fireEvent.click(screen.getByText(/drawing index/i));
  expect(screen.getAllByText('OPEN DRAWING').length).toBeGreaterThan(0);
});

it('shows DRAWING REJECTED for an invalid dropped file', async () => {
  render(<App />);
  const input = document.querySelector('input[type="file"]')!;
  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-sheet')).toBeInTheDocument());
  expect(screen.getByText('DRAWING REJECTED')).toBeInTheDocument();
  fireEvent.click(screen.getByText('BACK TO DRAWING INDEX'));
  expect(screen.getAllByText('OPEN DRAWING').length).toBeGreaterThan(0);
});

it('shows DRAWING REJECTED for a file that is not JSON at all', async () => {
  render(<App />);
  const input = document.querySelector('input[type="file"]')!;
  const bad = new File(['not json {{{'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-sheet')).toBeInTheDocument());
  expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
});

it('opens a valid dropped file onto the canvas', async () => {
  render(<App />);
  const galleryRaw = JSON.stringify((await import('../../gallery/add-e2e-tests.workflow.json')).default);
  const input = document.querySelector('input[type="file"]')!;
  const good = new File([galleryRaw], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [good] } });
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());
});

// Drop is a window-level affordance, not a gallery-only one: without the app-wide
// guard the browser navigates away from the SPA to render the dropped file.
it('opens a valid file dropped while a graph is already on the canvas', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  const raw = (await import('../../gallery/add-e2e-tests.workflow.json')).default as Record<
    string,
    unknown
  >;
  const renamed = JSON.stringify({
    ...raw,
    meta: { ...(raw.meta as Record<string, unknown>), title: 'Dropped in canvas view' },
  });
  const good = new File([renamed], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.drop(document.body, { dataTransfer: { files: [good] } });

  await waitFor(() => expect(screen.getByText('Dropped in canvas view')).toBeInTheDocument());
  expect(screen.getByTestId('canvas')).toBeInTheDocument();
});

it('rejects an invalid file dropped while a graph is already on the canvas', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  await waitFor(() => expect(screen.getByTestId('canvas')).toBeInTheDocument());

  const bad = new File(['{"meta":{}}'], 'bad.workflow.json', { type: 'application/json' });
  fireEvent.drop(document.body, { dataTransfer: { files: [bad] } });
  await waitFor(() => expect(screen.getByTestId('rejected-sheet')).toBeInTheDocument());
});
