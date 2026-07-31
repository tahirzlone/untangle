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

  it('rejects a suggestion url that is not http(s)', () => {
    const doc = valid();
    doc.suggestions[0].url = 'javascript:alert(1)';
    expect(validateWorkflow(doc).valid).toBe(false);
  });
});

describe('optimized prompt fields (optional, additive)', () => {
  it('accepts a document that carries neither prompt field', () => {
    const doc = valid();
    expect(doc.meta.promptIntro).toBeUndefined();
    expect(doc.suggestions[0].promptFragment).toBeUndefined();
    expect(validateWorkflow(doc)).toEqual({ valid: true, errors: [] });
  });

  it('accepts a suggestion carrying a promptFragment', () => {
    const doc = valid();
    doc.suggestions[0].promptFragment =
      'Use example/rss-mcp to pull the articles instead of fetching and parsing each feed by hand.';
    expect(validateWorkflow(doc)).toEqual({ valid: true, errors: [] });
  });

  it('rejects an empty-string promptFragment', () => {
    const doc = valid();
    doc.suggestions[0].promptFragment = '';
    const res = validateWorkflow(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/promptFragment/);
  });

  it('rejects a non-string promptFragment', () => {
    const doc = valid();
    doc.suggestions[0].promptFragment = ['use it here'];
    expect(validateWorkflow(doc).valid).toBe(false);
  });

  it('accepts meta.promptIntro', () => {
    const doc = valid();
    doc.meta.promptIntro =
      'Send a weekly newsletter built from my RSS reads. Gather the last seven days of articles, pick the five best, and assemble the issue for review.';
    expect(validateWorkflow(doc)).toEqual({ valid: true, errors: [] });
  });

  it('rejects an empty-string meta.promptIntro', () => {
    const doc = valid();
    doc.meta.promptIntro = '';
    const res = validateWorkflow(doc);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/promptIntro/);
  });

  it('still rejects unknown properties alongside the new ones', () => {
    const doc = valid();
    doc.meta.promptIntro = 'Ship the weekly issue.';
    doc.meta.promptOutro = 'and then some';
    expect(validateWorkflow(doc).valid).toBe(false);
  });
});
