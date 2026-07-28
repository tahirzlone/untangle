import type { WorkflowMeta } from '../graph/types';

export function TitleBlock({ meta, nodeCount }: { meta: WorkflowMeta; nodeCount: number }) {
  const date = meta.generatedAt.slice(0, 10);
  return (
    <div className="bp-titleblock" data-testid="title-block">
      <div className="bp-titleblock-title">{meta.title.toUpperCase()}</div>
      <dl className="bp-titleblock-grid">
        <div><dt>DRAWN BY</dt><dd>CLAUDE — {meta.model}</dd></div>
        <div><dt>DATE</dt><dd>{date}</dd></div>
        <div><dt>NODES</dt><dd>{nodeCount}</dd></div>
        <div><dt>SHEET</dt><dd>1 OF 1</dd></div>
        <div><dt>SCALE</dt><dd>N.T.S.</dd></div>
        <div><dt>REV</dt><dd>REV A</dd></div>
        <div className="bp-titleblock-kb">
          <dt>KB</dt>
          <dd>{meta.kbSource === 'airtable' ? 'AIRTABLE' : 'KB NOT LINKED'}</dd>
        </div>
      </dl>
    </div>
  );
}
