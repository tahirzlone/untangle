import { useCallback, useEffect, useState } from 'react';
import { galleryEntries } from './gallery/galleryData';
import { decodeFragment, graphPayload, withoutBom } from './graph/fragment';
import { loadWorkflow } from './graph/load';
import type { Workflow } from './graph/types';
import { GraphCanvas } from './components/GraphCanvas';
import { GalleryIndex } from './components/GalleryIndex';
import { RejectedSheet } from './components/RejectedSheet';

type View =
  | { mode: 'gallery' }
  | { mode: 'graph'; workflow: Workflow }
  | { mode: 'rejected'; errors: string[] };

// FileReader rather than `file.text()`: the latter is unimplemented in jsdom's
// Blob (26.x) and in older Safari, and this is the one place the app touches
// the file system surface. Same result, everywhere.
function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('could not be read'));
    reader.readAsText(file);
  });
}

export default function App() {
  // The workflow lives in view state, so the object handed to GraphCanvas
  // keeps its identity across re-renders (its layout effect is keyed on it).
  const [view, setView] = useState<View>({ mode: 'gallery' });

  const handleFile = useCallback((file: File) => {
    readFileText(file).then(
      (text) => {
        let raw: unknown;
        try {
          // Editors on Windows happily save JSON with a byte-order mark; JSON.parse won't.
          raw = JSON.parse(withoutBom(text));
        } catch (err) {
          setView({
            mode: 'rejected',
            errors: [`file: not valid JSON (${(err as Error).message})`],
          });
          return;
        }
        const res = loadWorkflow(raw);
        if (res.ok) setView({ mode: 'graph', workflow: res.workflow });
        else setView({ mode: 'rejected', errors: res.errors });
      },
      (err: Error) => {
        setView({ mode: 'rejected', errors: [`file: could not be read (${err.message})`] });
      },
    );
  }, []);

  // A `#g=` link opens straight into the graph it carries — the same two
  // outcomes a dropped file has, reached from the address bar. Once, on mount:
  // the app is root-only, and the one hash change it makes is its own.
  useEffect(() => {
    let live = true;
    decodeFragment(window.location.hash).then((res) => {
      if (!live || res === null) return;
      const arrived: View = res.ok
        ? { mode: 'graph', workflow: res.workflow }
        : { mode: 'rejected', errors: res.errors };
      // Nobody waits on the decode. A file dropped — or a gallery graph opened —
      // while it was in flight owns the view, and a link landing afterwards does
      // not take it back.
      setView((current) => (current.mode === 'gallery' ? arrived : current));
    });
    return () => {
      live = false;
    };
  }, []);

  // The URL must not claim a graph that is not on screen: a `#g=` link is spent
  // the moment the view leaves what it carried. replaceState rather than a hash
  // write, which would push an entry and leave Back pointing at a link the app
  // has already consumed.
  const forgetLink = useCallback(() => {
    if (graphPayload(window.location.hash) === null) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const showGallery = useCallback(() => {
    forgetLink();
    setView({ mode: 'gallery' });
  }, [forgetLink]);

  const showGraph = useCallback(
    (workflow: Workflow) => {
      forgetLink();
      setView({ mode: 'graph', workflow });
    },
    [forgetLink],
  );

  // Drop is an app-wide affordance, not a gallery-only one. Without a window
  // guard the browser takes the default action for a dropped file — it
  // navigates away from the SPA to render the JSON — from every view except the
  // index. Guarding at the window both stops that and makes drop work
  // everywhere: on the graph canvas, on the rejection panel, on the masthead.
  useEffect(() => {
    function onDragOver(ev: globalThis.DragEvent) {
      ev.preventDefault();
    }
    function onDrop(ev: globalThis.DragEvent) {
      if (ev.defaultPrevented) return; // GalleryIndex's own drop already handled it
      ev.preventDefault();
      const file = ev.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFile]);

  return (
    <div className="app-shell">
      <header className="app-masthead">
        Untangle{' '}
        <button className="masthead-sub masthead-link" onClick={showGallery}>
          graph index
        </button>
      </header>
      <main className="app-main">
        {view.mode === 'gallery' && (
          <GalleryIndex entries={galleryEntries} onOpen={showGraph} onDropFile={handleFile} />
        )}
        {view.mode === 'graph' && <GraphCanvas workflow={view.workflow} />}
        {view.mode === 'rejected' && <RejectedSheet errors={view.errors} onBack={showGallery} />}
      </main>
    </div>
  );
}
