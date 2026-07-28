import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

it('renders the drawing-index masthead', () => {
  render(<App />);
  expect(screen.getByText(/flowprint/i)).toBeInTheDocument();
  expect(screen.getByText(/drawing index/i)).toBeInTheDocument();
});

it('opens a gallery drawing into the sheet view and returns', async () => {
  render(<App />);
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
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

it('opens a valid dropped file as a sheet', async () => {
  render(<App />);
  const galleryRaw = JSON.stringify((await import('../../gallery/add-e2e-tests.workflow.json')).default);
  const input = document.querySelector('input[type="file"]')!;
  const good = new File([galleryRaw], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [good] } });
  await waitFor(() => expect(screen.getByTestId('sheet')).toBeInTheDocument());
});
