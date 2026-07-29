import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { EdgeKind, Workflow, WorkflowNode } from './types';

export interface LaidOutNode { id: string; x: number; y: number; width: number; height: number; node: WorkflowNode; }
export interface LaidOutEdge { id: string; from: string; to: string; kind: EdgeKind; label?: string; points: { x: number; y: number }[]; }
export interface LaidOutGraph { nodes: LaidOutNode[]; edges: LaidOutEdge[]; width: number; height: number; }

export const NODE_WIDTH = 252;
export const NODE_HEIGHT = 148;

const elk = new ELK();

export async function layoutWorkflow(workflow: Workflow): Promise<LaidOutGraph> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'SPLINES',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.nodeNode': '56',
    },
    children: workflow.nodes.map((n) => ({
      id: n.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: workflow.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
    })),
  };

  const res = await elk.layout(graph);

  const nodes: LaidOutNode[] = (res.children ?? []).map((c) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? NODE_WIDTH,
    height: c.height ?? NODE_HEIGHT,
    node: workflow.nodes.find((n) => n.id === c.id)!,
  }));

  const edges: LaidOutEdge[] = (res.edges ?? []).map((e, i) => {
    const src = workflow.edges[i];
    const section = e.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
      : [];
    return {
      id: e.id,
      from: src.from,
      to: src.to,
      kind: src.kind,
      label: src.label,
      points: points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
    };
  });

  return { nodes, edges, width: res.width ?? 0, height: res.height ?? 0 };
}
