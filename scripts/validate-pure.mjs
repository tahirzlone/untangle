// Platform-neutral workflow validator.
//
// This module must stay free of Node built-in imports — it is bundled into
// the browser viewer as well as loaded by the Node CLI. The schema is a parameter
// so each host supplies it its own way (fs.readFileSync in Node, a JSON import
// in Vite).

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export function createValidator(schema) {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);

  return function validateWorkflow(doc) {
    const errors = [];
    if (!validateSchema(doc)) {
      for (const e of validateSchema.errors ?? []) {
        errors.push(`schema: ${e.instancePath || '/'} ${e.message}`);
      }
      return { valid: false, errors };
    }

    const nodeIds = new Set(doc.nodes.map((n) => n.id));
    if (nodeIds.size !== doc.nodes.length) {
      errors.push('integrity: duplicate node ids');
    }
    doc.edges.forEach((e, i) => {
      if (!nodeIds.has(e.from)) errors.push(`integrity: edges[${i}].from "${e.from}" is not a node id`);
      if (!nodeIds.has(e.to)) errors.push(`integrity: edges[${i}].to "${e.to}" is not a node id`);
    });
    doc.suggestions.forEach((s, i) => {
      if (!nodeIds.has(s.nodeId)) {
        errors.push(`integrity: suggestions[${i}].nodeId "${s.nodeId}" is not a node id`);
      }
      const allowed = new Set(nodeIds);
      if (s.effect.replaceWith) allowed.add(s.effect.replaceWith.id);
      for (const id of s.effect.removeNodes) {
        if (!nodeIds.has(id)) errors.push(`integrity: suggestions[${i}].effect.removeNodes "${id}" is not a node id`);
      }
      for (const id of s.effect.mergeNodes) {
        if (!nodeIds.has(id)) errors.push(`integrity: suggestions[${i}].effect.mergeNodes "${id}" is not a node id`);
      }
      s.effect.newEdges.forEach((e, j) => {
        if (!allowed.has(e.from)) errors.push(`integrity: suggestions[${i}].effect.newEdges[${j}].from "${e.from}" is unknown`);
        if (!allowed.has(e.to)) errors.push(`integrity: suggestions[${i}].effect.newEdges[${j}].to "${e.to}" is unknown`);
      });
    });

    return { valid: errors.length === 0, errors };
  };
}
