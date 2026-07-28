import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the drawing-index masthead', () => {
  render(<App />);
  expect(screen.getByText(/flowprint/i)).toBeInTheDocument();
  expect(screen.getByText(/drawing index/i)).toBeInTheDocument();
});
