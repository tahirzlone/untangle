import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateWorkflow } from '../scripts/validate-core.mjs';

const valid = () => JSON.parse(readFileSync(new URL('./fixtures/valid.workflow.json', import.meta.url), 'utf8'));

describe('workflow contract', () => {
  it('accepts the canonical valid document', () => {
    expect(validateWorkflow(valid())).toEqual({ valid: true, errors: [] });
  });

  it('rejects a node missing painLevel', () => {
    const doc = valid();
    delete doc.nodes[0].painLevel;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects an unknown node kind', () => {
    const doc = valid();
    doc.nodes[0].kind = 'magic';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects an edge pointing at a non-existent node', () => {
    const doc = valid();
    doc.edges[0].to = 'ghost-node';
    const res = validateWorkflow(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/ghost-node/);
  });

  it('rejects duplicate node ids', () => {
    const doc = valid();
    doc.nodes[1].id = doc.nodes[0].id;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a suggestion without airtableRecordId', () => {
    const doc = valid();
    delete doc.suggestions[0].airtableRecordId;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a malformed airtableRecordId', () => {
    const doc = valid();
    doc.suggestions[0].airtableRecordId = 'not-a-record-id';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects a suggestion whose nodeId is unknown', () => {
    const doc = valid();
    doc.suggestions[0].nodeId = 'ghost-node';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('allows newEdges to reference the replaceWith node id', () => {
    expect(validateWorkflow(valid()).valid).toBe(true);
  });

  it('rejects newEdges referencing a truly unknown id', () => {
    const doc = valid();
    doc.suggestions[0].effect.newEdges[0].from = 'ghost-node';
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects painLevel outside 1-5', () => {
    const doc = valid();
    doc.nodes[0].painLevel = 9;
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('rejects kbSource values outside the enum', () => {
    const doc = valid();
    doc.meta.kbSource = 'csv';
    expect(validateWorkflow(doc).valid).toBe(false);
  });
});
