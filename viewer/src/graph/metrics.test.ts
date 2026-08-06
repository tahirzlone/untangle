import { applySuggestion, createSession, jump, redo, undo } from './apply';
import {
  complexity,
  impactLabel,
  impactParts,
  impactSummary,
  impactUnit,
  painLabel,
  painPercent,
  painTotals,
} from './metrics';
import type { Suggestion, Workflow, WorkflowEdge, WorkflowNode } from './types';

// ---------------------------------------------------------------------------
// Fixture. Rebuilt from literals per call, like apply.test.ts's, so a reducer
// that misbehaves cannot leak one test's graph into the next.
//
//   intake → research → draft → review → ship
//                         ↑        ↓
//                         └─ fix ──┘
//
// Pain: 1 + 3 + 5 + 4 + 2 + 1 = 16 over 6 nodes and 6 edges.
// A folds research+draft into one pain-1 step; B deletes the manual fix loop.
// ---------------------------------------------------------------------------

const rec = (c: string) => `rec${c.repeat(14)}`;
const REC_A = rec('A');
const REC_B = rec('B');

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

function makeWorkflow(suggestions: Suggestion[] = [suggestionA(), suggestionB()]): Workflow {
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

const ZERO = {
  stepsSaved: 0,
  estTimeSavedMin: 0,
  estTokensSaved: 0,
  manualInterventionsRemoved: 0,
};

// ---------------------------------------------------------------------------
// The counts
// ---------------------------------------------------------------------------

it('sums the pain of every step in a version', () => {
  expect(painTotals(makeWorkflow())).toBe(16);
});

// reduce over an empty list, not Math.max of a spread: a graph with no steps
// answers 0 rather than throwing or answering -Infinity.
it('answers zero pain for a graph with no steps', () => {
  expect(painTotals({ ...makeWorkflow(), nodes: [], edges: [] })).toBe(0);
});

it('states complexity as two counts, never as one invented score', () => {
  expect(complexity(makeWorkflow())).toEqual({ nodes: 6, edges: 6 });
});

it('reads the reduction as a whole percent of the pain the graph arrived with', () => {
  expect(painPercent(16, 8)).toBe(50);
  // 43.75 — the graph after the first patch below
  expect(painPercent(16, 9)).toBe(44);
});

it('reserves 100% for a graph with no pain left', () => {
  expect(painPercent(16, 0)).toBe(100);
  // 99.6% rounds to 100, and a painful step is still on the canvas — so it does not
  expect(painPercent(1000, 4)).toBe(99);
});

it('answers zero rather than dividing by a graph that arrived painless', () => {
  expect(painPercent(0, 0)).toBe(0);
});

// A replacement step may hurt more than what it replaced. Reporting that as a
// reduction of zero would be the summary declining to say what happened.
it('reports a graph that got harder as a negative reduction', () => {
  expect(painPercent(10, 12)).toBe(-20);
});

// ---------------------------------------------------------------------------
// The summary, at every cursor position
// ---------------------------------------------------------------------------

it('reads a fresh session as the graph as it arrived, with nothing saved', () => {
  const summary = impactSummary(createSession(makeWorkflow()));

  expect(summary.at).toBe(0);
  expect(summary.perVersion).toEqual([{ index: 0, pain: 16, complexity: { nodes: 6, edges: 6 } }]);
  expect(summary.totals).toEqual(ZERO);
  expect(summary.painBefore).toBe(16);
  expect(summary.painNow).toBe(16);
  expect(summary.painPct).toBe(0);
  expect(summary.complexityBefore).toEqual({ nodes: 6, edges: 6 });
  expect(summary.complexityNow).toEqual(summary.complexityBefore);
});

it('measures every version the session holds, and says which one is on the canvas', () => {
  const session = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const summary = impactSummary(session);

  expect(summary.at).toBe(2);
  expect(summary.perVersion).toEqual([
    { index: 0, pain: 16, complexity: { nodes: 6, edges: 6 } },
    // research+draft become one pain-1 step: four of the six edges named a node
    // this patch consumed, and two came back in its place
    { index: 1, pain: 9, complexity: { nodes: 5, edges: 4 } },
    // the fix loop goes, taking the retry back into the draft with it
    { index: 2, pain: 7, complexity: { nodes: 4, edges: 4 } },
  ]);
  expect(summary.painBefore).toBe(16);
  expect(summary.painNow).toBe(7);
  expect(summary.painPct).toBe(56);
  expect(summary.complexityBefore).toEqual({ nodes: 6, edges: 6 });
  expect(summary.complexityNow).toEqual({ nodes: 4, edges: 4 });
  expect(summary.totals).toEqual({
    stepsSaved: 3,
    estTimeSavedMin: 42,
    estTokensSaved: 4900,
    manualInterventionsRemoved: 3,
  });
});

// The whole point of composing over the reducer rather than accumulating: the
// cursor can land anywhere, and every figure has to be true THERE.
it('follows the cursor back through UNDO, versions and all', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);

  const back = impactSummary(undo(two));
  expect(back.at).toBe(1);
  expect(back.painNow).toBe(9);
  expect(back.painPct).toBe(44);
  expect(back.complexityNow).toEqual({ nodes: 5, edges: 4 });
  expect(back.totals).toEqual({
    stepsSaved: 2,
    estTimeSavedMin: 30,
    estTokensSaved: 4000,
    manualInterventionsRemoved: 1,
  });
  // the version stepped off is still measured — the strip still offers it
  expect(back.perVersion).toHaveLength(3);

  const start = impactSummary(undo(undo(two)));
  expect(start.at).toBe(0);
  expect(start.painNow).toBe(16);
  expect(start.painPct).toBe(0);
  expect(start.complexityNow).toEqual({ nodes: 6, edges: 6 });
  expect(start.totals).toEqual(ZERO);
  expect(start.perVersion).toHaveLength(3);
});

it('follows it forward again through REDO and a jump', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const walked = redo(undo(undo(two)));

  expect(impactSummary(walked).at).toBe(1);
  expect(impactSummary(walked).painNow).toBe(9);
  expect(impactSummary(redo(walked)).painNow).toBe(7);
  expect(impactSummary(jump(two, 0)).painNow).toBe(16);
  expect(impactSummary(jump(two, 2)).painPct).toBe(56);
});

// Applying from a version the cursor stepped back to drops the future that was
// there — so the chart has to lose those bars with it.
it('loses the versions a mid-history apply truncated', () => {
  const two = applySuggestion(applySuggestion(createSession(makeWorkflow()), REC_A), REC_B);
  const branched = applySuggestion(undo(two), REC_B);
  const summary = impactSummary(branched);

  expect(summary.perVersion.map((v) => v.index)).toEqual([0, 1, 2]);
  expect(summary.at).toBe(2);
  // the branch's own totals, not the abandoned version's
  expect(summary.totals.estTimeSavedMin).toBe(42);
  expect(summary.painNow).toBe(7);
});

// A patch can restructure the graph while claiming nothing at all. The savings
// are zero and the graph still got simpler — both have to be reported.
it('reports the shape of a patch that claims no saving', () => {
  const wf = makeWorkflow([{ ...suggestionB(), effect: { ...suggestionB().effect, metrics: { ...ZERO } } }]);
  const summary = impactSummary(applySuggestion(createSession(wf), REC_B));

  expect(summary.totals).toEqual(ZERO);
  expect(impactParts(summary.totals)).toEqual([]);
  expect(summary.painNow).toBe(14);
  expect(summary.painPct).toBe(13);
  // the two edges the fix loop stood on go with it, and the clean branch arrives
  expect(summary.complexityNow).toEqual({ nodes: 5, edges: 5 });
});

// ---------------------------------------------------------------------------
// The words. Moved here with the numbers: the panel, the peek, the results
// window and the celebration floats all write a saving from this one table.
// ---------------------------------------------------------------------------

it('names only the components a set of totals actually moved, in reading order', () => {
  expect(
    impactParts({ ...ZERO, estTokensSaved: 900, stepsSaved: 2 }).map((p) => p.unit),
  ).toEqual(['steps', 'tok']);
  expect(impactParts(ZERO)).toEqual([]);
});

// "−1 steps" is the number the eye lands on first and it is simply wrong. Only
// that unit has a singular: a saving of one minute is "−1 min", not "−1 mins".
it('writes one of a thing in the singular, and only where there is one', () => {
  expect(impactUnit(1, 'steps')).toBe('step');
  expect(impactUnit(2, 'steps')).toBe('steps');
  expect(impactUnit(1, 'min')).toBe('min');
  expect(impactLabel(1, 'steps')).toBe('−1 step');
  expect(impactLabel(25, 'min')).toBe('−25 min');
});

// Regression: the display used to be rounded, so a saving of one step spent the
// first half of its tween below 0.5 and read "−0 steps" — a falsehood held on
// screen at the one moment the user is watching this number.
it('never states a zero on the way up to a saving of one', () => {
  expect(impactLabel(0.1, 'steps')).toBe('−1 step');
  expect(impactLabel(0.9, 'manual')).toBe('−1 manual');
});

it('signs the pain reduction, and leaves a percentage that did not move unsigned', () => {
  expect(painLabel(44)).toBe('−44%');
  expect(painLabel(0)).toBe('0%');
  expect(painLabel(-20)).toBe('+20%');
});
