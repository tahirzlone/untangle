import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Position, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Suggestion, Workflow, WorkflowNode } from '../graph/types';
import {
  applySuggestion,
  createSession,
  current,
  reset,
  undo,
  type GraphSession,
} from '../graph/apply';
import { layoutWorkflow, NODE_HEIGHT, NODE_WIDTH, type LaidOutGraph } from '../graph/layout';
import { planBackEdges, type BackEdgePlan } from '../graph/backEdge';
import { DetailDrawer } from './DetailDrawer';
import { ImpactMeter } from './ImpactMeter';
import { SignalNode } from './SignalNode';
import { SignalEdge } from './SignalEdge';
import { VersionStrip } from './VersionStrip';
import './canvas.css';

const nodeTypes = { signal: SignalNode };
const edgeTypes = { signal: SignalEdge };

/** Shared by every card the KB matched nothing to, so no empty array is rebuilt. */
const NO_SUGGESTIONS: Suggestion[] = [];
const NO_GHOSTS: GhostCard[] = [];
const NO_MATCHES: Map<string, Suggestion[]> = new Map();

/** The morph's two durations, matching the transitions in canvas.css. */
const FLIP_MS = 480;
const GHOST_MS = 400;
const FLIP_CLASS = 'sg-node-shell--flip';
const FLIP_PLAY_CLASS = 'sg-node-shell--flip-play';
/** How many frames the FLIP will wait for React Flow to catch up before it plays. */
const FLIP_FRAME_BUDGET = 4;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

/** A card the applied patch consumed, and where it was when it did. */
interface GhostCard {
  id: string;
  label: string;
  x: number;
  y: number;
}

/**
 * How the next version should arrive: where the surviving cards were (the F in
 * FLIP) and which ones are leaving. Planned when APPLY is pressed, played once ELK
 * has answered — see the layout effect below.
 */
interface MorphPlan {
  from: Map<string, { x: number; y: number }>;
  dying: GhostCard[];
}

/**
 * A session on this graph, or the reason there is none.
 *
 * `createSession` refuses a workflow whose suggestions carry the same Airtable row
 * twice — `airtableRecordId` is the reducer's identity key, and `loadWorkflow` lets
 * a collision through. Constructing a `GraphSession` by hand would smuggle exactly
 * the state the reducer refuses to open, so the only route is this one, in a
 * try/catch, and a null session means the suggestion layer is withheld whole.
 */
interface OpenSession {
  /** The workflow this was opened on, so a new graph gets a new session. */
  source: Workflow;
  session: GraphSession | null;
}

function openSession(source: Workflow): OpenSession {
  try {
    return { source, session: createSession(source) };
  } catch {
    return { source, session: null };
  }
}

/**
 * ELK's answer, turned into React Flow's starting positions.
 *
 * After this the positions belong to React Flow: the user drags them wherever
 * they like and RESET LAYOUT is what runs this again. An APPLY runs it too — the
 * new version is laid out from scratch, so hand-dragged positions do not survive a
 * morph. Nothing could carry them across honestly: the graph the user arranged is
 * not the graph coming back.
 */
function toRFNodes(
  laidOut: LaidOutGraph,
  matched: Map<string, Suggestion[]>,
  selectedId: string | null,
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
    // The ring is React Flow's to draw but ours to restore: a re-layout replaces
    // every node object, and a drawer left open over an unringed card reads as a
    // panel that lost its subject.
    selected: n.id === selectedId,
    data: { node: n.node, index: i, suggestions: matched.get(n.id) ?? NO_SUGGESTIONS },
    // draggable/selectable are deliberately unset per node: leaving them
    // undefined is what lets the canvas-level flags below govern all of them.
  }));
}

/**
 * The pane's own transform, so the ghost layer sits in the coordinate space the
 * cards were drawn in. Read off the DOM because React Flow owns the viewport and
 * this component lives outside its provider.
 */
function readViewportTransform(): string {
  return document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform ?? '';
}

/**
 * Where React Flow currently has a card, read back off the `translate(xpx,ypx)` it
 * writes onto every node wrapper. Null when there is no wrapper — a card new to
 * this version has not been mounted yet.
 */
function whereRFHasCard(id: string): { x: number; y: number } | null {
  const wrapper = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  const at = wrapper?.style.transform.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
  return at ? { x: Number(at[1]), y: Number(at[2]) } : null;
}

export function GraphCanvas({ workflow }: { workflow: Workflow }) {
  const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<SignalRFNode>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // bumped by RESET LAYOUT — re-running the effect is the whole mechanism
  const [layoutRun, setLayoutRun] = useState(0);
  const [ghosts, setGhosts] = useState<GhostCard[]>(NO_GHOSTS);
  const [ghostTransform, setGhostTransform] = useState('');

  const [opened, setOpened] = useState(() => openSession(workflow));
  // A new graph is a new session, adjusted during render rather than in an effect:
  // React discards this pass and re-runs immediately, so no frame is ever painted
  // with the previous graph's session behind it.
  if (opened.source !== workflow) setOpened(openSession(workflow));

  const { session } = opened;
  /** The graph on screen: the session's current version, always. */
  const graph = session ? current(session) : opened.source;
  const versionCount = session ? session.versions.length : 1;

  const morphRef = useRef<MorphPlan | null>(null);
  const ghostTimer = useRef(0);
  const flipTimer = useRef(0);
  const flipped = useRef<HTMLElement[]>([]);
  // The layout effect must know what is selected without re-running when that
  // changes — a selection is not a reason to lay the graph out again.
  const selectedRef = useRef<string | null>(null);
  const select = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  // The KB's answer, indexed by the step it answers about. Two rows can match the
  // same step, so this is a list per node, not one entry per node. Read off the
  // CURRENT version: applies consume rows, and the cascade takes the rows whose
  // target went with them.
  const matched = useMemo(() => {
    // No session, no suggestion layer: badges and cards would offer an APPLY the
    // reducer will not honour on this graph.
    if (!session) return NO_MATCHES;
    const byNode = new Map<string, Suggestion[]>();
    for (const s of graph.suggestions) {
      const list = byNode.get(s.nodeId);
      if (list) list.push(s);
      else byNode.set(s.nodeId, [s]);
    }
    return byNode;
  }, [graph, session]);

  /**
   * Would the reducer accept this patch? Answered by running it, on a session
   * nobody keeps: a suggestion can satisfy the schema and still describe a graph
   * that cannot exist, and the only honest test of that is the reducer itself.
   *
   * The question is asked of the LIVE session, so the answer moves with the graph:
   * a patch whose replacement id now collides with a node an earlier apply
   * introduced is refused here, and the card says so instead of throwing.
   *
   * Every question is asked of the same session, so siblings on one node are
   * judged independently — applying one would delete the other, but neither dry
   * run ever commits.
   */
  const canApply = useCallback(
    (airtableRecordId: string): boolean => {
      if (!session) return false;
      try {
        applySuggestion(session, airtableRecordId);
        return true;
      } catch {
        return false;
      }
    },
    [session],
  );

  useEffect(() => {
    let live = true;
    layoutWorkflow(graph).then((g) => {
      if (!live) return;
      setLaidOut(g);
      setNodes(toRFNodes(g, matched, selectedRef.current));
    });
    return () => {
      live = false;
    };
  }, [graph, layoutRun, setNodes, matched]);

  /** Every FLIP property this component wrote, taken back off. */
  const clearFlip = useCallback(() => {
    for (const shell of flipped.current) {
      shell.classList.remove(FLIP_CLASS, FLIP_PLAY_CLASS);
      shell.style.removeProperty('--flip-dx');
      shell.style.removeProperty('--flip-dy');
    }
    flipped.current = [];
  }, []);

  /**
   * Plays the morph: FLIP on the cards that survived, ghosts for the ones that did
   * not.
   *
   * Keyed on the LAYOUT, not on the version index: the version changes the instant
   * APPLY is pressed, while the positions the animation inverts against only exist
   * once ELK has answered. A new `laidOut` landing is that moment.
   *
   * The inversion is written straight onto the shells — found through the `data-id`
   * React Flow stamps on every node wrapper — rather than through React, and never
   * in this effect itself: React Flow pushes our `nodes` into its own store from a
   * PASSIVE effect, so at layout-effect time (and possibly a frame or two after) its
   * wrappers are still at the old positions. Inverting then would kick every card
   * out by its own delta for a frame. So the work waits in a `requestAnimationFrame`
   * that first asks whether the wrappers have caught up with the layout being
   * inverted against — still before the frame is painted, which is where an inverse
   * transform has to land for the eye to see the card leave its old place.
   */
  useLayoutEffect(() => {
    const plan = morphRef.current;
    if (!plan || !laidOut) return;
    morphRef.current = null;

    if (plan.dying.length > 0) {
      // Created here rather than when APPLY was pressed, so a ghost never overlaps
      // the card it is a copy of: the old cards leave the canvas in this same commit.
      setGhostTransform(readViewportTransform());
      setGhosts(plan.dying);
      window.clearTimeout(ghostTimer.current);
      ghostTimer.current = window.setTimeout(() => setGhosts(NO_GHOSTS), GHOST_MS);
    }

    const moving: { shell: HTMLElement; dx: number; dy: number }[] = [];
    for (const n of laidOut.nodes) {
      const was = plan.from.get(n.id);
      // Absent means new to this version — the card's own entrance plays instead.
      if (!was) continue;
      const shell = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${n.id}"] .sg-node-shell`,
      );
      // A card that did not move gets a 0px inversion: a no-op transition, and
      // cheaper than deciding which cards ELK happened to leave alone.
      if (shell) moving.push({ shell, dx: was.x - n.x, dy: was.y - n.y });
    }
    if (moving.length === 0) return;

    let waited = 0;
    let frame = 0;
    const play = () => {
      // Has React Flow moved the wrappers to the layout this inversion is measured
      // against? A card that needs to move and has not is a card whose inversion
      // would be visible in the wrong place, so give it a frame — up to a handful,
      // after which the animation is played anyway rather than dropped.
      const behind = laidOut.nodes.some((n) => {
        const at = whereRFHasCard(n.id);
        return at !== null && (Math.abs(at.x - n.x) > 0.5 || Math.abs(at.y - n.y) > 0.5);
      });
      if (behind && ++waited < FLIP_FRAME_BUDGET) {
        frame = requestAnimationFrame(play);
        return;
      }
      clearFlip();
      for (const { shell, dx, dy } of moving) {
        shell.style.setProperty('--flip-dx', `${dx}px`);
        shell.style.setProperty('--flip-dy', `${dy}px`);
        shell.classList.add(FLIP_CLASS);
      }
      // One forced reflow for the whole batch — it is what makes the inverted
      // transform the value the transition below starts from.
      void document.body.offsetHeight;
      for (const { shell } of moving) shell.classList.add(FLIP_PLAY_CLASS);
      flipped.current = moving.map((m) => m.shell);
      window.clearTimeout(flipTimer.current);
      // transitionend would be the tidier trigger, but it never arrives for a card
      // that had nowhere to travel — the duration is the honest clock here.
      flipTimer.current = window.setTimeout(clearFlip, FLIP_MS);
    };
    frame = requestAnimationFrame(play);
    return () => cancelAnimationFrame(frame);
  }, [clearFlip, laidOut]);

  useEffect(
    () => () => {
      window.clearTimeout(ghostTimer.current);
      window.clearTimeout(flipTimer.current);
    },
    [],
  );

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
  const onNodeClick = useCallback(
    (_: unknown, node: SignalRFNode) => {
      select(node.id);
    },
    [select],
  );
  /**
   * Closing drops the ring with the panel.
   *
   * React Flow used to do half of this for us: Escape with focus on the card is
   * one of its own selection keys. The drawer now takes focus when it opens (so
   * the panel is reachable without tabbing past every other card), which puts
   * that keystroke out of React Flow's reach — and a card still ringed with no
   * panel open reads as a drawer that failed to close.
   */
  const closeDrawer = useCallback(() => {
    select(null);
    setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
  }, [select, setNodes]);

  /**
   * Moves the canvas to another version, animating the difference.
   *
   * The whole animation is PLANNED here, where both graphs are in hand, and played
   * by the layout effect above once the new layout exists. Under
   * prefers-reduced-motion nothing is planned at all, which is what makes the swap
   * instant: no ghosts are mounted and no shell is ever touched.
   */
  const morphTo = useCallback(
    (next: GraphSession) => {
      const survives = new Set(current(next).nodes.map((n) => n.id));
      if (!prefersReducedMotion()) {
        const from = new Map<string, { x: number; y: number }>();
        const dying: GhostCard[] = [];
        for (const n of nodes) {
          const at = { x: n.position.x, y: n.position.y };
          if (survives.has(n.id)) from.set(n.id, at);
          else dying.push({ id: n.id, label: n.data.node.label, ...at });
        }
        morphRef.current = { from, dying };
      }
      // The panel follows the graph. A step the patch consumed takes its detail
      // with it; a step that survived keeps the panel, and because the selection
      // is an id the panel's node and rows are re-derived from the new version on
      // the way through the render below.
      if (selectedRef.current && !survives.has(selectedRef.current)) closeDrawer();
      setOpened({ source: workflow, session: next });
    },
    [closeDrawer, nodes, workflow],
  );

  const onApply = useCallback(
    (airtableRecordId: string) => {
      if (!session) return;
      let next: GraphSession;
      try {
        next = applySuggestion(session, airtableRecordId);
      } catch {
        // The card's APPLY is already disabled for a patch the reducer refuses, so
        // this is defence in depth: a refusal changes nothing and claims nothing.
        return;
      }
      morphTo(next);
    },
    [morphTo, session],
  );

  const onUndo = useCallback(() => {
    if (!session) return;
    const back = undo(session);
    // undo at V0 hands the same session back — nothing to morph to, and a pending
    // plan would otherwise sit waiting for a layout that never comes
    if (back === session) return;
    morphTo(back);
  }, [morphTo, session]);

  const onJump = useCallback(
    (index: number) => {
      if (!session || index === session.versions.length - 1) return;
      // Versions are rebuilt, not stored: reset, then replay the applied prefix.
      // The reducer is pure, so replaying [0..index) lands on exactly the graph
      // that was there — there is no snapshot to keep in sync with anything.
      let at = reset(session);
      try {
        for (const id of session.appliedIds.slice(0, index)) at = applySuggestion(at, id);
      } catch {
        // A patch that applied once cannot refuse the same replay; if it somehow
        // does, the canvas stays where it is rather than showing half a version.
        return;
      }
      morphTo(at);
    },
    [morphTo, session],
  );

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
      if (!nodes.some((n) => n.id === id)) return;
      // Space would otherwise scroll the pane out from under the drawer
      e.preventDefault();
      select(id);
    },
    [nodes, select],
  );
  // Selection is dropped here rather than left to the rebuild the effect will
  // do: ELK is async, and a ring that lingers until it answers reads as a button
  // that did nothing.
  const resetLayout = useCallback(() => {
    closeDrawer();
    setLayoutRun((n) => n + 1);
  }, [closeDrawer]);

  if (!laidOut) {
    return (
      <div className="sg-canvas sg-canvas--loading" data-testid="canvas-loading">
        COMPILING GRAPH…
      </div>
    );
  }

  const { meta } = graph;
  // reduce, not Math.max(...spread): a node-less graph answers 0 rather than
  // -Infinity, so the pain readout degrades to no dots instead of throwing.
  const maxPain = graph.nodes.reduce((m, n) => Math.max(m, n.painLevel), 0);
  // Derived from the id, not stored: the version on screen is the only place a
  // panel's subject can honestly come from, and a step the last patch consumed
  // has no entry here — which closes the drawer on its own.
  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;

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
          <b>{graph.nodes.length}</b> nodes
        </span>
        <span className="sg-chip">
          max pain <span className="sg-chip-hot">{'●'.repeat(maxPain)}</span>
        </span>
        <span className="sg-chip">{meta.kbSource === 'airtable' ? 'AIRTABLE' : 'KB NOT LINKED'}</span>
        {session ? (
          <ImpactMeter metrics={session.metrics} />
        ) : (
          <span className="sg-chip sg-chip--refused" data-testid="suggestions-disabled">
            SUGGESTIONS DISABLED — DUPLICATE IDS
          </span>
        )}
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
      <VersionStrip
        count={versionCount}
        at={versionCount - 1}
        onJump={onJump}
        onUndo={onUndo}
      />
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
        {ghosts.length > 0 ? (
          // The cards the patch consumed, held for one 400ms fade at the positions
          // they left. Carrying the pane's transform puts them in the same
          // coordinate space the real cards were in, so nothing has to be
          // projected back into screen pixels.
          <div
            className="sg-morph-ghosts"
            data-testid="ghost-layer"
            aria-hidden="true"
            style={{ transform: ghostTransform }}
          >
            {ghosts.map((g) => (
              <div
                key={g.id}
                className="sg-node sg-ghost"
                data-testid="sg-ghost"
                style={{ left: g.x, top: g.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <div className="sg-node-head">
                  <span className="sg-label">{g.label}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {selected ? (
        session ? (
          <DetailDrawer
            node={selected}
            onClose={closeDrawer}
            suggestions={matched.get(selected.id) ?? NO_SUGGESTIONS}
            canApply={canApply}
            onApply={onApply}
          />
        ) : (
          // No session, no APPLY: the panel states the step and stops there.
          <DetailDrawer node={selected} onClose={closeDrawer} />
        )
      ) : null}
    </div>
  );
}
