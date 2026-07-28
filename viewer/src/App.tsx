import { useState } from 'react';
import { galleryEntries } from './gallery/galleryData';
import { loadWorkflow } from './graph/load';
import type { Workflow } from './graph/types';
import { BlueprintSheet } from './components/BlueprintSheet';
import { GalleryIndex } from './components/GalleryIndex';
import { RejectedSheet } from './components/RejectedSheet';

type View =
  | { mode: 'gallery' }
  | { mode: 'sheet'; workflow: Workflow }
  | { mode: 'rejected'; errors: string[] };

const BOM = 0xfeff;

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
  // The workflow lives in view state, so the object handed to BlueprintSheet
  // keeps its identity across re-renders (its layout effect is keyed on it).
  const [view, setView] = useState<View>({ mode: 'gallery' });

  function handleFile(file: File) {
    readFileText(file).then(
      (text) => {
        let raw: unknown;
        try {
          // Editors on Windows happily save JSON with a byte-order mark; JSON.parse won't.
          raw = JSON.parse(text.charCodeAt(0) === BOM ? text.slice(1) : text);
        } catch (err) {
          setView({
            mode: 'rejected',
            errors: [`file: not valid JSON (${(err as Error).message})`],
          });
          return;
        }
        const res = loadWorkflow(raw);
        if (res.ok) setView({ mode: 'sheet', workflow: res.workflow });
        else setView({ mode: 'rejected', errors: res.errors });
      },
      (err: Error) => {
        setView({ mode: 'rejected', errors: [`file: could not be read (${err.message})`] });
      },
    );
  }

  return (
    <div className="app-shell">
      <header className="app-masthead">
        Flowprint{' '}
        <button className="masthead-sub masthead-link" onClick={() => setView({ mode: 'gallery' })}>
          drawing index
        </button>
      </header>
      <main className="app-main">
        {view.mode === 'gallery' && (
          <GalleryIndex
            entries={galleryEntries}
            onOpen={(workflow) => setView({ mode: 'sheet', workflow })}
            onDropFile={handleFile}
          />
        )}
        {view.mode === 'sheet' && <BlueprintSheet workflow={view.workflow} />}
        {view.mode === 'rejected' && (
          <RejectedSheet errors={view.errors} onBack={() => setView({ mode: 'gallery' })} />
        )}
      </main>
    </div>
  );
}
