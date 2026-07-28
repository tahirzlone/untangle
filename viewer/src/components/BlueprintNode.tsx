import { Handle, Position } from '@xyflow/react';
import type { WorkflowNode } from '../graph/types';
import './node.css';

const KIND_ABBR: Record<WorkflowNode['kind'], string> = {
  input: 'IN',
  process: 'PROC',
  decision: 'DEC',
  loop: 'LOOP',
  review: 'REVW',
  output: 'OUT',
};

export function BlueprintNodeBody({ node }: { node: WorkflowNode }) {
  return (
    <div
      className={`bp-node bp-node--${node.kind}`}
      data-testid="bp-node"
      data-kind={node.kind}
      data-pain={node.painLevel}
      style={{ ['--pain' as string]: node.painLevel }}
      title={node.description}
    >
      <div className="bp-node-eyebrow">
        <span className="bp-node-kind">{KIND_ABBR[node.kind]}</span>
        <span className="bp-node-ticks" aria-label={`pain level ${node.painLevel} of 5`}>
          {Array.from({ length: node.painLevel }, (_, i) => (
            <i key={i} className="pain-tick" data-testid="pain-tick" />
          ))}
        </span>
      </div>
      <div className="bp-node-label">{node.label}</div>
      <div className="bp-node-desc">{node.description}</div>
    </div>
  );
}

export function BlueprintNode({ data }: { data: { node: WorkflowNode; index: number } }) {
  return (
    <div className="bp-node-shell" style={{ ['--i' as string]: data.index }}>
      <Handle type="target" position={Position.Top} className="bp-handle" />
      <BlueprintNodeBody node={data.node} />
      <Handle type="source" position={Position.Bottom} className="bp-handle" />
    </div>
  );
}
