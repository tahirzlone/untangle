import schema from '../../../schema/workflow.schema.json';
import { createValidator } from '../../../scripts/validate-pure.mjs';
import {
  applySuggestion,
  createSession,
  current,
  InvalidEffectError,
  jump,
  redo,
  reset,
  undo,
} from './apply';
import type { Suggestion, Workflow, WorkflowEdge, WorkflowNode } from './types';

const validateWorkflow = createValidator(schema);

// ---------------------------------------------------------------------------
// Fixture factory. Every call rebuilds from literals so a test that mutates
// (or a reducer that misbehaves) cannot leak into the next test.
//
//   intake → research → draft → review → ship
//                         ↑        ↓
//                         └─ fix ──┘   (branch out, retry back)
//
// Suggestion A folds research+draft into one automated step; suggestion B
// deletes the manual fix loop. They are deliberately disjoint — neither one's
// effect names a node the other deletes — so either order applies cleanly.
// ---------------------------------------------------------------------------

/** Airtable record ids are `rec` + exactly 14 alphanumerics (schema pattern). */
const rec = (c: string) => `rec${c.repeat(14)}`;
const REC_A = rec('A');
const REC_B = rec('B');
const REC_C = rec('C');

function nodes(): WorkflowNode[] {
  return [
    { id: 'intake', label: 'Take the ask', kind: 'input', description: 'Read the request.', painLevel: 1 },
    { id: 'research', label: 'Dig through docs', kind: 'process', description: 'Hand search.', painLevel: 3 },
    { id: 'draft', label: 'Write it by hand', kind: 'process', description: 'The slog.', painLevel: 5 },
    { id: 'review', label: 'Check the work', kind: 'review', description: 'Read it back.', painLevel: 4 },
    { id: 'fix', label: 'Patch the misses', kind: 'loop', description: 'Round and round.', painLevel: 2 },
    { id: 'ship', label: 'Hand it over', kind: 'output', description: 'Deliver.', painLevel: 1 },
  ];
}

function edges(): WorkflowEdge[] {
  return [
    { from: 'intake', to: 'research', kind: 'sequence' },
    { from: 'research', to: 'draft', kind: 'sequence' },
    { from: 'draft', to: 'review', kind: 'sequence' },
    { from: 'review', to: 'fix', kind: 'branch', label: 'needs work' },
    { from: 'fix', to: 'draft', kind: 'retry', label: 'again' },
    { from: 'review', to: 'ship', kind: 'sequence' },
  ];
}

function suggestionA(): Suggestion {
  return {
    nodeId: 'draft',
    airtableRecordId: REC_A,
    name: 'draft-writer',
    url: 'https://example.com/draft-writer',
    category: 'Claude Skill',
    claim: 'Researches and drafts in one pass.',
    install: '/plugin install draft-writer',
    effect: {
      removeNodes: [],
      mergeNodes: ['research', 'draft'],
      replaceWith: {
        id: 'auto-draft',
        label: 'Draft with the skill',
        kind: 'process',
        description: 'One call does the reading and the writing.',
        painLevel: 1,
      },
      newEdges: [
        { from: 'intake', to: 'auto-draft', kind: 'sequence' },
        { from: 'auto-draft', to: 'review', kind: 'sequence' },
      ],
      metrics: { stepsSaved: 2, estTimeSavedMin: 30, estTokensSaved: 4000, manualInterventionsRemoved: 1 },
    },
  };
}

function suggestionB(): Suggestion {
  return {
    nodeId: 'fix',
    airtableRecordId: REC_B,
    name: 'auto-fixer',
    url: 'https://example.com/auto-fixer',
    category: 'MCP Server',
    claim: 'Fixes what review flags without a human round trip.',
    effect: {
      removeNodes: ['fix'],
      mergeNodes: [],
      newEdges: [{ from: 'review', to: 'ship', kind: 'branch', label: 'clean' }],
      metrics: { stepsSaved: 1, estTimeSavedMin: 12, estTokensSaved: 900, manualInterventionsRemoved: 2 },
    },
  };
}

/**
 * A suggestion that restructures nothing — a plugin that makes the review step
 * cheaper without changing the shape of the work. It deletes no node, so the
 * cascade can never account for its disappearance: only the reducer's own
 * self-removal can take it out, and only a real idempotence guard can stop it
 * being applied twice.
 */
function suggestionC(): Suggestion {
  return {
    nodeId: 'review',
    airtableRecordId: REC_C,
    name: 'review-lens',
    url: 'https://example.com/review-lens',
    category: 'Claude Plugin',
    claim: 'Reads the draft back in one pass instead of three.',
    effect: {
      removeNodes: [],
      mergeNodes: [],
      newEdges: [],
      metrics: { stepsSaved: 0, estTimeSavedMin: 6, estTokensSaved: 300, manualInterventionsRemoved: 1 },
    },
  };
}

function makeWorkflow(
  suggestions: Suggestion[] = [suggestionA(), suggestionB(), suggestionC()],
): Workflow {
  return {
    meta: {
      task: 'write a thing',
      title: 'Write a thing',
      generatedAt: '2026-07-29T12:00:00Z',
      model: 'test',
      kbSource: 'airtable',
    },
    nodes: nodes(),
    edges: edges(),
    suggestions,
  };
}

/** A suggestion that is schema-valid on the base graph but breaks under the reducer. */
function brokenSuggestion(patch: Partial<Suggestion['effect']>, id = rec('X')): Suggestion {
  return {
    nodeId: 'draft',
    airtableRecordId: id,
    name: 'broken',
    url: 'https://example.com/broken',
    category: 'Other',
    claim: 'Structurally impossible.',
    effect: {
      removeNodes: [],
      mergeNodes: [],
      newEdges: [],
      metrics: { stepsSaved: 0, estTimeSavedMin: 0, estTokensSaved: 0, manualInterventionsRemoved: 0 },
      ...patch,
    },
  };
}

const ids = (wf: Workflow) => wf.nodes.map((n) => n.id);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** What the meter reads with nothing applied — V0, and every cursor sitting on it. */
const zeroed = {
  stepsSaved: 0,
  estTimeSavedMin: 0,
  estTokensSaved: 0,
  manualInterventionsRemoved: 0,
};

/**
 * Runs a patch that must be refused and hands back the error. `errors` is the
 * tell for *which* gate refused it: the up-front structural checks carry none,
 * while a refusal from the shared validator carries its complaints. Without
 * that distinction the pre-checks could all rot and the tests would still pass,
 * because a broken patch usually fails validation too — just later and with a
 * message no UI could explain.
 */
function refusal(run: () => unknown): InvalidEffectError {
  try {
    run();
  } catch (err) {
    if (err instanceof InvalidEffectError) return err;
    throw err;
  }
  throw new Error('expected the patch to be refused');
}

it('starts every session on the untouched workflow', () => {
  const wf = makeWorkflow();
  const s = createSession(wf);
  expect(s.versions).toHaveLength(1);
  expect(s.versions[0]).toEqual(wf);
  expect(s.cursor).toBe(0);
  expect(s.appliedIds).toEqual([]);
  expect(s.metrics).toEqual({
    stepsSaved: 0,
    estTimeSavedMin: 0,
    estTokensSaved: 0,
    manualInterventionsRemoved: 0,
  });
  expect(validateWorkflow(wf).valid).toBe(true);
});

it('current() hands back the version the cursor is on', () => {
  const s = createSession(makeWorkflow());
  expect(current(s)).toBe(s.versions[0]);
  const next = applySuggestion(s, REC_A);
  expect(current(next)).toBe(next.versions[next.cursor]);
  expect(current(next)).not.toEqual(current(s));
  // and the cursor is what moves it, not the length of the list
  expect(current(undo(next))).toBe(next.versions[0]);
});

it('deletes both removeNodes and mergeNodes from the graph', () => {
  const merged = current(applySuggestion(createSession(makeWorkflow()), REC_A));
  expect(ids(merged)).not.toContain('research');
  expect(ids(merged)).not.toContain('draft');

  const removed = current(applySuggestion(createSession(makeWorkflow()), REC_B));
  expect(ids(removed)).not.toContain('fix');
});

it('adds replaceWith as a new node, cooling the hot step it replaces', () => {
  const before = createSession(makeWorkflow());
  expect(current(before).nodes.find((n) => n.id === 'draft')?.painLevel).toBe(5);

  const after = current(applySuggestion(before, REC_A));
  const added = after.nodes.find((n) => n.id === 'auto-draft');
  expect(added).toEqual(suggestionA().effect.replaceWith);
  expect(added?.painLevel).toBe(1);
  expect(after.nodes).toHaveLength(5); // 6 - 2 merged + 1 replacement
});

it('drops every edge that touches a deleted node', () => {
  const after = current(applySuggestion(createSession(makeWorkflow()), REC_A));
  const dead = new Set(['research', 'draft']);
  for (const e of after.edges) {
    expect(dead.has(e.from)).toBe(false);
    expect(dead.has(e.to)).toBe(false);
  }
  // intake→research, research→draft, draft→review and fix→draft all die.
  expect(after.edges.filter((e) => e.from === 'review')).toHaveLength(2);
});

it('adds newEdges verbatim, labels and kinds intact', () => {
  const after = current(applySuggestion(createSession(makeWorkflow()), REC_B));
  expect(after.edges).toContainEqual({ from: 'review', to: 'ship', kind: 'branch', label: 'clean' });

  const merged = current(applySuggestion(createSession(makeWorkflow()), REC_A));
  for (const e of suggestionA().effect.newEdges) expect(merged.edges).toContainEqual(e);
});

it('removes the applied suggestion and leaves untouched ones alone', () => {
  const after = current(applySuggestion(createSession(makeWorkflow()), REC_A));
  const remaining = after.suggestions.map((s) => s.airtableRecordId);
  expect(remaining).toEqual([REC_B, REC_C]);
});

it('removes the applied suggestion itself when its effect deletes nothing', () => {
  const wf = makeWorkflow();
  const after = current(applySuggestion(createSession(wf), REC_C));
  // The graph is untouched, so the cascade cannot be what removed the card:
  // only the reducer dropping the suggestion it just applied explains this.
  expect(ids(after)).toEqual(ids(wf));
  expect(after.edges).toEqual(wf.edges);
  expect(after.suggestions.map((s) => s.airtableRecordId)).toEqual([REC_A, REC_B]);
});

it('refuses a second apply of a suggestion that deleted nothing', () => {
  const once = applySuggestion(createSession(makeWorkflow()), REC_C);
  expect(current(once).nodes).toHaveLength(6); // nothing was consumed
  const err = refusal(() => applySuggestion(once, REC_C));
  expect(err.errors).toEqual([]);
});

it('refuses a workflow that carries the same Airtable row twice', () => {
  // One MCP matched to two nodes. The schema permits it, but airtableRecordId is
  // the reducer's identity key: the removal filter would drop both cards on the
  // first apply, and undo would recompute metrics off the wrong twin.
  const twin: Suggestion = { ...suggestionB(), airtableRecordId: REC_A };
  const wf = makeWorkflow([suggestionA(), twin]);
  expect(validateWorkflow(wf).valid).toBe(true);
  const err = refusal(() => createSession(wf));
  expect(err.message).toMatch(/duplicate/i);
  expect(err.errors).toEqual([]);
});

it('cascades away a suggestion whose target node was deleted', () => {
  const orphan = { ...suggestionB(), nodeId: 'draft', airtableRecordId: rec('D') };
  const after = current(applySuggestion(createSession(makeWorkflow([suggestionA(), orphan])), REC_A));
  expect(after.suggestions).toHaveLength(0);
});

it('cascades away a suggestion whose newEdges reference a deleted node', () => {
  const orphan: Suggestion = {
    ...suggestionB(),
    airtableRecordId: rec('E'),
    nodeId: 'review',
    effect: {
      ...suggestionB().effect,
      removeNodes: [],
      newEdges: [{ from: 'draft', to: 'ship', kind: 'sequence' }],
    },
  };
  const after = current(applySuggestion(createSession(makeWorkflow([suggestionA(), orphan])), REC_A));
  expect(after.suggestions).toHaveLength(0);
});

it('cascades away a suggestion whose removeNodes reference a deleted node', () => {
  const orphan: Suggestion = {
    ...suggestionB(),
    airtableRecordId: rec('F'),
    nodeId: 'review',
    effect: { ...suggestionB().effect, removeNodes: ['research'], newEdges: [] },
  };
  const after = current(applySuggestion(createSession(makeWorkflow([suggestionA(), orphan])), REC_A));
  expect(after.suggestions).toHaveLength(0);
});

it('accumulates metrics across two applies and grows versions in step', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  expect(one.metrics).toEqual(suggestionA().effect.metrics);
  expect(one.versions).toHaveLength(2);
  expect(one.cursor).toBe(1);
  expect(one.appliedIds).toEqual([REC_A]);

  const two = applySuggestion(one, REC_B);
  expect(two.metrics).toEqual({
    stepsSaved: 3,
    estTimeSavedMin: 42,
    estTokensSaved: 4900,
    manualInterventionsRemoved: 3,
  });
  expect(two.versions).toHaveLength(3);
  expect(two.cursor).toBe(2);
  expect(two.appliedIds).toEqual([REC_A, REC_B]);
  expect(ids(current(two)).sort()).toEqual(['auto-draft', 'intake', 'review', 'ship']);
});

it('produces a workflow that passes the shared validator, in either order', () => {
  for (const order of [
    [REC_A, REC_B],
    [REC_B, REC_A],
  ]) {
    let s = createSession(makeWorkflow());
    for (const id of order) {
      s = applySuggestion(s, id);
      const { valid, errors } = validateWorkflow(current(s));
      expect(errors).toEqual([]);
      expect(valid).toBe(true);
    }
  }
});

// Undo walks the CURSOR back. The versions it steps off stay in the list — that is
// the whole of redo, and the reason the strip can keep showing them.
it('undo restores the exact prior workflow and rolls the metrics back', () => {
  const start = createSession(makeWorkflow());
  const one = applySuggestion(start, REC_A);
  const two = applySuggestion(one, REC_B);

  const back = undo(two);
  expect(back.cursor).toBe(1);
  expect(current(back)).toBe(two.versions[1]);
  expect(current(back)).toEqual(current(one));
  expect(back.metrics).toEqual(suggestionA().effect.metrics);
  // history is kept whole: the version stepped off is still there, and so is the
  // id that made it
  expect(back.versions).toHaveLength(3);
  expect(back.appliedIds).toEqual([REC_A, REC_B]);

  const start2 = undo(back);
  expect(start2.cursor).toBe(0);
  expect(current(start2)).toEqual(makeWorkflow());
  expect(start2.versions).toHaveLength(3);
  expect(start2.metrics).toEqual({
    stepsSaved: 0,
    estTimeSavedMin: 0,
    estTokensSaved: 0,
    manualInterventionsRemoved: 0,
  });
});

it('undo at version 0 is a no-op', () => {
  const s = createSession(makeWorkflow());
  expect(undo(s)).toBe(s);
});

it('redo walks the cursor forward again, exactly', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const round = redo(undo(two));

  // not "a graph like it" — the same stored version, and the same totals
  expect(round).toEqual(two);
  expect(current(round)).toBe(current(two));
  expect(round.cursor).toBe(2);
  expect(round.metrics).toEqual(two.metrics);
});

it('redo at the newest version is a no-op', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  expect(redo(one)).toBe(one);
  const fresh = createSession(makeWorkflow());
  expect(redo(fresh)).toBe(fresh); // a session with no history at all
});

it('undo/redo leave the session they were handed untouched', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const before = clone(two);
  const back = undo(two);
  redo(back);
  expect(two).toEqual(before);
  // the cursor moves on a new object; the version list is shared, not copied
  expect(back).not.toBe(two);
  expect(back.versions).toBe(two.versions);
});

it('jump moves the cursor without touching the history either side of it', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const at1 = jump(two, 1);

  expect(at1.cursor).toBe(1);
  expect(current(at1)).toBe(two.versions[1]);
  // the Phase-3 ruling reversed: the forward version SURVIVES a jump backwards
  expect(at1.versions).toHaveLength(3);
  expect(at1.appliedIds).toEqual([REC_A, REC_B]);
  expect(at1.metrics).toEqual(suggestionA().effect.metrics);
  // and the way back is a jump forward
  expect(jump(at1, 2)).toEqual(two);
});

it('jump to the version already on the cursor is a no-op', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  expect(jump(one, 1)).toBe(one);
});

it('jump refuses an index no version answers to', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  for (const bad of [-1, 2, 99, 0.5, NaN]) {
    expect(() => jump(one, bad)).toThrow(RangeError);
  }
  // a refusal is not a silent clamp: the session is exactly where it was
  expect(one.cursor).toBe(1);
});

it('reports the applied-prefix metrics at every cursor position', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const a = suggestionA().effect.metrics;
  const b = suggestionB().effect.metrics;

  expect(jump(two, 0).metrics).toEqual(zeroed);
  expect(jump(two, 1).metrics).toEqual(a);
  expect(jump(two, 2).metrics).toEqual({
    stepsSaved: a.stepsSaved + b.stepsSaved,
    estTimeSavedMin: a.estTimeSavedMin + b.estTimeSavedMin,
    estTokensSaved: a.estTokensSaved + b.estTokensSaved,
    manualInterventionsRemoved: a.manualInterventionsRemoved + b.manualInterventionsRemoved,
  });
  // walked, not jumped — the same totals either way round
  expect(undo(undo(two)).metrics).toEqual(zeroed);
  expect(redo(undo(undo(two))).metrics).toEqual(a);
});

// The standard branch. Applying from a version the cursor stepped back to makes a
// new future, and the old one cannot survive it: versions[2] described a graph this
// patch was never applied to.
it('applying from mid-history drops the versions after the cursor', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const branched = applySuggestion(jump(two, 1), REC_C);

  expect(branched.versions).toHaveLength(3);
  expect(branched.cursor).toBe(2);
  expect(branched.appliedIds).toEqual([REC_A, REC_C]);
  expect(branched.metrics).toEqual({
    stepsSaved: 2,
    estTimeSavedMin: 36,
    estTokensSaved: 4300,
    manualInterventionsRemoved: 2,
  });

  // B's patch was never applied on this branch, so the manual fix loop is still
  // in the graph and its card is still on offer
  expect(ids(current(branched))).toContain('fix');
  expect(current(branched).suggestions.map((s) => s.airtableRecordId)).toEqual([REC_B]);
  // versions[0..1] are the ones the branch grew from, untouched
  expect(branched.versions[0]).toBe(two.versions[0]);
  expect(branched.versions[1]).toBe(two.versions[1]);
  // there is nothing to redo into
  expect(redo(branched)).toBe(branched);
  // and the session it branched from is exactly as it was
  expect(two.versions).toHaveLength(3);
  expect(two.appliedIds).toEqual([REC_A, REC_B]);
});

// Two different intentions that both land on V0: "show me the start" keeps the
// history, "start over" throws it away.
it('reset wipes the history that jump(0) keeps', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);

  const back = reset(two);
  expect(back.versions).toHaveLength(1);
  expect(back.cursor).toBe(0);
  expect(current(back)).toEqual(makeWorkflow());
  expect(back.appliedIds).toEqual([]);
  expect(back.metrics).toEqual(zeroed);
  expect(redo(back)).toBe(back); // nothing forward to walk into

  const at0 = jump(two, 0);
  expect(current(at0)).toEqual(current(back)); // the same graph on screen…
  expect(at0.versions).toHaveLength(3); // …with the way forward still open
  expect(at0.appliedIds).toEqual([REC_A, REC_B]);
  expect(at0.metrics).toEqual(zeroed);
  expect(redo(at0)).toEqual(jump(two, 1));
});

it('throws InvalidEffectError for an id no live suggestion carries', () => {
  const s = createSession(makeWorkflow());
  expect(() => applySuggestion(s, rec('Z'))).toThrow(InvalidEffectError);
});

it('throws when the same suggestion is applied twice', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  expect(() => applySuggestion(one, REC_A)).toThrow(InvalidEffectError);
});

it('refuses newEdges that reference a node the same effect removes', () => {
  const bad = brokenSuggestion({
    mergeNodes: ['draft'],
    newEdges: [{ from: 'draft', to: 'review', kind: 'sequence' }],
  });
  const wf = makeWorkflow([bad]);
  expect(validateWorkflow(wf).valid).toBe(true); // schema-clean, reducer-hostile
  const err = refusal(() => applySuggestion(createSession(wf), bad.airtableRecordId));
  expect(err.message).toMatch(/same effect removes/);
  expect(err.errors).toEqual([]); // caught up front, not by the validator
});

it('allows newEdges onto a removed id when replaceWith puts that id back', () => {
  const inPlace = brokenSuggestion({
    mergeNodes: ['draft', 'fix'],
    replaceWith: {
      id: 'draft',
      label: 'Draft, automated',
      kind: 'process',
      description: 'Same slot in the flow, none of the work.',
      painLevel: 1,
    },
    newEdges: [
      { from: 'research', to: 'draft', kind: 'sequence' },
      { from: 'draft', to: 'review', kind: 'sequence' },
    ],
  });
  const after = current(applySuggestion(createSession(makeWorkflow([inPlace])), inPlace.airtableRecordId));
  expect(after.nodes.find((n) => n.id === 'draft')?.painLevel).toBe(1);
  expect(ids(after)).not.toContain('fix');
  expect(validateWorkflow(after).valid).toBe(true);
});

it('refuses a replaceWith id that collides with a surviving node', () => {
  const bad = brokenSuggestion({
    mergeNodes: ['draft'],
    replaceWith: { id: 'ship', label: 'Clash', kind: 'process', description: 'Same id as a live node.', painLevel: 1 },
  });
  const wf = makeWorkflow([bad]);
  expect(validateWorkflow(wf).valid).toBe(true);
  const err = refusal(() => applySuggestion(createSession(wf), bad.airtableRecordId));
  expect(err.message).toMatch(/collides/);
  expect(err.errors).toEqual([]);
});

it('refuses an effect that both removes and merges the same node', () => {
  const bad = brokenSuggestion({ removeNodes: ['draft'], mergeNodes: ['draft'] });
  const wf = makeWorkflow([bad]);
  expect(validateWorkflow(wf).valid).toBe(true);
  const err = refusal(() => applySuggestion(createSession(wf), bad.airtableRecordId));
  expect(err.message).toMatch(/removes and merges/);
  expect(err.errors).toEqual([]);
});

it('refuses a patch whose result would not survive the validator', () => {
  const bad = brokenSuggestion({ removeNodes: ['research', 'draft', 'review', 'fix'] });
  const wf = makeWorkflow([bad]);
  expect(validateWorkflow(wf).valid).toBe(true);
  // Two nodes and no edges left — the schema minimums fail, so the patch is refused.
  const err = refusal(() => applySuggestion(createSession(wf), bad.airtableRecordId));
  expect(err.errors.length).toBeGreaterThan(0); // the validator is what refused it
  expect(err.message).toMatch(/would break the graph/);
});

it('leaves the input session untouched when a patch is refused', () => {
  const bad = brokenSuggestion({ removeNodes: ['draft'], mergeNodes: ['draft'] });
  const s = createSession(makeWorkflow([suggestionA(), bad]));
  const before = clone(s);
  expect(() => applySuggestion(s, bad.airtableRecordId)).toThrow(InvalidEffectError);
  expect(s).toEqual(before);
});

it('leaves the input session and its workflow untouched on a successful apply', () => {
  const wf = makeWorkflow();
  const s = createSession(wf);
  const before = clone(s);
  const wfBefore = clone(wf);

  const next = applySuggestion(s, REC_A);

  expect(s).toEqual(before);
  expect(wf).toEqual(wfBefore);
  expect(next.versions[0]).toEqual(wfBefore);
  // fresh containers, not the caller's arrays
  expect(next.versions).not.toBe(s.versions);
  expect(next.appliedIds).not.toBe(s.appliedIds);
  expect(next.metrics).not.toBe(s.metrics);
  expect(current(next).nodes).not.toBe(wf.nodes);
});

it('keeps earlier versions frozen as later ones are applied', () => {
  const one = applySuggestion(createSession(makeWorkflow()), REC_A);
  const snapshot = clone(one.versions);
  applySuggestion(one, REC_B);
  expect(one.versions).toEqual(snapshot);
});
