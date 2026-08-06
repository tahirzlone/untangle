export type NodeKind = 'input' | 'process' | 'decision' | 'loop' | 'review' | 'output';
export type EdgeKind = 'sequence' | 'branch' | 'retry';

export interface WorkflowNode {
  id: string;
  label: string;
  kind: NodeKind;
  description: string;
  painLevel: 1 | 2 | 3 | 4 | 5;
  lane?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  kind: EdgeKind;
}

export interface WorkflowMeta {
  task: string;
  title: string;
  generatedAt: string;
  model: string;
  kbSource: 'airtable' | 'none';
  /**
   * The task rewritten as the opening paragraph of an agent prompt. Optional:
   * without it the optimized prompt opens with `task` verbatim.
   */
  promptIntro?: string;
}

export type SuggestionCategory =
  | 'Claude Skill'
  | 'Claude Plugin'
  | 'MCP Server'
  | 'Connector'
  | 'Other';

/** What a suggestion claims it saves. Accumulated into session totals on apply. */
export interface EffectMetrics {
  stepsSaved: number;
  estTimeSavedMin: number;
  estTokensSaved: number;
  manualInterventionsRemoved: number;
}

/**
 * A declarative patch on the graph. Deliberately data, not code: the generator
 * writes it, the reducer in apply.ts is the only thing that interprets it.
 */
export interface Effect {
  removeNodes: string[];
  mergeNodes: string[];
  replaceWith?: WorkflowNode;
  newEdges: WorkflowEdge[];
  metrics: EffectMetrics;
}

export interface Suggestion {
  nodeId: string;
  /** Airtable row this came from. The KB is the only sanctioned source. */
  airtableRecordId: string;
  name: string;
  url: string;
  category: SuggestionCategory;
  claim: string;
  install?: string;
  /**
   * Imperative instructions for using this resource at this step, written by the
   * generator. Optional: without it the optimized prompt falls back to a line
   * templated from `name`, `category`, and `claim`. Either way the install is
   * the assembler's to state, in the setup block — never the fragment's.
   */
  promptFragment?: string;
  effect: Effect;
}

export interface Workflow {
  meta: WorkflowMeta;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  suggestions: Suggestion[];
}

export type LoadResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; errors: string[] };
