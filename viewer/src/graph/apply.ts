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
  /** versions[0] is the original; the last entry is what the canvas draws. */
  versions: Workflow[];
  /** airtableRecordId per applied step, parallel to versions[1..]. */
  appliedIds: string[];
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

export function createSession(wf: Workflow): GraphSession {
  return { versions: [wf], appliedIds: [], metrics: zeroMetrics() };
}

export function current(session: GraphSession): Workflow {
  return session.versions[session.versions.length - 1];
}

/**
 * Applies one suggestion's effect to the session's current workflow and returns
 * a new session. Nothing is mutated: Task 5's FLIP diffing compares the old and
 * new graphs by identity, so every surviving object is carried over untouched
 * and every container is fresh.
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

  return {
    versions: [...session.versions, next],
    appliedIds: [...session.appliedIds, airtableRecordId],
    metrics: addMetrics(session.metrics, effect.metrics),
  };
}

/**
 * Steps back one version. Metrics are recomputed from the original suggestion
 * list rather than subtracted — applied suggestions are stripped out of later
 * versions, so versions[0] is the only place their metrics still live.
 */
export function undo(session: GraphSession): GraphSession {
  if (session.versions.length <= 1) return session;

  const appliedIds = session.appliedIds.slice(0, -1);
  const byId = new Map(session.versions[0].suggestions.map((s) => [s.airtableRecordId, s]));
  const metrics = appliedIds.reduce<SessionMetrics>(
    (acc, id) => {
      const s = byId.get(id);
      return s ? addMetrics(acc, s.effect.metrics) : acc;
    },
    zeroMetrics(),
  );

  return { versions: session.versions.slice(0, -1), appliedIds, metrics };
}

export function reset(session: GraphSession): GraphSession {
  return createSession(session.versions[0]);
}
