import { Handle, Position } from '@xyflow/react';
import type { NodeKind, WorkflowNode } from '../graph/types';
import { NODE_HEIGHT, NODE_WIDTH } from '../graph/layout';
import './node.css';

const KIND_ABBR: Record<NodeKind, string> = {
  input: 'IN',
  process: 'PR',
  decision: 'DC',
  loop: 'LP',
  review: 'RV',
  output: 'OUT',
};

const PAIN_CLASS: Partial<Record<WorkflowNode['painLevel'], string>> = {
  4: ' sg-node--warm',
  5: ' sg-node--hot',
};

const METER_SEGMENTS = 5;

function PainMeter({ pain }: { pain: WorkflowNode['painLevel'] }) {
  return (
    <span
      className="sg-meter"
      data-testid="sg-meter"
      data-pain={pain}
      aria-label={`pain level ${pain} of 5`}
    >
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <i key={i} className="sg-meter-seg" data-testid="sg-meter-seg" />
      ))}
    </span>
  );
}

export function SignalNodeBody({ node }: { node: WorkflowNode }) {
  return (
    <div
      className={`sg-node${PAIN_CLASS[node.painLevel] ?? ''}`}
      data-testid="sg-node"
      data-kind={node.kind}
      data-pain={node.painLevel}
      title={node.description}
    >
      <div className="sg-node-head">
        <span className="sg-icon" aria-hidden="true">{KIND_ABBR[node.kind]}</span>
        <span className="sg-label">{node.label}</span>
      </div>
      <p className="sg-desc">{node.description}</p>
      <div className="sg-foot">
        <span className="sg-kind">{node.kind}</span>
        <PainMeter pain={node.painLevel} />
      </div>
    </div>
  );
}

export function SignalNode({ data }: { data: { node: WorkflowNode; index: number } }) {
  return (
    <div
      className="sg-node-shell"
      // NODE_WIDTH/NODE_HEIGHT come from the layout module so ELK, React Flow's
      // declared bounds, and the painted card can never drift apart — the card
      // size lives in exactly one place.
      style={{ ['--i' as string]: data.index, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Left} className="sg-port" />
      <SignalNodeBody node={data.node} />
      <Handle type="source" position={Position.Right} className="sg-port" />
    </div>
  );
}
