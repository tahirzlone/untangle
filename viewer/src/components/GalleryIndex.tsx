import type { DragEvent } from 'react';
import type { GalleryEntry } from '../gallery/galleryData';
import type { Workflow } from '../graph/types';
import './gallery.css';

export function GalleryIndex({
  entries,
  onOpen,
  onDropFile,
}: {
  entries: GalleryEntry[];
  onOpen: (wf: Workflow) => void;
  onDropFile: (file: File) => void;
}) {
  function handleDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  }

  return (
    <div className="bp-gallery" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="bp-gallery-grid">
        {entries.map((e) => {
          const maxPain = Math.max(...e.workflow.nodes.map((n) => n.painLevel));
          return (
            <article key={e.slug} className="bp-card">
              <div className="bp-card-title">{e.workflow.meta.title.toUpperCase()}</div>
              <dl className="bp-card-meta">
                <div>
                  <dt>NODES</dt>
                  <dd>{e.workflow.nodes.length}</dd>
                </div>
                <div>
                  <dt>MAX PAIN</dt>
                  <dd className="bp-card-pain" data-pain={maxPain}>
                    {'/'.repeat(maxPain)}
                  </dd>
                </div>
                <div>
                  <dt>DATE</dt>
                  <dd>{e.workflow.meta.generatedAt.slice(0, 10)}</dd>
                </div>
              </dl>
              <button className="bp-card-open" onClick={() => onOpen(e.workflow)}>
                OPEN DRAWING
              </button>
            </article>
          );
        })}
        <label className="bp-card bp-card--drop">
          <span>DROP A .WORKFLOW.JSON HERE</span>
          <span className="bp-card-drop-sub">or click to browse — files from out/ open too</span>
          <input
            type="file"
            accept=".json,application/json"
            className="bp-card-drop-input"
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              if (file) onDropFile(file);
              ev.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
