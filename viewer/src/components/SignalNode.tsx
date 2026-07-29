import { Handle, Position } from '@xyflow/react';
import type { NodeKind, Suggestion, WorkflowNode } from '../graph/types';
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

/**
 * Five segments filled to the level — the same readout on the card and in the
 * detail drawer, so a node's heat reads identically wherever it is stated.
 */
export function PainMeter({ pain }: { pain: WorkflowNode['painLevel'] }) {
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

/**
 * The card, plus the pip that says the KB has something to say about it.
 *
 * The pip is a SIBLING of the card, not a child: it straddles the top-right
 * corner, and the card clips its own overflow to keep its rounded border. Both
 * are positioned against `.sg-node-shell`, which is exactly the card's box.
 */
export function SignalNodeBody({
  node,
  selected = false,
  suggestions = [],
}: {
  node: WorkflowNode;
  selected?: boolean;
  suggestions?: Suggestion[];
}) {
  return (
    <>
      {suggestions.length > 0 ? (
        <span
          className="sg-badge"
          data-testid="sg-badge"
          // role="img" is what makes the label win over the bare digit inside —
          // "2" on its own tells a screen reader nothing about what there are two of
          role="img"
          aria-label={`${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}`}
        >
          {suggestions.length}
        </span>
      ) : null}
      <div
        className={`sg-node${PAIN_CLASS[node.painLevel] ?? ''}${selected ? ' sg-node--selected' : ''}`}
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
    </>
  );
}

/**
 * `selected` and `isConnectable` arrive as props from React Flow — it owns both,
 * so the card reads them rather than keeping second copies in `data`.
 *
 * Forwarding `isConnectable` to the ports matters: a Handle defaults to
 * connectable on its own, so without this the ports would keep advertising
 * themselves (and swallowing pointer events) even though the canvas has
 * `nodesConnectable={false}`.
 */
export function SignalNode({
  data,
  selected,
  isConnectable,
}: {
  data: { node: WorkflowNode; index: number; suggestions?: Suggestion[] };
  selected?: boolean;
  isConnectable?: boolean;
}) {
  return (
    <div
      className="sg-node-shell"
      // NODE_WIDTH/NODE_HEIGHT come from the layout module so ELK, React Flow's
      // declared bounds, and the painted card can never drift apart — the card
      // size lives in exactly one place.
      style={{ ['--i' as string]: data.index, width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="sg-port"
        isConnectable={isConnectable ?? false}
      />
      <SignalNodeBody node={data.node} selected={selected} suggestions={data.suggestions} />
      <Handle
        type="source"
        position={Position.Right}
        className="sg-port"
        isConnectable={isConnectable ?? false}
      />
    </div>
  );
}
