import gallery from '../../../gallery/add-e2e-tests.workflow.json';
import { loadWorkflow } from './load';

it('loads the committed gallery workflow', () => {
  const res = loadWorkflow(gallery);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.workflow.meta.title).toBeTruthy();
    expect(res.workflow.nodes.length).toBeGreaterThanOrEqual(3);
  }
});

it('rejects garbage with error strings', () => {
  const res = loadWorkflow({ meta: {} });
  expect(res.ok).toBe(false);
  if (!res.ok) {
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toMatch(/schema:/);
  }
});

it('rejects non-object input without throwing', () => {
  expect(loadWorkflow('not json at all').ok).toBe(false);
  expect(loadWorkflow(null).ok).toBe(false);
});
