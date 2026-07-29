import { loadWorkflow } from '../graph/load';
import type { Workflow } from '../graph/types';

// Eager glob: every committed gallery drawing is validated and frozen into a
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

export const galleryEntries: GalleryEntry[] = Object.entries(modules)
  .map(([path, raw]) => {
    const res = loadWorkflow(raw);
    if (!res.ok) return null;
    const slug = path.split('/').pop()!.replace('.workflow.json', '');
    return { slug, workflow: res.workflow };
  })
  .filter((e): e is GalleryEntry => e !== null)
  .sort((a, b) => a.workflow.meta.title.localeCompare(b.workflow.meta.title));
