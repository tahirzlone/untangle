import schema from '../../../schema/workflow.schema.json';
import { createValidator } from '../../../scripts/validate-pure.mjs';
import type { LoadResult, Workflow } from './types';

const validate = createValidator(schema);

export function loadWorkflow(raw: unknown): LoadResult {
  const { valid, errors } = validate(raw);
  if (!valid) return { ok: false, errors };
  return { ok: true, workflow: raw as Workflow };
}
