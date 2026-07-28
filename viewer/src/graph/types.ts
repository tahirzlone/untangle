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
}

export interface Workflow {
  meta: WorkflowMeta;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  suggestions: unknown[];
}

export type LoadResult =
  | { ok: true; workflow: Workflow }
  | { ok: false; errors: string[] };
