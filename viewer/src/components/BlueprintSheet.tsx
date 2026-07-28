import { useEffect, useState } from 'react';
import { ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Workflow } from '../graph/types';
import { layoutWorkflow, type LaidOutGraph } from '../graph/layout';
import { BlueprintNode } from './BlueprintNode';
import { PlotterEdge } from './PlotterEdge';
import { TitleBlock } from './TitleBlock';
import { ZoneRuler } from './ZoneRuler';
import './sheet.css';

const nodeTypes = { blueprint: BlueprintNode };
const edgeTypes = { plotter: PlotterEdge };

export function BlueprintSheet({ workflow }: { workflow: Workflow }) {
  const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);

  useEffect(() => {
    let live = true;
    layoutWorkflow(workflow).then((g) => {
      if (live) setLaidOut(g);
    });
    return () => {
      live = false;
    };
  }, [workflow]);

  if (!laidOut) {
    return <div className="bp-sheet bp-sheet--plotting" data-testid="sheet-loading">PLOTTING…</div>;
  }

  const nodes: Node[] = laidOut.nodes.map((n, i) => ({
    id: n.id,
    type: 'blueprint',
    position: { x: n.x, y: n.y },
    data: { node: n.node, index: i },
    draggable: false,
    connectable: false,
    selectable: false,
  }));

  const edges: Edge[] = laidOut.edges.map((e, i) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'plotter',
    data: { points: e.points, kind: e.kind, label: e.label, index: i },
  }));

  return (
    <div className="bp-sheet" data-testid="sheet">
      <svg className="bp-defs" aria-hidden="true">
        <defs>
          <marker id="fp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="context-stroke" strokeWidth="1.5" />
          </marker>
        </defs>
      </svg>
      <div className="bp-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      <div className="bp-frame" aria-hidden="true" />
      <ZoneRuler axis="top" count={8} />
      <ZoneRuler axis="side" count={6} />
      <TitleBlock meta={workflow.meta} nodeCount={workflow.nodes.length} />
    </div>
  );
}
