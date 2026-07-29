import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Position, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Suggestion, Workflow, WorkflowNode } from '../graph/types';
import { applySuggestion, createSession, type GraphSession } from '../graph/apply';
import { layoutWorkflow, NODE_HEIGHT, NODE_WIDTH, type LaidOutGraph } from '../graph/layout';
import { planBackEdges, type BackEdgePlan } from '../graph/backEdge';
import { DetailDrawer } from './DetailDrawer';
import { SignalNode } from './SignalNode';
import { SignalEdge } from './SignalEdge';
import './canvas.css';

const nodeTypes = { signal: SignalNode };
const edgeTypes = { signal: SignalEdge };

/** Shared by every card the KB matched nothing to, so no empty array is rebuilt. */
const NO_SUGGESTIONS: Suggestion[] = [];

/** The data every SignalNode carries; also how a click finds its workflow node. */
interface SignalNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  index: number;
  /** The rows matched to this step — the card's pip counts them. */
  suggestions: Suggestion[];
}
type SignalRFNode = Node<SignalNodeData>;

/** Keys that open a focused card's detail, matching React Flow's own selection keys. */
const OPEN_KEYS = ['Enter', ' '];

/**
 * ELK's answer, turned into React Flow's starting positions.
 *
 * After this the positions belong to React Flow: the user drags them wherever
 * they like and RESET LAYOUT is what runs this again.
 */
function toRFNodes(
  laidOut: LaidOutGraph,
  matched: Map<string, Suggestion[]>,
): SignalRFNode[] {
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
    data: { node: n.node, index: i, suggestions: matched.get(n.id) ?? NO_SUGGESTIONS },
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

  // The KB's answer, indexed by the step it answers about. Two rows can match the
  // same step, so this is a list per node, not one entry per node.
  const matched = useMemo(() => {
    const byNode = new Map<string, Suggestion[]>();
    for (const s of workflow.suggestions) {
      const list = byNode.get(s.nodeId);
      if (list) list.push(s);
      else byNode.set(s.nodeId, [s]);
    }
    return byNode;
  }, [workflow]);

  /**
   * Would the reducer accept this patch? Answered by running it, on a session
   * nobody keeps: a suggestion can satisfy the schema and still describe a graph
   * that cannot exist, and the only honest test of that is the reducer itself.
   *
   * Every question is asked of the same untouched session, so siblings on one
   * node are judged independently — applying one would delete the other, but
   * neither dry run ever commits.
   *
   * Task 5 replaces this with the live session the canvas owns.
   */
  const canApply = useMemo(() => {
    let base: GraphSession | null = null;
    try {
      base = createSession(workflow);
    } catch {
      // A graph the reducer will not even open (colliding row ids) has nothing
      // appliable on it — every card says so rather than the canvas throwing.
      base = null;
    }
    return (airtableRecordId: string): boolean => {
      if (!base) return false;
      try {
        applySuggestion(base, airtableRecordId);
        return true;
      } catch {
        return false;
      }
    };
  }, [workflow]);

  // Task 5 owns the morph: this is where applySuggestion's result becomes the
  // graph on screen. Until then the button is wired and deliberately inert.
  const onApply = useCallback((_airtableRecordId: string) => {}, []);

  useEffect(() => {
    let live = true;
    layoutWorkflow(workflow).then((g) => {
      if (!live) return;
      setLaidOut(g);
      setNodes(toRFNodes(g, matched));
    });
    return () => {
      live = false;
    };
  }, [workflow, layoutRun, setNodes, matched]);

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

  // Drag and click share the same gesture; React Flow tells them apart by
  // distance, and the tolerance is set on the ReactFlow element below — see the
  // note on `nodeClickDistance`, which is load-bearing for this handler ever
  // firing from a real mouse.
  const onNodeClick = useCallback((_: unknown, node: SignalRFNode) => {
    setSelected(node.data.node);
  }, []);
  const closeDrawer = useCallback(() => setSelected(null), []);

  /**
   * The same open, reached without a pointer.
   *
   * React Flow already makes each card focusable and already selects it on
   * Enter/Space — what it does not do is call `onNodeClick`, which is the only
   * thing that opens the drawer. So the graph pane listens for those keys as they
   * bubble and reads the focused card's `data-id`, which React Flow stamps on
   * every node wrapper. Reading the DOM is the honest route here: the keystroke
   * lands on React Flow's element, not on ours, so the id has to come from it.
   */
  const onPaneKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!OPEN_KEYS.includes(e.key)) return;
      const focused = document.activeElement;
      const wrapper = focused instanceof Element ? focused.closest('.react-flow__node') : null;
      const id = wrapper?.getAttribute('data-id');
      if (!id) return;
      const node = nodes.find((n) => n.id === id)?.data.node;
      if (!node) return;
      // Space would otherwise scroll the pane out from under the drawer
      e.preventDefault();
      setSelected(node);
    },
    [nodes],
  );
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
      {/* The pane is a listening post for keys aimed at the focusable cards inside
          it — it takes no focus of its own and adds no keyboard trap. */}
      <div className="sg-viewport" onKeyDown={onPaneKeyDown}>
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
          // How far the pointer may slip and still count as a click. React Flow
          // hands this to d3-drag's clickDistance, which swallows the trailing
          // click of any gesture that travelled further. The default is 0 — and
          // at 0, a CDP pointer probe showed a 1px wobble already killing the
          // click, so on a real mouse or trackpad the drawer would open only by
          // luck. 4px is under the width of a fingertip's tremor and still well
          // inside "I did not mean to move that card": a gesture that short nudges
          // the node imperceptibly AND opens the drawer, while a genuine drag
          // stays silent.
          nodeClickDistance={4}
          // reshaping the layout is not rewiring the workflow: cards move, the
          // graph's semantics do not
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </div>
      {selected ? (
        <DetailDrawer
          node={selected}
          onClose={closeDrawer}
          suggestions={matched.get(selected.id) ?? NO_SUGGESTIONS}
          canApply={canApply}
          onApply={onApply}
        />
      ) : null}
    </div>
  );
}
