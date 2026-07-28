// Node-side binding of the platform-neutral validator: read the frozen schema
// off disk, then hand it to createValidator. All validation logic lives in
// validate-pure.mjs so the viewer can share it verbatim.

import { readFileSync } from 'node:fs';
import { createValidator } from './validate-pure.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../schema/workflow.schema.json', import.meta.url), 'utf8')
);

export const validateWorkflow = createValidator(schema);
