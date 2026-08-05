import { loadWorkflow } from '../graph/load';
import type { Workflow } from '../graph/types';

// Eager glob: every committed gallery graph is validated and frozen into a
// module-level array at import time. Entries are therefore referentially stable
// for the life of the page — GraphCanvas's layout effect keys off the
// workflow object identity, so a fresh object per render would re-run ELK.
const modules = import.meta.glob('../../../gallery/*.workflow.json', {
  eager: true,
  import: 'default',
});

export interface GalleryEntry {
  slug: string;
  workflow: Workflow;
}

/**
 * The graph the grid opens with — the exemplar the gallery is judged by, and the
 * one every other entry is a variation on. Pinned by SLUG rather than by title,
 * because the title is prose its author may reword and the filename is the
 * identity the repo actually keys on. Everything else is alphabetical by title:
 * a stable reading order that no one has to maintain as graphs are added.
 *
 * A slug that names no file is not an error worth throwing over — the flagship
 * simply is not there and the rest of the grid sorts normally.
 */
const FLAGSHIP_SLUG = 'ship-a-payments-feature';

export const galleryEntries: GalleryEntry[] = Object.entries(modules)
  .map(([path, raw]) => {
    const res = loadWorkflow(raw);
    if (!res.ok) return null;
    const slug = path.split('/').pop()!.replace('.workflow.json', '');
    return { slug, workflow: res.workflow };
  })
  .filter((e): e is GalleryEntry => e !== null)
  .sort(
    (a, b) =>
      Number(b.slug === FLAGSHIP_SLUG) - Number(a.slug === FLAGSHIP_SLUG) ||
      a.workflow.meta.title.localeCompare(b.workflow.meta.title),
  );
