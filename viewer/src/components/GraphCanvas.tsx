import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  getNodesBounds,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Suggestion, Workflow, WorkflowNode } from '../graph/types';
import {
  applySuggestion,
  createSession,
  current,
  jump,
  redo,
  undo,
  type GraphSession,
} from '../graph/apply';
import { contentBounds, exportGraphPng } from '../graph/exportPng';
import { criticalPath, NO_PATH } from '../graph/insight';
import { planLabels, type LabelOffset, type LabelTag } from '../graph/labels';
import { layoutWorkflow, NODE_HEIGHT, NODE_WIDTH, type LaidOutGraph } from '../graph/layout';
import { impactSummary } from '../graph/metrics';
import { planBackEdges, type BackEdgePlan } from '../graph/backEdge';
import { CelebrationLayer, useCelebration } from './Celebration';
import { DetailDrawer } from './DetailDrawer';
import { EndpointMarks, type EndpointBox } from './EndpointMarks';
import { ImpactPanel } from './ImpactPanel';
import { PeekCard, peekAnchor, PEEK_DELAY_MS, type PeekAnchor } from './PeekCard';
import { SignalNode } from './SignalNode';
import { SignalEdge } from './SignalEdge';
import { VersionStrip } from './VersionStrip';
import { WipeCompare } from './WipeCompare';
import { ResultsWindow } from './ResultsWindow';
import { useCinematic, type TourResult } from './optimize';
import { CAMERA_MS, FLIP_MS, GHOST_MS, MOTION_VARS, prefersReducedMotion } from './motion';
import './canvas.css';

const nodeTypes = { signal: SignalNode };
const edgeTypes = { signal: SignalEdge };

/** Shared by every card the KB matched nothing to, so no empty array is rebuilt. */
const NO_SUGGESTIONS: Suggestion[] = [];
const NO_GHOSTS: GhostCard[] = [];
const NO_MATCHES: Map<string, Suggestion[]> = new Map();
/** No tag had to move — which is the answer on most graphs, and on every one in jsdom. */
const NO_OFFSETS: Map<string, LabelOffset> = new Map();

/**
 * The morph's two durations, handed to the stylesheet. Built once at module load
 * — the object is constant, so it never re-renders anything by identity — and
 * cast because React's CSSProperties has no room for custom properties.
 */
const MOTION_STYLE = MOTION_VARS as CSSProperties;

const FLIP_CLASS = 'sg-node-shell--flip';
const FLIP_PLAY_CLASS = 'sg-node-shell--flip-play';
/** How many frames the FLIP will wait for React Flow to catch up before it plays. */
const FLIP_FRAME_BUDGET = 4;
/** How many frames the focus landing will wait for the card it aims at to mount. */
const FOCUS_FRAME_BUDGET = 4;

/**
 * How close the cinematic's camera may get, and how far it may pull back. The
 * tour reframes rather than re-zooms — whatever the user was looking at stays
 * roughly that size — but held inside a band where a card is still readable.
 */
const TOUR_ZOOM_MIN = 0.75;
const TOUR_ZOOM_MAX = 1;

/** How long a failed export says so before the note clears itself. */
const EXPORT_NOTE_MS = 4000;

/** Shared by every session that has excluded nothing — which is most of them. */
const NOTHING_EXCLUDED: ReadonlySet<string> = new Set<string>();

/** The data every SignalNode carries; also how a click finds its workflow node. */
interface SignalNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  index: number;
  /** The rows matched to this step — the card's pip counts them. */
  suggestions: Suggestion[];
  /** On the most painful route through this version, while that is being shown. */
  critical: boolean;
  /**
   * NOT on that route, while it is being shown.
   *
   * The complement of `critical` only while a route is actually up: with the
   * toggle released, and on a graph the sweep cannot answer about, both are
   * false and nothing on the canvas steps anywhere.
   */
  offPath: boolean;
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
 *
 * `prior` is the node list this one replaces, and the one thing carried over from
 * it is `measured` — React Flow's own record of what the card's DOM actually came
 * out at. A relayout hands React Flow a brand new object per card, and a card
 * whose `measured` is absent is a card React Flow considers uninitialized: drag it
 * and it logs error #015 and clamps the drag against dimensions it does not have.
 * The measurement is still TRUE across a relayout — the same card at the same size,
 * moved — so it is merged in rather than waited for a second time.
 */
function toRFNodes(
  laidOut: LaidOutGraph,
  matched: Map<string, Suggestion[]>,
  selectedId: string | null,
  criticalIds: ReadonlySet<string>,
  /** Is a route actually being pointed at? Only then does anything step back. */
  critpathActive: boolean,
  prior: SignalRFNode[] = [],
): SignalRFNode[] {
  const measured = new Map(prior.map((n) => [n.id, n.measured]));
  return laidOut.nodes.map((n, i) => ({
    id: n.id,
    type: 'signal',
    position: { x: n.x, y: n.y },
    // Absent for a card new to this version — nothing has measured it yet, and
    // React Flow's ResizeObserver fills it in on the tick after it mounts.
    ...(measured.get(n.id) ? { measured: measured.get(n.id) } : null),
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
    data: {
      node: n.node,
      index: i,
      suggestions: matched.get(n.id) ?? NO_SUGGESTIONS,
      // Restored here for the same reason `selected` is: a re-layout replaces
      // every node object, and a glow that vanished on RESET LAYOUT would read as
      // the toggle having switched itself off. The step-back is the same fact
      // read the other way round, and has to survive the same swap.
      critical: criticalIds.has(n.id),
      offPath: critpathActive && !criticalIds.has(n.id),
    },
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

/**
 * Every edge tag on the canvas, as the box it occupies in flow coordinates.
 *
 * Read off the DOM because a tag's position is the CURVE's answer — `getBezierPath`
 * hands its midpoint straight to the chip inside SignalEdge — and its size is
 * whatever the text came out at. Neither number exists anywhere this component can
 * compute it.
 *
 * The point taken is the one the edge chose, not the one the chip is drawn at:
 * EdgeTag states both, so a pass over an already-nudged graph plans against the
 * same input as the pass before it and the offsets settle instead of accumulating.
 * `offsetWidth`/`offsetHeight` are unscaled — the zoom lives on a layer above —
 * so the box is already in the coordinate space the cards are in.
 *
 * jsdom measures nothing, so every box comes back zero-sized and is dropped: the
 * collision pass is a browser-side refinement, and its rule is tested where it
 * belongs, on rectangles, in graph/labels.test.ts.
 */
function readTagBoxes(root: ParentNode | null): LabelTag[] {
  const tags: LabelTag[] = [];
  if (!root) return tags;
  for (const el of root.querySelectorAll<HTMLElement>('.sg-edge-tag[data-tag-id]')) {
    const x = Number(el.dataset.tagX);
    const y = Number(el.dataset.tagY);
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y) || width === 0 || height === 0) continue;
    tags.push({
      id: el.dataset.tagId!,
      // the chip is centred on the point, so its box starts half a chip before it
      rect: { x: x - width / 2, y: y - height / 2, width, height },
    });
  }
  return tags;
}

/**
 * The first card the pane is actually showing, or null when none of them is.
 *
 * Rects, not positions: the cards live in flow coordinates behind a pan and a zoom,
 * and the only honest test of "can this be seen" is where the browser says the
 * element ended up against where the pane ended up. Document order breaks the tie —
 * whatever ELK laid out first among the ones on screen.
 *
 * jsdom measures every rect as 0×0, so nothing ever intersects and the answer is
 * always null. That is the fallback behaving, not a gap: the caller drops through
 * to first-in-document, which is exactly what a pane that has measured nothing has
 * to offer.
 */
function cardInView(): HTMLElement | null {
  const pane = document.querySelector<HTMLElement>('.sg-viewport');
  if (!pane) return null;
  const view = pane.getBoundingClientRect();
  if (view.width === 0 || view.height === 0) return null;
  for (const card of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const at = card.getBoundingClientRect();
    if (at.width === 0 || at.height === 0) continue;
    const inside =
      at.left < view.right && view.left < at.right && at.top < view.bottom && view.top < at.bottom;
    if (inside) return card;
  }
  return null;
}

/** Are these the same set of moves? A new Map of identical offsets is not a change. */
function sameOffsets(a: Map<string, LabelOffset>, b: Map<string, LabelOffset>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, at] of a) {
    const other = b.get(id);
    if (!other || other.dx !== at.dx || other.dy !== at.dy) return false;
  }
  return true;
}

export function GraphCanvas({ workflow }: { workflow: Workflow }) {
  const [laidOut, setLaidOut] = useState<LaidOutGraph | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<SignalRFNode>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /**
   * The same fact as `selectedId`, readable without depending on it.
   *
   * The layout effect must know what is selected without re-running when that
   * changes — a selection is not a reason to lay the graph out again. Written
   * through `select` so the two can never part; declared up here because the
   * workflow swap below is the one place that clears the pair during render.
   */
  const selectedRef = useRef<string | null>(null);
  const select = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);
  // bumped by RESET LAYOUT — re-running the effect is the whole mechanism
  const [layoutRun, setLayoutRun] = useState(0);
  const [ghosts, setGhosts] = useState<GhostCard[]>(NO_GHOSTS);
  const [ghostTransform, setGhostTransform] = useState('');
  /** Is the Results Window holding the workspace? */
  const [resultsOpen, setResultsOpen] = useState(false);
  /**
   * The session a finished OPTIMIZE run left on the canvas, or null when no
   * run's result is on offer. Compared by IDENTITY against the live session:
   * every apply, undo, redo and jump replaces the session object, so the moment
   * the user leaves the optimized state the comparison fails and VIEW RESULTS
   * stands down on its own — PROMPT remains the standing entry.
   */
  const [tourEnded, setTourEnded] = useState<GraphSession | null>(null);
  /**
   * The applied rows whose install the user has ticked OUT of the deliverable.
   *
   * Owned here rather than by the window so the choice survives the window
   * closing and reopening — the set is per SESSION, not per viewing. It also
   * survives version-cursor moves, and that is a decision rather than an
   * accident: the set names resources by `airtableRecordId`, an id names one
   * resource carrying one command, and an entry for a row the cursor has
   * stepped away from simply goes inert (`assemblePrompt` ignores ids that are
   * not applied) until a redo brings its row back — at which point the user's
   * answer about that exact command is still their answer. A workflow swap IS
   * a different set of questions, and resets it below.
   */
  const [excludeInstalls, setExcludeInstalls] = useState<ReadonlySet<string>>(NOTHING_EXCLUDED);
  /** Did the toolbar's export fail? The note stands beside the button that asked. */
  const [exportFailed, setExportFailed] = useState(false);
  /** Is the VS ORIGINAL wipe open? A mode, not a hold — ESC or the toggle ends it. */
  const [wipe, setWipe] = useState(false);
  /** The pane's transform, mirrored onto the comparison while it is showing. */
  const [wipeTransform, setWipeTransform] = useState('');
  /** The clip the live canvas wears while wiping — the divider states it. */
  const [wipeClip, setWipeClip] = useState<string | null>(null);
  /** Is CRITICAL PATH down? */
  const [showPath, setShowPath] = useState(false);
  /** Which edge tags had to move to be readable, and by how much. */
  const [tagOffsets, setTagOffsets] = useState<Map<string, LabelOffset>>(NO_OFFSETS);
  /**
   * React Flow's transformed layer, once it exists — the element the export
   * captures, and therefore where the arrowhead definition has to live.
   */
  const [defsHost, setDefsHost] = useState<HTMLElement | null>(null);
  /**
   * The step the pointer has rested on long enough to be asking about, and where
   * its card was when it did. Null whenever nothing is being peeked at.
   */
  const [peek, setPeek] = useState<{ id: string; at: PeekAnchor } | null>(null);
  /** Is a card being dragged right now? */
  const [dragging, setDragging] = useState(false);
  /** The savings currently rising off a step that was just patched. */
  const { floats, celebrate } = useCelebration();

  const [opened, setOpened] = useState(() => openSession(workflow));
  // A new graph is a new session, adjusted during render rather than in an effect:
  // React discards this pass and re-runs immediately, so no frame is ever painted
  // with the previous graph's session behind it.
  //
  // The SELECTION goes with the graph it was made on. The drawer closes itself —
  // its subject is derived from the id against the version on screen, and the new
  // graph has no such step — but the id itself would survive the swap, and an id
  // left standing suppresses the peek across the whole canvas (see
  // `peekSuppressed`) with no panel on screen to explain why. Cleared here, in the
  // same pass that opens the new session, rather than in an effect for the same
  // reason the session is.
  if (opened.source !== workflow) {
    setOpened(openSession(workflow));
    select(null);
    // The install choices go with the graph they were made about: a tick is an
    // answer about one workflow's rows, and the new file asks different
    // questions. The window and the run's button go with them — both speak for
    // a session that no longer exists.
    setExcludeInstalls(NOTHING_EXCLUDED);
    setResultsOpen(false);
    setTourEnded(null);
  }

  const { session } = opened;
  /** The graph on screen: the version the session's cursor is on, always. */
  const graph = session ? current(session) : opened.source;
  const versionCount = session ? session.versions.length : 1;
  /** Which version that is — not necessarily the newest, once UNDO has been used. */
  const versionAt = session ? session.cursor : 0;
  /** The graph as it arrived, which is what VS ORIGINAL compares against. */
  const original = session ? session.versions[0] : null;

  const morphRef = useRef<MorphPlan | null>(null);
  /** The pane, so the tag measurement is scoped to this canvas's own graph. */
  const paneRef = useRef<HTMLDivElement>(null);
  /**
   * React Flow's own handle, taken at init. The canvas renders `<ReactFlow>`
   * directly rather than inside a provider, so `useReactFlow` is out of reach
   * here — `onInit` is how the camera gets a way to move.
   */
  const rf = useRef<ReactFlowInstance<SignalRFNode, Edge> | null>(null);
  const ghostTimer = useRef(0);
  const flipTimer = useRef(0);
  const exportTimer = useRef(0);
  const peekTimer = useRef(0);
  const flipped = useRef<HTMLElement[]>([]);
  /**
   * The original's layout, taken the one time the original IS the live graph.
   *
   * V0 never changes, and the canvas always draws it before any patch can land —
   * so the pass that put the first cards on screen is the pass the comparison
   * needs, and asking ELK a second time would be asking the same question twice.
   * Kept with the workflow it belongs to, so a second file dropped on the viewer
   * cannot be compared against the first one's ghost.
   *
   * This is the comparison's FALLBACK geometry: where the user has arranged the
   * graph by hand, the snapshot below outranks it — see `originalPositions`.
   */
  const originalLayout = useRef<{
    of: Workflow;
    laidOut: LaidOutGraph;
  } | null>(null);
  /**
   * Where React Flow had every card at the FIRST apply of this session — the
   * user's own arrangement of V0, drags included, taken at the last moment it is
   * still on screen. VS ORIGINAL draws the original at these positions, so a
   * layout someone shaped by hand is compared as they shaped it rather than as
   * ELK first dealt it. Keyed by the workflow, like the layout above, so a
   * second file never inherits the first one's arrangement; both routes into an
   * apply — the drawer's button and the cinematic — pass through the capture.
   */
  const originalPositions = useRef<{
    of: Workflow;
    at: Map<string, { x: number; y: number }>;
  } | null>(null);
  /**
   * The card focus is owed once the next version is on screen, or null when
   * nothing is owed. Written only when a patch consumed the step the drawer was
   * describing — see `morphTo` and the landing effect below.
   */
  const focusAfterMorph = useRef<{ id: string | null } | null>(null);
  // The same bargain `select` strikes, for the glow: which steps are on the
  // critical path is not a reason to run ELK again, so the layout reads the set
  // through a ref — and, beside it, whether there is a route being pointed at at
  // all.
  const criticalRef = useRef<ReadonlySet<string>>(new Set());
  const critpathRef = useRef(false);

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
      // `original` is a stable object for the life of a session, so this costs the
      // effect no extra runs — it is the same pass, remembered.
      if (original && graph === original) {
        originalLayout.current = { of: original, laidOut: g };
      }
      setLaidOut(g);
      // Fed the list it replaces, so React Flow's measurements survive the swap —
      // see the note on `toRFNodes` and error #015.
      setNodes((prev) =>
        toRFNodes(g, matched, selectedRef.current, criticalRef.current, critpathRef.current, prev),
      );
    });
    return () => {
      live = false;
    };
  }, [graph, layoutRun, setNodes, matched, original]);

  /**
   * The most painful way through the version on screen.
   *
   * Recomputed per version, which is the point: consolidating the hot step moves
   * the glow onto whatever is now the worst route, so the toggle shows the work
   * changing rather than a fact about the original graph. Nothing is computed at
   * all while the toggle is up — a graph nobody asked about answers `NO_PATH`.
   *
   * Stood down while the wipe is open — that mode is a single-purpose view, and
   * a route glowing on only one side of the divider would read as a difference
   * between the versions. The toggle's own state survives underneath: leave the
   * wipe and the glow is back where it was.
   */
  const path = useMemo(
    () => (showPath && !wipe ? criticalPath(graph) : NO_PATH),
    [graph, showPath, wipe],
  );
  const criticalNodes = useMemo(() => new Set(path.nodeIds), [path]);
  const criticalEdges = useMemo(() => new Set(path.edgeKeys), [path]);

  /**
   * Is there a route on screen for the rest of the graph to step back FROM?
   *
   * The toggle being down is not enough. A graph whose logical edges form a
   * cycle has no longest path at all, and `criticalPath` answers `NO_PATH`
   * rather than inventing one — so "everything not on the route" would be every
   * card and every edge, and the press would step the whole picture back with
   * nothing left lit to say why. On that graph the toggle shows nothing, which
   * is the honest answer to a question with none.
   */
  const critpathActive = path.nodeIds.length > 0;

  // The glow and the step-back, onto the cards already on screen. Data rather
  // than a class list because the card is React Flow's to render — and a patch,
  // not a rebuild, because turning a toggle on is not a reason to lay the graph
  // out again.
  useEffect(() => {
    criticalRef.current = criticalNodes;
    critpathRef.current = critpathActive;
    setNodes((ns) =>
      ns.map((n) => {
        const on = criticalNodes.has(n.id);
        const back = critpathActive && !on;
        return n.data.critical === on && n.data.offPath === back
          ? n
          : { ...n, data: { ...n.data, critical: on, offPath: back } };
      }),
    );
  }, [criticalNodes, critpathActive, setNodes]);

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

  /**
   * Lands the focus the morph owed, on the card the consumed step became.
   *
   * A patch that eats the drawer's subject unmounts the panel with focus inside it,
   * which drops focus on `<body>` — at the climax of the keyboard route, one keystroke
   * after APPLY was reached without a pointer. The replacement is where that step's
   * work went, so that is where the keyboard belongs: React Flow gives every card
   * `tabindex="0"`, so its wrapper takes focus directly.
   *
   * The wait is the same beat the FLIP above waits out. React Flow pushes our `nodes`
   * into its own store from an effect and mounts the new wrappers in the render that
   * follows, so at this effect's time the replacement's `data-id` is not in the DOM
   * yet — hence a few frames of asking. If it never arrives (or the effect had no
   * replacement to aim at), any card will do: what matters is that focus is back
   * inside the graph, and the pane itself carries no tabindex to hand it to.
   */
  useEffect(() => {
    if (!focusAfterMorph.current) return;
    const { id } = focusAfterMorph.current;
    let waited = 0;
    let frame = 0;
    const land = () => {
      const wrapper = id
        ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
        : null;
      if (!wrapper && id && ++waited < FOCUS_FRAME_BUDGET) {
        frame = requestAnimationFrame(land);
        return;
      }
      focusAfterMorph.current = null;
      (wrapper ?? document.querySelector<HTMLElement>('.react-flow__node'))?.focus();
    };
    frame = requestAnimationFrame(land);
    return () => cancelAnimationFrame(frame);
  }, [nodes]);

  useEffect(
    () => () => {
      window.clearTimeout(ghostTimer.current);
      window.clearTimeout(flipTimer.current);
      window.clearTimeout(exportTimer.current);
      window.clearTimeout(peekTimer.current);
    },
    [],
  );

  /**
   * Finds React Flow's transformed layer, which is where the arrowhead lives.
   *
   * The marker is referenced by `url(#ut-arrow)` — a document-wide lookup — so on
   * screen it makes no difference at all where the definition is written. It makes
   * every difference to the EXPORT: a capture is a clone of one element and its
   * descendants, and a definition outside that element is a definition the clone
   * does not have. Every arrowhead was missing from every shared picture.
   *
   * Reached by query rather than by ref because the element is React Flow's own.
   * A zero-sized absolutely-positioned `<svg>` paints nothing wherever it sits, so
   * the layer's transform has nothing to act on.
   */
  useEffect(() => {
    setDefsHost(paneRef.current?.querySelector<HTMLElement>('.react-flow__viewport') ?? null);
  }, [laidOut]);

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

  /**
   * The cards the entry and exit marks hang off — every `input` and every
   * `output`, wherever the layout put them and wherever the user has dragged
   * them since. Read off `nodes` rather than off ELK's answer for that reason:
   * drag the first step and its arrival stroke goes with it.
   */
  const endpointBoxes = useMemo<EndpointBox[]>(
    () =>
      nodes
        .filter((n) => n.data.node.kind === 'input' || n.data.node.kind === 'output')
        .map((n) => ({
          id: n.id,
          kind: n.data.node.kind,
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
        data: {
          kind: e.kind,
          label: e.label,
          index: i,
          back: backPlan.get(e.id),
          // The ids the path answers in are the ids the layout minted — see
          // `edgeKey` in graph/insight.ts, which both sides read.
          critical: criticalEdges.has(e.id),
          // The inversion's other half. Retries are never on the route — the
          // sweep drops them from the logical graph — so a loop back always
          // steps back with everything else the work does not run along.
          offPath: critpathActive && !criticalEdges.has(e.id),
          // Where the tag goes once everything else on the canvas is accounted
          // for. Absent for the tags that landed in clear air, which is most.
          tagOffset: tagOffsets.get(e.id),
        },
      })),
    [laidOut, backPlan, criticalEdges, critpathActive, tagOffsets],
  );

  /**
   * Keeps the edge tags out of the cards and out of each other.
   *
   * A tag is placed by the curve it belongs to, and the curve knows nothing about
   * what it passes — so a condition can land squarely on a step's title, or on the
   * condition next to it. This is the pass that notices. The RULE is pure and lives
   * in graph/labels.ts; what happens here is the measuring, which needs a browser.
   *
   * A frame is waited out first: React Flow pushes our nodes into its own store
   * from a passive effect and mounts the edge layer in the render after that, so at
   * this effect's own time the chips are either absent or still at last version's
   * positions. Re-run whenever the geometry moves — a drag, a relayout, an apply —
   * because all three change what is standing where.
   *
   * `edges` is in the list and `tagOffsets` feeds `edges`, which looks like a loop
   * and is not: the pass re-measures the point each tag's CURVE chose, never the
   * one it was moved to, so a second run over an unchanged graph plans the same
   * moves, the guard below sees no change, and nothing re-renders.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const planned = planLabels(readTagBoxes(paneRef.current), boxes);
      setTagOffsets((prev) => (sameOffsets(prev, planned) ? prev : planned));
    });
    return () => cancelAnimationFrame(frame);
  }, [boxes, edges]);

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
   *
   * `replacementId` is the node the patch put in place of what it ate, when it had
   * one — the only honest place for focus to go if the panel's own card is what left.
   * UNDO and the version jumps have no such node and pass nothing.
   */
  const morphTo = useCallback(
    (next: GraphSession, replacementId: string | null = null) => {
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
      if (selectedRef.current && !survives.has(selectedRef.current)) {
        closeDrawer();
        // Closing the panel unmounts the element focus is standing on, and its card
        // is not there to fall back to. Where focus goes instead is decided here and
        // carried out once the new cards exist — see the landing effect above.
        focusAfterMorph.current = {
          id: replacementId && survives.has(replacementId) ? replacementId : null,
        };
      }
      setOpened({ source: workflow, session: next });
    },
    [closeDrawer, nodes, workflow],
  );

  /**
   * The comparison's memory, written at the one moment it can be: the first
   * apply, while the cards on screen are still V0's — wherever the user dragged
   * them. After this the morph relayouts the canvas and the arrangement is gone
   * from everywhere but here. Keyed by the workflow and taken once: a later
   * apply, an undo-and-branch, a tour — none of them get to overwrite what the
   * original looked like when it stopped being the graph on screen.
   */
  const snapshotOriginal = useCallback(() => {
    if (originalPositions.current?.of === workflow) return;
    originalPositions.current = {
      of: workflow,
      at: new Map(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
    };
  }, [nodes, workflow]);

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
      // After the reducer said yes, before anything re-renders: `nodes` still
      // holds the arrangement this patch was applied to. A refusal above must
      // not freeze a snapshot for an apply that never happened.
      snapshotOriginal();
      // Read off the version the patch was applied to, where the row still exists:
      // the replacement is the step this one became, and the morph needs it in case
      // the card the panel is open on is the card being eaten.
      const applied = graph.suggestions.find((s) => s.airtableRecordId === airtableRecordId);
      // Before the morph, while the step this patch was applied to is still where
      // the user pressed it: what the patch bought rises off that card. Both routes
      // in — the drawer's own APPLY and the cinematic's — come through here, so the
      // tour celebrates each of its patches for the same reason a hand press does.
      if (applied) celebrate(applied.nodeId, applied.effect.metrics);
      morphTo(next, applied?.effect.replaceWith?.id ?? null);
    },
    [celebrate, graph, morphTo, session, snapshotOriginal],
  );

  const onUndo = useCallback(() => {
    if (!session) return;
    const back = undo(session);
    // undo at V0 hands the same session back — nothing to morph to, and a pending
    // plan would otherwise sit waiting for a layout that never comes
    if (back === session) return;
    morphTo(back);
  }, [morphTo, session]);

  const onRedo = useCallback(() => {
    if (!session) return;
    const forward = redo(session);
    // same no-op guard as UNDO, at the other end of the history
    if (forward === session) return;
    morphTo(forward);
  }, [morphTo, session]);

  const onJump = useCallback(
    (index: number) => {
      if (!session) return;
      let at: GraphSession;
      try {
        // Versions are STORED, not replayed: the reducer already built this exact
        // graph, so moving to it is a cursor move and the ones past it survive.
        at = jump(session, index);
      } catch {
        // An index outside the list is a caller bug the strip cannot produce — it
        // renders one chip per version. Defence in depth: the canvas stays where it
        // is rather than taking a RangeError through a click handler.
        return;
      }
      if (at === session) return; // the chip for the version already drawn
      morphTo(at);
    },
    [morphTo, session],
  );

  // -------------------------------------------------------------------------
  // The cinematic. One press applies the graph's best patches as a camera tour,
  // driving the SAME apply above — versions, chips and totals accumulate exactly
  // as they do under the drawer's own APPLY, and a tour started from a version
  // the cursor stepped back to branches over the forward history for the same
  // reason a hand-pressed APPLY does.
  // -------------------------------------------------------------------------

  /** Where a step's card is right now — after every drag, not where ELK put it. */
  const boxOf = useCallback(
    (nodeId: string) => {
      const n = nodes.find((x) => x.id === nodeId);
      if (!n) return null;
      return {
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? NODE_WIDTH,
        height: n.height ?? NODE_HEIGHT,
      };
    },
    [nodes],
  );

  const takeInstance = useCallback((instance: ReactFlowInstance<SignalRFNode, Edge>) => {
    rf.current = instance;
  }, []);

  const lookAt = useCallback((x: number, y: number) => {
    const instance = rf.current;
    if (!instance) return;
    const zoom = Math.min(TOUR_ZOOM_MAX, Math.max(TOUR_ZOOM_MIN, instance.getZoom()));
    // The promise resolves when the pan has finished; the tour keeps its own clock,
    // so nothing here waits on it — but a rejection must not surface as unhandled.
    instance.setCenter(x, y, { duration: CAMERA_MS, zoom }).catch(() => {});
  }, []);

  /**
   * The whole run in one commit — the route taken when motion is not wanted.
   *
   * The reducer is called once per patch, in the tour's order, and each answer is
   * the input to the next; only the last one reaches the canvas. A patch the run
   * before it consumed is skipped here for the same reason the paced tour skips
   * it, and what comes back is what actually landed — including the session,
   * which React has not re-rendered with yet at the moment this returns.
   */
  const applyAll = useCallback(
    (airtableRecordIds: string[]): TourResult => {
      if (!session) return { applied: 0, session: null };
      let next = session;
      let applied = 0;
      for (const id of airtableRecordIds) {
        try {
          next = applySuggestion(next, id);
          applied += 1;
        } catch {
          // a cascade took this row with the step it described
        }
      }
      if (applied > 0) {
        // The instant tour is still a first apply: same capture, same moment —
        // after the reducer took something, before the one commit below.
        snapshotOriginal();
        morphTo(next);
      }
      return { applied, session: next };
    },
    [morphTo, session, snapshotOriginal],
  );

  const onTourDone = useCallback(({ applied, session: ended }: TourResult) => {
    // Nothing applied, nothing to offer — a cancel before the first patch landed
    // leaves the graph exactly as it was, and a button saying so would be noise.
    if (applied === 0 || !ended) return;
    // No overlay auto-opens: the graph settles, and VIEW RESULTS appears where
    // the run's report used to. `ended` is the same object the last apply
    // committed as the live session, which is what the identity check reads.
    setTourEnded(ended);
  }, []);

  const { running, start, cancel } = useCinematic({
    getSession: () => session,
    boxOf,
    lookAt,
    applyOne: onApply,
    applyAll,
    onDone: onTourDone,
  });

  const startTour = useCallback(() => {
    // The tour owns the canvas: a panel left open would sit over the camera, and
    // its subject is about to be applied out from under it anyway. A stale VIEW
    // RESULTS goes too — the run about to start supersedes the one it spoke for.
    closeDrawer();
    setTourEnded(null);
    start();
  }, [closeDrawer, start]);

  /**
   * Lands focus on VIEW RESULTS the moment a run puts it up.
   *
   * The tour was started from a button and ran without the keyboard; the old
   * report used to take focus as a modal, and without that the keystroke after
   * a full tour would fall on <body> — OPTIMIZE unmounts when the run spends
   * every patch, taking focus down with it. The button that appeared is the
   * run's own continuation, so that is where the keyboard lands.
   */
  useEffect(() => {
    if (!tourEnded) return;
    document.querySelector<HTMLElement>('[data-testid="view-results-btn"]')?.focus();
  }, [tourEnded]);

  /** Which entry opened the window matters not; how focus leaves it does. */
  const focusAfterResults = useRef(false);

  /** The tour's entry: the button is spent by the click — PROMPT stands after. */
  const openResultsFromTour = useCallback(() => {
    setTourEnded(null);
    setResultsOpen(true);
  }, []);

  /** The standing entry, from the PROMPT toolbar button, at any cursor. */
  const openResults = useCallback(() => setResultsOpen(true), []);

  const closeResults = useCallback(() => {
    focusAfterResults.current = true;
    setResultsOpen(false);
  }, []);

  /**
   * The window's one exclusion move: a row's members step in or out TOGETHER.
   * A shared-string row is one checkbox over one line, so its ids travel as one
   * — and a single-resource row is the degenerate case of the same rule.
   */
  const onToggleInstalls = useCallback((memberIds: string[], include: boolean) => {
    setExcludeInstalls((prev) => {
      const next = new Set(prev);
      for (const id of memberIds) {
        if (include) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  /**
   * Hands focus back once the canvas is in a state to take it.
   *
   * Deliberately an effect and not a line in `closeResults`: dropping the window
   * is a state change, so at the moment the close handler runs the canvas is still
   * carrying `inert` — and a browser REFUSES focus into an inert subtree, silently.
   * Called there, every route out of the window (the button, Escape, the backdrop)
   * left focus on <body>. The effect runs after the commit that takes the attribute
   * off, which is the first moment the target will accept it.
   *
   * jsdom does not implement inert, so this is invisible to the suite by default —
   * the test that pins it installs the browser's refusal by hand.
   *
   * Where focus goes: PROMPT, the window's standing entry — it is on offer
   * whenever the window was (both stand on `showImpact`), and it is the control
   * a keyboard user reopens the window from. Failing that, a card the user can
   * actually SEE: the first card in the DOM is wherever ELK put it, and handing
   * focus there scrolls the pane out from under the person who was reading.
   * First in the document is the last resort, for a pane that measured nothing.
   */
  useEffect(() => {
    if (resultsOpen || !focusAfterResults.current) return;
    focusAfterResults.current = false;
    const button = document.querySelector<HTMLElement>('[data-testid="prompt-btn"]');
    (button ?? cardInView() ?? document.querySelector<HTMLElement>('.react-flow__node'))?.focus();
  }, [resultsOpen]);

  /** Is there anything for OPTIMIZE to do? The button exists only if there is. */
  const hasAppliable = useMemo(
    () => graph.suggestions.some((s) => canApply(s.airtableRecordId)),
    [canApply, graph],
  );

  /**
   * Every figure the impact panel states, recomputed whenever the session moves.
   *
   * A function of the session and nothing else, so an UNDO walks the totals, the
   * pain and the chart back together — see graph/metrics.ts.
   */
  const summary = useMemo(() => (session ? impactSummary(session) : null), [session]);

  /**
   * Is there an optimization story to tell at all?
   *
   * A graph the KB matched nothing to can never be optimized, and a panel reading
   * "NOTHING APPLIED YET" over it forever would be chrome making a promise the
   * graph cannot keep. Once a patch HAS landed the panel stays, even after the
   * last appliable row is spent — that is the moment it is most worth reading.
   */
  const showImpact = summary !== null && (hasAppliable || versionCount > 1);

  /**
   * Is the canvas answering to the user at all?
   *
   * False while the tour drives it, and false again while the Results Window is
   * up: the drawer draws at z6 and the backdrop at z7, so a panel opened now
   * would be a panel nobody can see, holding the focus. `inert` on the canvas is
   * what stops a pointer or a Tab reaching it; this is what stops the canvas's
   * own key handlers acting on something that got through anyway — and what
   * keeps the cursor still under a window that is reading the session live.
   */
  const canvasIdle = !running && !resultsOpen;

  /**
   * Is the canvas in a state where a peek would be an interruption?
   *
   * ONE flag, deliberately, and every mode that owns the canvas raises it: a card
   * mid-drag (the pointer is doing something, not asking something), the tour
   * driving the camera, the report holding the screen, a DRAWER already open on a
   * step, and the WIPE holding the two versions apart — a peek is a question
   * about the live graph, and the wipe is answering a different one.
   *
   * The drawer is in the list because a one-shot hide at the click was not enough,
   * and the reason is worth stating: opening the panel re-frames the canvas, the
   * cards slide out from under a pointer that never moved, and the browser
   * dispatches perfectly genuine mouseout/mouseover boundary events for the card
   * that arrived under it. The peek's own enter fires again — 150ms later a panel
   * drawing at z8 stands on top of the drawer at z6, saying the same row twice.
   * A peek is a question about a step; while the answer is open there is nothing
   * left to ask.
   */
  const peekSuppressed = dragging || !canvasIdle || selectedId !== null || wipe;

  const hidePeek = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    setPeek((open) => (open === null ? open : null));
  }, []);

  /**
   * The pointer came to rest on a step the KB matched.
   *
   * The wait is what makes this a question rather than a flicker: a pointer
   * crossing the graph on its way somewhere else passes over cards in a few
   * frames each, and a peek that opened on contact would be a panel strobing
   * along the route. 150ms is the pointer saying it meant this one — which is
   * timing, not motion, so it stands at every motion setting; what
   * prefers-reduced-motion drops is the entrance the card arrives with.
   *
   * The card's box is read at the END of the wait, off the DOM, because that is
   * where the pointer actually is by then and because React Flow owns where the
   * wrapper sits. A card that left in the meantime raises nothing.
   */
  const onNodeMouseEnter = useCallback(
    (_: unknown, node: SignalRFNode) => {
      if (peekSuppressed) return;
      // Never on an unmatched step: the peek states what the KB matched, and on a
      // card it matched nothing to there is nothing to state.
      if (node.data.suggestions.length === 0) return;
      window.clearTimeout(peekTimer.current);
      peekTimer.current = window.setTimeout(() => {
        const wrapper = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${node.id}"]`,
        );
        if (!wrapper) return;
        setPeek({ id: node.id, at: peekAnchor(wrapper.getBoundingClientRect(), window.innerWidth) });
      }, PEEK_DELAY_MS);
    },
    [peekSuppressed],
  );

  /** Leaving is instant, and cancels a peek that had not opened yet. */
  const onNodeMouseLeave = useCallback(() => hidePeek(), [hidePeek]);

  // A mode taking the canvas mid-peek drops it — the panel would otherwise hang
  // over a drag it is not about, or over a camera it cannot follow.
  //
  // `peek` is in the list as well as the flag, so this also catches one landing
  // DURING a suppressed mode: the timer was scheduled by a handler that closed
  // over the flag as it was when the pointer arrived, and a peek held in state
  // behind a mode would spring back the moment that mode released.
  useEffect(() => {
    if (peekSuppressed) hidePeek();
  }, [hidePeek, peek, peekSuppressed]);

  const onNodeDragStart = useCallback(() => setDragging(true), []);
  const onNodeDragStop = useCallback(() => setDragging(false), []);

  // Drag and click share the same gesture; React Flow tells them apart by
  // distance, and the tolerance is set on the ReactFlow element below — see the
  // note on `nodeClickDistance`, which is load-bearing for this handler ever
  // firing from a real mouse.
  const onNodeClick = useCallback(
    (_: unknown, node: SignalRFNode) => {
      // While the tour runs the canvas is being driven, not browsed: a panel
      // opening over the camera would be a second thing moving. The wipe is the
      // same refusal for a different mode — comparing is not browsing.
      if (!canvasIdle || wipe) return;
      // Nothing about the peek here: selecting a step raises `peekSuppressed`,
      // which is the one place that decides this — and it keeps deciding it for
      // as long as the panel is open, which a hide at the click could not.
      select(node.id);
    },
    [canvasIdle, select, wipe],
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
      if (!canvasIdle || wipe) return; // the tour, its report, or the wipe has the canvas
      const focused = document.activeElement;
      const wrapper = focused instanceof Element ? focused.closest('.react-flow__node') : null;
      const id = wrapper?.getAttribute('data-id');
      if (!id) return;
      if (!nodes.some((n) => n.id === id)) return;
      // Space would otherwise scroll the pane out from under the drawer
      e.preventDefault();
      select(id);
    },
    [canvasIdle, nodes, select, wipe],
  );
  // Selection is dropped here rather than left to the rebuild the effect will
  // do: ELK is async, and a ring that lingers until it answers reads as a button
  // that did nothing.
  const resetLayout = useCallback(() => {
    closeDrawer();
    setLayoutRun((n) => n + 1);
  }, [closeDrawer]);

  // -------------------------------------------------------------------------
  // The two overlays. Both are read-only: they change what is on screen and
  // nothing about the session, so neither one is undoable and neither one is a
  // version.
  // -------------------------------------------------------------------------

  /** ESC left focus on a handle that is about to unmount — spent by the effect below. */
  const focusAfterWipe = useRef(false);

  /**
   * VS ORIGINAL, toggled. A single-purpose mode: the drawer closes on the way
   * in, and the transform is taken at the press so the comparison lands in the
   * coordinate space the cards are drawn in right now — see `onViewportMove`
   * for what keeps it there.
   *
   * The surface is handed over clean, too. Inside the mode the canvas takes no
   * text selection at all — see `.sg-canvas--wipe` — so a highlight dragged
   * across the panels BEFORE the press would sit there for the mode's whole
   * life with no gesture left that could clear it. Dropped at the press rather
   * than in an effect: the mode's own entry point is where the rest of what it
   * stands down is stated.
   */
  const toggleWipe = useCallback(() => {
    if (wipe) {
      setWipe(false);
      return;
    }
    closeDrawer();
    window.getSelection?.()?.removeAllRanges();
    setWipeTransform(readViewportTransform());
    setWipe(true);
  }, [closeDrawer, wipe]);

  /** ESC's way out. The toggle keeps the keyboard: its control gets focus back. */
  const exitWipe = useCallback(() => {
    focusAfterWipe.current = true;
    setWipe(false);
  }, []);

  // Focus lands after the commit that unmounts the handle it was standing on —
  // the same bargain the results window's close makes, for the same reason.
  useEffect(() => {
    if (wipe || !focusAfterWipe.current) return;
    focusAfterWipe.current = false;
    document.querySelector<HTMLElement>('[data-testid="wipe-btn"]')?.focus();
  }, [wipe]);

  // The clip does not outlive the mode: whichever way the wipe closed, a stale
  // divider position must not paint for a commit when the mode next opens —
  // the remounted divider always starts in the middle.
  useEffect(() => {
    if (!wipe) setWipeClip(null);
  }, [wipe]);

  /**
   * Keeps the comparison under the graph while the pane moves beneath it.
   *
   * React Flow reports every viewport change here — a drag of the canvas, a
   * wheel zoom — and the original layer is a sibling of the pane rather than a
   * child of it, so this is what makes the two halves of the wipe move as one
   * world. Off, it costs one comparison per frame of a pan and nothing else.
   *
   * It is also where the peek finds out the world moved. The peek's anchor is a
   * one-shot snapshot of where the card stood when the pointer settled — screen
   * coordinates, taken once, never re-measured — so a wheel zoom scales the graph
   * out from under a panel still pointing at where the step USED to be. The
   * pointer never moved, so no boundary event is coming to take it down. Hidden
   * rather than re-anchored: a peek is the answer to "what is under my pointer",
   * and after the pane has moved that question has not been asked of the new
   * position yet. Every move counts, the camera's own included — a tour recentring
   * the graph moves the card just as far as a hand on the wheel does.
   */
  const onViewportMove = useCallback(
    (_: unknown, viewport: Viewport) => {
      hidePeek();
      if (!wipe) return;
      setWipeTransform(`translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`);
    },
    [hidePeek, wipe],
  );

  // The mode goes when the cursor stands on V0 again — a fresh file dropped on
  // the viewer, or a history walk that got all the way back. Comparing V0 with
  // V0 is a picture of one graph drawn twice, so the mode must not survive it.
  useEffect(() => {
    if (versionAt === 0) setWipe(false);
  }, [versionAt]);

  /**
   * How far the original must travel so its way IN stands exactly on the live
   * one — what makes the two sides of the divider read as one continuous
   * workflow. Anchored on the first `input` (in the original's own order) that
   * still stands in the live graph; a graph whose inputs were all consumed
   * anchors on the first surviving step instead, and one sharing nothing stays
   * where its own layout put it.
   */
  const wipeShift = useMemo(() => {
    const NONE = { dx: 0, dy: 0 };
    if (!wipe || !original) return NONE;
    const layout = originalLayout.current?.of === original ? originalLayout.current.laidOut : null;
    if (!layout) return NONE;
    const snap = originalPositions.current?.of === workflow ? originalPositions.current.at : null;
    const liveAt = new Map(nodes.map((n) => [n.id, n.position]));
    const anchor =
      original.nodes.find((n) => n.kind === 'input' && liveAt.has(n.id)) ??
      original.nodes.find((n) => liveAt.has(n.id));
    if (!anchor) return NONE;
    const from = snap?.get(anchor.id) ?? layout.nodes.find((n) => n.id === anchor.id);
    const to = liveAt.get(anchor.id);
    if (!from || !to) return NONE;
    return { dx: to.x - from.x, dy: to.y - from.y };
  }, [nodes, original, wipe, workflow]);

  const togglePath = useCallback(() => setShowPath((on) => !on), []);

  /**
   * The graph as a file. Toolbar-only since the Results Window took over from
   * the scorecard: the window is about the prompt, and the picture's one home
   * is the EXPORT button beside the graph it captures.
   *
   * The bounds come from `nodes` rather than from React Flow's instance: it is the
   * same set of cards, and this one is in hand whether or not the pane has
   * initialized — and it carries the positions the user dragged them to, so the
   * picture frames what is actually on screen.
   *
   * Nothing is captured of the toolbar or the chips. The header band the plan
   * floated would mean compositing a second render onto a canvas under the
   * viewport's PNG, and the graph is what a person shares; the chips are what they
   * say about it. Noted rather than done — see `exportPng.ts` on the dot grid,
   * which is the same kind of decision.
   */
  const runExport = useCallback(() => {
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewportEl) return;
    window.clearTimeout(exportTimer.current);
    setExportFailed(false);
    exportGraphPng({
      viewportEl,
      // Cards, the lanes the edges take around them, and the tags on those
      // edges: a back-edge's return run and a tag hanging off its point both
      // sit outside the node bounds, and framing on the cards clips them.
      bounds: contentBounds(getNodesBounds(nodes)),
      title: graph.meta.title,
      version: versionAt,
    }).catch((err: unknown) => {
      // Nothing here can fix a refused capture — a font the rasterizer could not
      // inline, a canvas the browser considers tainted — so it is reported where
      // the press was and written out for whoever opens the console.
      console.warn('untangle: PNG export failed', err);
      setExportFailed(true);
      exportTimer.current = window.setTimeout(() => setExportFailed(false), EXPORT_NOTE_MS);
    });
  }, [graph, nodes, versionAt]);

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
  // Derived from the id for the same reason the panel's subject is: a patch can
  // consume the very step the pointer is resting on, and a peek about a card that
  // is no longer there would outlive its subject. No card, no peek.
  //
  // The suppression is read HERE too, not only in the effect that clears the
  // state: the effect runs after the commit, so a mode raised in one render would
  // otherwise get a frame with the peek still painted over it.
  const peeked = peek && !peekSuppressed ? nodes.find((n) => n.id === peek.id) ?? null : null;

  return (
    <>
      {/* `inert` is what makes the Results Window modal in fact and not just in
          ARIA: with it, nothing behind the backdrop takes a click, a Tab or a
          keystroke — no version chip to jump the session out from under a window
          that is reading it LIVE, no card to open an invisible drawer on. It is
          dropped again the moment the window closes. */}
      {/* The morph durations ride on the root: every shell that FLIPs and every
          ghost that fades is inside this element, so one stamp reaches them all
          and the numbers CSS animates on are the ones TypeScript waits for. */}
      {/* The wipe modifier closes the surface to text selection for as long as
          the mode holds it — see the rule in canvas.css for why the clip makes
          that necessary. */}
      <div
        className={`sg-canvas${wipe ? ' sg-canvas--wipe' : ''}`}
        data-testid="canvas"
        inert={resultsOpen}
        style={MOTION_STYLE}
      >
        {/* Inside React Flow's viewport, which is the element an export captures —
            see the effect that finds it. On screen the placement is immaterial:
            `url(#ut-arrow)` is looked up across the whole document either way. */}
        {defsHost
          ? createPortal(
              <>
                <svg className="sg-defs" aria-hidden="true">
                  <defs>
                    <marker id="ut-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                      <path d="M 0 0 L 8 4 L 0 8" fill="none" stroke="context-stroke" strokeWidth="1.5" />
                    </marker>
                  </defs>
                </svg>
                {/* In the same layer, and for the same reason: the marks are part
                    of the graph, so they belong inside the element the export
                    captures and inside the transform the cards are drawn by. */}
                <EndpointMarks boxes={endpointBoxes} />
              </>,
              defsHost,
            )
          : null}
        <div className="sg-toolbar" data-testid="canvas-toolbar">
          <span className="sg-wf-title">{meta.title}</span>
          <span className="sg-chip">
            <b>{graph.nodes.length}</b> nodes
          </span>
          <span className="sg-chip">
            max pain <span className="sg-chip-hot">{'●'.repeat(maxPain)}</span>
          </span>
          <span className="sg-chip">{meta.kbSource === 'airtable' ? 'AIRTABLE' : 'KB NOT LINKED'}</span>
          {session ? null : (
            <span className="sg-chip sg-chip--refused" data-testid="suggestions-disabled">
              SUGGESTIONS DISABLED — DUPLICATE IDS
            </span>
          )}
          {session && (hasAppliable || running) && !wipe ? (
            // One slot, two jobs: the way in while there is a tour to start, the way
            // out while one is running. A second button appearing beside the first
            // would put the stop control somewhere the eye has not been. Absent
            // while the wipe is open — a tour would morph the live half of a
            // comparison someone is in the middle of reading.
            <button
              type="button"
              className={`sg-optimize${running ? ' sg-optimize--cancel' : ''}`}
              data-testid="optimize-btn"
              onClick={running ? cancel : startTour}
            >
              {running ? 'CANCEL' : 'OPTIMIZE'}
            </button>
          ) : null}
          {/* The run's own way into its results, standing where the report used
              to auto-open. Compared by identity: the moment the session leaves
              the optimized state — an undo, an apply, a version jump — the
              button stands down, and PROMPT is the entry that remains. Absent
              inside the wipe with OPTIMIZE, and back, still on offer, when the
              mode closes without having moved the session. */}
          {session && tourEnded === session && !wipe ? (
            <button
              type="button"
              className="sg-optimize sg-view-results"
              data-testid="view-results-btn"
              onClick={openResultsFromTour}
            >
              VIEW RESULTS
            </button>
          ) : null}
          {/* Absent while the tour runs: the camera is travelling and the cards are
              mid-morph, so a capture taken now is a picture of a version nobody has
              seen yet. It comes back the moment the run stops. Disabled while the
              wipe is open — the mode is transient, and a capture of a half-clipped
              canvas is a picture of neither version. */}
          {running ? null : (
            <button
              type="button"
              className="sg-ghost-btn"
              data-testid="export-btn"
              disabled={wipe}
              onClick={runExport}
            >
              EXPORT
            </button>
          )}
          {exportFailed ? (
            <span className="sg-chip sg-chip--refused" data-testid="export-failed" role="status">
              EXPORT FAILED
            </span>
          ) : null}
          {/* The standing way into the Results Window, at any cursor — V0's
              honest empty state included. Offered exactly where the impact
              panel is, same story: a graph with no optimization story has no
              optimized prompt to assemble. Disabled inside the wipe with the
              other read-the-graph controls, and while the tour is driving —
              a modal opened over a moving camera would be two modes fighting
              for one canvas. */}
          {showImpact ? (
            <button
              type="button"
              className="sg-ghost-btn"
              data-testid="prompt-btn"
              disabled={wipe || running}
              onClick={openResults}
            >
              PROMPT
            </button>
          ) : null}
          {/* Only once there is a difference to see: at V0 this would hold the
              graph up against itself. Absent while the tour runs, like EXPORT —
              opening a comparison under a moving camera would be two modes
              fighting for the same canvas. */}
          {versionAt > 0 && !running ? (
            <button
              type="button"
              className="sg-ghost-btn"
              data-testid="wipe-btn"
              aria-pressed={wipe}
              onClick={toggleWipe}
            >
              VS ORIGINAL
            </button>
          ) : null}
          <button
            type="button"
            className="sg-ghost-btn"
            data-testid="critpath-btn"
            aria-pressed={showPath}
            // Stood down inside the wipe, not hidden: the toggle's state survives
            // the mode, so the control stays where the eye left it.
            disabled={wipe}
            onClick={togglePath}
          >
            CRITICAL PATH
          </button>
          <button
            type="button"
            className="sg-ghost-btn"
            data-testid="reset-layout"
            // Stood down inside the wipe, like CRITICAL PATH beside it and for a
            // harder reason: this one MOVES the live half. A relayout mid-compare
            // walks the cards out from under a comparison the user is reading,
            // against an original layer anchored on where they were — the two
            // halves stop being one world while the seam is still open.
            disabled={wipe}
            onClick={resetLayout}
          >
            RESET LAYOUT
          </button>
        </div>
        {/* Away while the wipe is open: UNDO, REDO and the chips all move the
            live half of the comparison — leave the mode first. The strip is
            back, exactly as it was, the moment the wipe closes. */}
        {wipe ? null : (
          <VersionStrip
            count={versionCount}
            at={versionAt}
            onJump={onJump}
            onUndo={onUndo}
            onRedo={onRedo}
          />
        )}
        {/* The right-hand rail: the impact panel's column, alone since the
            Results Window absorbed the prompt and the kit. Still a column, so a
            future report panel joins by being rendered beside this one.

            Out of sight while the wipe is open, with the version strip and for
            the same reason: the rail stands at z5 over the divider's z4, so
            dragging the seam rightwards — the mode's whole gesture — walked the
            handle and its deltas in behind the impact panel, where the numbers
            could not be read and the handle could not be grabbed. Raising the
            divider over the rail would only have decided which of two things
            reads the same band; inside a single-purpose comparison the rail has
            nothing to add, because the delta strip at the seam already states
            the headline figures.

            HIDDEN, not unmounted — `.sg-canvas--wipe .sg-rail` in canvas.css.
            The mode is transient and the panel is holding state nobody re-made:
            folded away to its tab before the press, it must still be folded
            after ESC. `display: none` takes the column out of the layout, out
            of the pointer's way and out of the tab order for exactly as long as
            the mode holds the canvas, and the subtree that comes back is the
            one that left. */}
        {showImpact ? (
          <div className="sg-rail" data-testid="canvas-rail">
            <ImpactPanel summary={summary} />
          </div>
        ) : null}
        {/* The pane is a listening post for keys aimed at the focusable cards inside
            it — it takes no focus of its own and adds no keyboard trap. */}
        <div className="sg-viewport" ref={paneRef} onKeyDown={onPaneKeyDown}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            // The peek's whole gesture: rest on a card, leave it. Deliberately no
            // focus handler beside them — the keyboard route opens the drawer, and
            // a panel that raised itself on every Tab would be talking over it.
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onPaneClick={closeDrawer}
            onInit={takeInstance}
            onMove={onViewportMove}
            // The OVER half of the wipe: the live canvas, clipped from the left
            // up to wherever the divider stands. On the React Flow ROOT, which
            // is untransformed — a clip anywhere inside the viewport would be
            // panned and zoomed along with the world it is meant to divide.
            style={wipe && wipeClip ? { clipPath: wipeClip } : undefined}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.2}
            maxZoom={2}
            // Comparing is not editing: while the wipe is open the cards take no
            // drag and no ring, so the one thing moving is the divider. Pan and
            // zoom stay live — both layers share the transform, so the world
            // moves whole.
            nodesDraggable={!wipe}
            elementsSelectable={!wipe}
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
          {/* The wipe: the original under the live graph, the divider over both —
              see the z-index notes in wipe.css. `summary` is non-null whenever
              `session` is, and the mode cannot open without one. */}
          {wipe && summary && original && originalLayout.current?.of === original ? (
            <WipeCompare
              original={original}
              laidOut={originalLayout.current.laidOut}
              snapshot={
                originalPositions.current?.of === workflow ? originalPositions.current.at : null
              }
              shift={wipeShift}
              transform={wipeTransform}
              summary={summary}
              onClip={setWipeClip}
              onExit={exitWipe}
            />
          ) : null}
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
        {/* Portalled onto the document by the card itself, so it is never clipped
            by the pane it is drawn beside and never scaled by the zoom. */}
        {peek && peeked ? <PeekCard suggestions={peeked.data.suggestions} at={peek.at} /> : null}
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
      {/* Outside the canvas, not inside it: the window is what the canvas is inert
          FOR, and a modal nested in the thing it disables would disable itself.
          `.app-main` is the positioned ancestor either way, so the backdrop still
          covers exactly the same rectangle. */}
      {resultsOpen && session ? (
        <ResultsWindow
          session={session}
          excludeInstalls={excludeInstalls}
          onToggleInstalls={onToggleInstalls}
          onClose={closeResults}
        />
      ) : null}
      {/* Portalled onto the document by the layer itself, for the same reason the
          peek is: these are screen overlays, not part of the graph. */}
      <CelebrationLayer floats={floats} />
    </>
  );
}
