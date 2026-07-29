import { useCallback, useEffect, useMemo, useState } from 'react';
import { Position, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Workflow, WorkflowNode } from '../graph/types';
import { layoutWorkflow, NODE_HEIGHT, NODE_WIDTH, type LaidOutGraph } from '../graph/layout';
import { planBackEdges, type BackEdgePlan } from '../graph/backEdge';
import { DetailDrawer } from './DetailDrawer';
import { SignalNode } from './SignalNode';
import { SignalEdge } from './SignalEdge';
import './canvas.css';

const nodeTypes = { signal: SignalNode };
const edgeTypes = { signal: SignalEdge };

/** The data every SignalNode carries; also how a click finds its workflow node. */
interface SignalNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  index: number;
}
type SignalRFNode = Node<SignalNodeData>;

/**
 * ELK's answer, turned into React Flow's starting positions.
 *
 * After this the positions belong to React Flow: the user drags them wherever
 * they like and RESET LAYOUT is what runs this again.
 */
function toRFNodes(laidOut: LaidOutGraph): SignalRFNode[] {
  return laidOut.nodes.map((n, i) => ({
    id: n.id,
    type: 'signal',
    position: { x: n.x, y: n.y },
    // Dimensions are known ahead of measurement — ELK laid the graph out
    // against exactly these numbers. Supplying them means the first paint has
    // correct bounds (no measure round-trip, no hidden nodes) and the edge
    // layer renders immediately instead of waiting on a ResizeObserver tick.
    width: n.width,
    height: n.height,
    // Handle geometry, likewise known ahead of measurement: SignalNode puts a
    // target port at the left edge middle and a source port at the right edge
    // middle (flow runs left→right). React Flow prefers measured bounds when it
    // has them (`internals.handleBounds || toHandleBounds`), so this only fills
    // the gap before the first ResizeObserver tick — without it RF declines to
    // render the edge layer at all.
    handles: [
      { type: 'target', position: Position.Left, x: 0, y: n.height / 2 },
      { type: 'source', position: Position.Right, x: n.width, y: n.height / 2 },
    ],
    data: { node: n.node, index: i },
    // draggable/selectable are deliberately unset per node: leaving them
    // undefined is what lets the canvas-level flags below govern all of them.
  }));
}

export function GraphCanvas({ workflow }: { workflow: Workflow }) {
  const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<SignalRFNode>([]);
  const [selected, setSelected] = useState<WorkflowNode | null>(null);
  // bumped by RESET LAYOUT — re-running the effect is the whole mechanism
  const [layoutRun, setLayoutRun] = useState(0);

  useEffect(() => {
    let live = true;
    layoutWorkflow(workflow).then((g) => {
      if (!live) return;
      setLaidOut(g);
      setNodes(toRFNodes(g));
    });
    return () => {
      live = false;
    };
  }, [workflow, layoutRun, setNodes]);

  // Where the cards actually are, right now — after every drag, not where ELK
  // first put them. The back-edge plan below is only honest if it reads this.
  const boxes = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? NODE_WIDTH,
        height: n.height ?? NODE_HEIGHT,
      })),
    [nodes],
  );

  // Reversed edges need to know about cards they never touch, so their return
  // route is planned here — the one place that can see the whole layout — and
  // handed to SignalEdge as data. Recomputed on every position change: drag a
  // card below a return lane and the lane drops under it on the same frame. The
  // pass is O(edges × nodes) over a graph small enough to fit on a screen, so
  // per-frame is affordable; if a huge graph ever makes it stutter, the throttle
  // point is here, not in the renderer.
  const backPlan = useMemo<Map<string, BackEdgePlan>>(
    () => (laidOut ? planBackEdges(boxes, laidOut.edges) : new Map()),
    [boxes, laidOut],
  );

  const edges: Edge[] = useMemo(
    () =>
      (laidOut?.edges ?? []).map((e, i) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: 'signal',
        // no points: SignalEdge curves between the ports React Flow reports, so
        // ELK's spline sections are not carried into the render
        data: { kind: e.kind, label: e.label, index: i, back: backPlan.get(e.id) },
      })),
    [laidOut, backPlan],
  );

  // Drag and click share the same gesture, and React Flow already tells them
  // apart: it hands d3-drag `nodeClickDistance` (0 by default), which swallows
  // the trailing click of any gesture that moved. So a drag reshapes and stays
  // silent; a press that goes nowhere opens the drawer. Nothing to reimplement.
  const onNodeClick = useCallback((_: unknown, node: SignalRFNode) => {
    setSelected(node.data.node);
  }, []);
  const closeDrawer = useCallback(() => setSelected(null), []);
  // Selection is dropped here rather than left to the rebuild the effect will
  // do: ELK is async, and a ring that lingers until it answers reads as a button
  // that did nothing.
  const resetLayout = useCallback(() => {
    setSelected(null);
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setLayoutRun((n) => n + 1);
  }, [setNodes]);

  if (!laidOut) {
    return (
      <div className="sg-canvas sg-canvas--loading" data-testid="canvas-loading">
        COMPILING GRAPH…
      </div>
    );
  }

  const { meta } = workflow;
  // reduce, not Math.max(...spread): a node-less graph answers 0 rather than
  // -Infinity, so the pain readout degrades to no dots instead of throwing.
  const maxPain = workflow.nodes.reduce((m, n) => Math.max(m, n.painLevel), 0);

  return (
    <div className="sg-canvas" data-testid="canvas">
      <svg className="sg-defs" aria-hidden="true">
        <defs>
          <marker id="fp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="context-stroke" strokeWidth="1.5" />
          </marker>
        </defs>
      </svg>
      <div className="sg-toolbar" data-testid="canvas-toolbar">
        <span className="sg-wf-title">{meta.title}</span>
        <span className="sg-chip">
          <b>{workflow.nodes.length}</b> nodes
        </span>
        <span className="sg-chip">
          max pain <span className="sg-chip-hot">{'●'.repeat(maxPain)}</span>
        </span>
        <span className="sg-chip">{meta.kbSource === 'airtable' ? 'AIRTABLE' : 'KB NOT LINKED'}</span>
        <button
          type="button"
          className="sg-ghost-btn"
          data-testid="reset-layout"
          onClick={resetLayout}
        >
          RESET LAYOUT
        </button>
        <span className="sg-chip sg-chip--end">
          generated by <b>{meta.model}</b>
        </span>
      </div>
      <div className="sg-viewport">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={closeDrawer}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable
          elementsSelectable
          // reshaping the layout is not rewiring the workflow: cards move, the
          // graph's semantics do not
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      {selected ? <DetailDrawer node={selected} onClose={closeDrawer} /> : null}
    </div>
  );
}
