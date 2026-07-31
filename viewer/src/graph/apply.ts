import schema from '../../../schema/workflow.schema.json';
import { createValidator } from '../../../scripts/validate-pure.mjs';
import type { EffectMetrics, Suggestion, Workflow } from './types';

// One compiled validator for the module's lifetime — the same contract the
// loader enforces, so a graph the reducer emits is indistinguishable from one
// that came off disk.
const validateWorkflow = createValidator(schema);

export interface SessionMetrics {
  stepsSaved: number;
  estTimeSavedMin: number;
  estTokensSaved: number;
  manualInterventionsRemoved: number;
}

export interface GraphSession {
  /** versions[0] is the original; `cursor` picks the one the canvas draws. */
  versions: Workflow[];
  /**
   * The airtableRecordId behind each transition, parallel to versions[1..] — the
   * WHOLE history, not just what is currently applied. What the graph on screen
   * has had done to it is `appliedIds.slice(0, cursor)`; anything past that is
   * the tail redo walks back into.
   */
  appliedIds: string[];
  /**
   * Which version is on the canvas. Undo and redo move it; the versions either
   * side of it stay put, which is what makes the walk reversible. Only a fresh
   * apply throws the forward half away — see `applySuggestion`.
   */
  cursor: number;
  /** Totals for the applied prefix — recomputed whenever the cursor moves. */
  metrics: SessionMetrics;
}

/**
 * Thrown when a patch cannot be applied without breaking the graph — either an
 * effect that contradicts itself, or one whose result fails the shared
 * validator. Generation is fallible; the reducer refuses rather than corrupts.
 */
export class InvalidEffectError extends Error {
  readonly errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'InvalidEffectError';
    this.errors = errors;
    Object.setPrototypeOf(this, InvalidEffectError.prototype);
  }
}

const ZERO: SessionMetrics = {
  stepsSaved: 0,
  estTimeSavedMin: 0,
  estTokensSaved: 0,
  manualInterventionsRemoved: 0,
};

const zeroMetrics = (): SessionMetrics => ({ ...ZERO });

function addMetrics(a: SessionMetrics, b: EffectMetrics): SessionMetrics {
  return {
    stepsSaved: a.stepsSaved + b.stepsSaved,
    estTimeSavedMin: a.estTimeSavedMin + b.estTimeSavedMin,
    estTokensSaved: a.estTokensSaved + b.estTokensSaved,
    manualInterventionsRemoved: a.manualInterventionsRemoved + b.manualInterventionsRemoved,
  };
}

/**
 * The totals for `appliedIds[0..cursor)`, summed off versions[0].
 *
 * Recomputed rather than added up as it goes: applying a suggestion strips it out
 * of every later version, so versions[0] is the only place its metrics still
 * live — and the cursor can land anywhere in the history, so there is no "last
 * step" to add or subtract. One expression answers every position.
 */
function metricsAt(versions: Workflow[], appliedIds: string[], cursor: number): SessionMetrics {
  const byId = new Map(versions[0].suggestions.map((s) => [s.airtableRecordId, s]));
  return appliedIds.slice(0, cursor).reduce<SessionMetrics>((acc, id) => {
    const s = byId.get(id);
    return s ? addMetrics(acc, s.effect.metrics) : acc;
  }, zeroMetrics());
}

/**
 * The same session, read from another version. Nothing is rebuilt: the versions
 * are exact records of what the reducer produced, so moving is a matter of saying
 * where to look and restating the totals for the prefix that got there.
 *
 * The version list and the id list are SHARED with the session handed in, not
 * copied — both are treated as immutable everywhere in this module, and sharing
 * them is the point of keeping history rather than replaying it.
 */
function withCursor(session: GraphSession, cursor: number): GraphSession {
  if (cursor === session.cursor) return session;
  return {
    ...session,
    cursor,
    metrics: metricsAt(session.versions, session.appliedIds, cursor),
  };
}

/** Every node id an effect names, other than the one it introduces. */
function referencedNodeIds(s: Suggestion): string[] {
  const refs = [s.nodeId, ...s.effect.removeNodes, ...s.effect.mergeNodes];
  const introduced = s.effect.replaceWith?.id;
  for (const e of s.effect.newEdges) {
    if (e.from !== introduced) refs.push(e.from);
    if (e.to !== introduced) refs.push(e.to);
  }
  return refs;
}

/**
 * Opens a session on a workflow, refusing one whose suggestions collide.
 *
 * `airtableRecordId` is the reducer's identity key — apply looks a suggestion
 * up by it, the removal filter drops it by it, and undo recomputes metrics by
 * it. Two cards sharing a row id (the same MCP matched to two nodes) breaks all
 * three: the filter deletes both on the first apply, so the second silently
 * vanishes uncounted, and undo's id lookup can land on the other twin's metrics
 * entirely. Later versions only ever drop suggestions, so guarding the entry
 * point guards every version after it.
 */
export function createSession(wf: Workflow): GraphSession {
  const seen = new Set<string>();
  for (const s of wf.suggestions) {
    if (seen.has(s.airtableRecordId)) {
      throw new InvalidEffectError(`duplicate suggestion id ${s.airtableRecordId} on the graph`);
    }
    seen.add(s.airtableRecordId);
  }
  return { versions: [wf], appliedIds: [], cursor: 0, metrics: zeroMetrics() };
}

export function current(session: GraphSession): Workflow {
  return session.versions[session.cursor];
}

/**
 * Applies one suggestion's effect to the version the cursor is on and returns a
 * new session. Nothing is mutated: Task 5's FLIP diffing compares the old and
 * new graphs by identity, so every surviving object is carried over untouched
 * and every container is fresh.
 *
 * Applying from anywhere but the newest version BRANCHES: the versions the cursor
 * stepped back from describe a future this patch has just replaced, so they are
 * dropped along with the ids that made them. That is the standard undo/redo
 * branch, and the only place forward history is ever lost.
 */
export function applySuggestion(session: GraphSession, airtableRecordId: string): GraphSession {
  const wf = current(session);
  const suggestion = wf.suggestions.find((s) => s.airtableRecordId === airtableRecordId);
  if (!suggestion) {
    // Also the idempotence guard: an applied suggestion is gone from the graph.
    throw new InvalidEffectError(`no suggestion ${airtableRecordId} on the current graph`);
  }

  const { effect } = suggestion;

  // --- refuse before building anything -------------------------------------
  const overlap = effect.removeNodes.filter((id) => effect.mergeNodes.includes(id));
  if (overlap.length > 0) {
    throw new InvalidEffectError(
      `effect both removes and merges ${overlap.join(', ')}`,
    );
  }

  const deleted = new Set([...effect.removeNodes, ...effect.mergeNodes]);
  const replacementId = effect.replaceWith?.id;

  for (const e of effect.newEdges) {
    for (const end of [e.from, e.to]) {
      // Naming a deleted node is only legal when this same effect puts that id
      // back as the replacement node.
      if (deleted.has(end) && end !== replacementId) {
        throw new InvalidEffectError(`newEdges reference "${end}", which the same effect removes`);
      }
    }
  }

  const survivors = wf.nodes.filter((n) => !deleted.has(n.id));
  if (replacementId && survivors.some((n) => n.id === replacementId)) {
    throw new InvalidEffectError(`replaceWith id "${replacementId}" collides with a surviving node`);
  }

  // --- build the next graph ------------------------------------------------
  const nodes = effect.replaceWith ? [...survivors, effect.replaceWith] : survivors;
  const edges = [
    ...wf.edges.filter((e) => !deleted.has(e.from) && !deleted.has(e.to)),
    ...effect.newEdges,
  ];
  // A suggestion whose target or effect names a node that no longer exists has
  // nothing left to say — it goes with the nodes it described.
  const suggestions = wf.suggestions.filter(
    (s) =>
      s.airtableRecordId !== airtableRecordId &&
      !referencedNodeIds(s).some((id) => deleted.has(id)),
  );

  const next: Workflow = { meta: { ...wf.meta }, nodes, edges, suggestions };

  const { valid, errors } = validateWorkflow(next);
  if (!valid) {
    throw new InvalidEffectError(
      `applying ${airtableRecordId} would break the graph: ${errors.join('; ')}`,
      errors,
    );
  }

  const at = session.cursor;
  const versions = [...session.versions.slice(0, at + 1), next];
  const appliedIds = [...session.appliedIds.slice(0, at), airtableRecordId];

  return {
    versions,
    appliedIds,
    cursor: at + 1,
    metrics: metricsAt(versions, appliedIds, at + 1),
  };
}

/**
 * Steps the cursor back one version. The version stepped off is KEPT, along with
 * the id that made it — `redo` is the way back, and the strip goes on showing it.
 * At V0 there is nowhere to go and the same session is handed straight back.
 */
export function undo(session: GraphSession): GraphSession {
  return withCursor(session, Math.max(0, session.cursor - 1));
}

/**
 * Steps the cursor forward into the history undo walked out of. A no-op at the
 * newest version, and after a branch there is nothing forward to step into.
 */
export function redo(session: GraphSession): GraphSession {
  return withCursor(session, Math.min(session.versions.length - 1, session.cursor + 1));
}

/**
 * Puts the cursor on version `index`, keeping every version either side of it.
 *
 * An index outside the list is a caller bug, not a user action — the strip only
 * ever offers versions that exist — so it throws rather than clamping to the
 * nearest legal answer and drawing a version nobody asked for.
 */
export function jump(session: GraphSession, index: number): GraphSession {
  if (!Number.isInteger(index) || index < 0 || index >= session.versions.length) {
    throw new RangeError(
      `no version ${index} in a session of ${session.versions.length}`,
    );
  }
  return withCursor(session, index);
}

/**
 * Start over: V0 alone, no history, nothing to redo into.
 *
 * Not the same action as `jump(session, 0)`, which draws the same graph while
 * keeping every version after it one click away. This one is the wipe — the
 * session that comes back is indistinguishable from a freshly opened one.
 *
 * No control on the canvas calls it: the viewer's start-over is dropping the file
 * again, which builds a fresh session the same way. It stays exported as the
 * reducer's start-over primitive — the thing that names what a wipe IS, pinned by
 * its own test — so a future control has it rather than reinventing it.
 */
export function reset(session: GraphSession): GraphSession {
  return createSession(session.versions[0]);
}
