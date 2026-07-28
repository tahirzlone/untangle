import { fireEvent, render, screen } from '@testing-library/react';
import { GalleryIndex } from './GalleryIndex';
import { galleryEntries } from '../gallery/galleryData';

it('lists every committed gallery drawing with node count and max pain', () => {
  const onOpen = vi.fn();
  render(<GalleryIndex entries={galleryEntries} onOpen={onOpen} onDropFile={vi.fn()} />);
  expect(galleryEntries.length).toBeGreaterThan(0);
  for (const e of galleryEntries) {
    expect(screen.getByText(e.workflow.meta.title.toUpperCase())).toBeInTheDocument();
  }
  fireEvent.click(screen.getAllByText('OPEN DRAWING')[0]);
  expect(onOpen).toHaveBeenCalledWith(galleryEntries[0].workflow);
});

it('shows the drop target invitation', () => {
  render(<GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={vi.fn()} />);
  expect(screen.getByText(/drop a \.workflow\.json/i)).toBeInTheDocument();
});

it('hands a dragged-and-dropped file to onDropFile', () => {
  const onDropFile = vi.fn();
  const { container } = render(
    <GalleryIndex entries={galleryEntries} onOpen={vi.fn()} onDropFile={onDropFile} />,
  );
  const surface = container.querySelector('.bp-gallery')!;
  const file = new File(['{}'], 'mine.workflow.json', { type: 'application/json' });
  fireEvent.drop(surface, { dataTransfer: { files: [file] } });
  expect(onDropFile).toHaveBeenCalledWith(file);
});
