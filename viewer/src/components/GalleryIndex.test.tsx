import { fireEvent, render, screen } from '@testing-library/react';
import { GalleryIndex } from './GalleryIndex';
import { galleryEntries } from '../gallery/galleryData';

// The same glob galleryData loads from, asked only for its KEYS: the count of
// committed graphs, before any of them has been through the validator.
const committedFiles = import.meta.glob('../../../gallery/*.workflow.json');

// A graph that fails the loader is filtered out of the grid SILENTLY — the one
// failure mode of a curated gallery that nothing else would notice, because the
// page still renders, just one card short.
it('loads every committed gallery graph — none dropped by the loader', () => {
  expect(galleryEntries.length).toBe(Object.keys(committedFiles).length);
});

it('opens with the flagship, then reads alphabetically by title', () => {
  expect(galleryEntries[0].slug).toBe('ship-a-payments-feature');
  const rest = galleryEntries.slice(1).map((e) => e.workflow.meta.title);
  expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
});

it('lists every committed gallery graph with node count and max pain', () => {
  const onOpen = vi.fn();
  render(<GalleryIndex entries={galleryEntries} onOpen={onOpen} onDropFile={vi.fn()} />);
  expect(galleryEntries.length).toBeGreaterThan(0);
  for (const e of galleryEntries) {
    // natural case, exactly as the graph's author wrote it
    expect(screen.getByText(e.workflow.meta.title)).toBeInTheDocument();
  }
  fireEvent.click(screen.getAllByText('OPEN GRAPH')[0]);
  expect(onOpen).toHaveBeenCalledWith(galleryEntries[0].workflow);
});

it('reads max pain as ember dots, one per level', () => {
  const { container } = render(
    <GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={vi.fn()} />,
  );
  const dots = [...container.querySelectorAll('.sg-card-pain')];
  expect(dots.length).toBe(galleryEntries.length);
  for (const [i, el] of dots.entries()) {
    const maxPain = Math.max(...galleryEntries[i].workflow.nodes.map((n) => n.painLevel));
    expect(el.textContent).toBe('●'.repeat(maxPain));
    expect(el.getAttribute('data-pain')).toBe(String(maxPain));
  }
});

it('shows the drop target invitation', () => {
  render(<GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={vi.fn()} />);
  expect(screen.getByText(/drop a \.workflow\.json/i)).toBeInTheDocument();
});

// Visually hidden, not `hidden`: keyboard users still reach the browse control.
it('keeps the file input in the tab order behind the drop card', () => {
  const { container } = render(
    <GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={vi.fn()} />,
  );
  const input = container.querySelector('input.sg-card-drop-input')!;
  expect(input).not.toBeNull();
  expect(input.hasAttribute('hidden')).toBe(false);
  expect(input.getAttribute('type')).toBe('file');
});

it('hands a dragged-and-dropped file to onDropFile', () => {
  const onDropFile = vi.fn();
  const { container } = render(
    <GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={onDropFile} />,
  );
  const surface = container.querySelector('.sg-gallery')!;
  const file = new File(['{}'], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.drop(surface, { dataTransfer: { files: [file] } });
  expect(onDropFile).toHaveBeenCalledWith(file);
});
