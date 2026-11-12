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
    <div className="sg-gallery" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <div className="sg-gallery-grid">
        {entries.map((e) => {
          const maxPain = Math.max(...e.workflow.nodes.map((n) => n.painLevel));
          const upgrades = e.workflow.suggestions.length;
          return (
            <article key={e.slug} className="sg-card">
              <div className="sg-card-title">{e.workflow.meta.title}</div>
              <dl className="sg-card-meta">
                <div>
                  <dt>nodes</dt>
                  <dd>{e.workflow.nodes.length}</dd>
                </div>
                <div>
                  <dt>max pain</dt>
                  <dd className="sg-card-pain" data-pain={maxPain}>
                    {'●'.repeat(maxPain)}
                  </dd>
                </div>
                {/* The signpost: how many upgrades OPTIMIZE has waiting behind
                    this card — "upgrades" is the word the Results Window will
                    greet them with. A graph the KB matched nothing to gets no
                    chip at all: the same honesty as the canvas, where the
                    button itself is absent. The dt is the accessible label,
                    exactly as it is for the card's other stats. */}
                {upgrades > 0 ? (
                  <div>
                    <dt>{upgrades === 1 ? 'upgrade' : 'upgrades'}</dt>
                    <dd className="sg-card-upgrades">{upgrades}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>generated</dt>
                  <dd>{e.workflow.meta.generatedAt.slice(0, 10)}</dd>
                </div>
              </dl>
              <button className="sg-card-open" onClick={() => onOpen(e.workflow)}>
                OPEN GRAPH
              </button>
            </article>
          );
        })}
        <label className="sg-card sg-card--drop">
          <span>DROP A .WORKFLOW.JSON HERE</span>
          <span className="sg-card-drop-sub">or click to browse — files from out/ open too</span>
          <input
            type="file"
            accept=".json,application/json"
            className="sg-card-drop-input"
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
