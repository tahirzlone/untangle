import { wrapLabel } from './path';

it('wrapLabel keeps short labels on one line', () => {
  expect(wrapLabel('CI green')).toEqual(['CI green']);
});

it('wrapLabel wraps long labels on word boundaries within the cap', () => {
  const lines = wrapLabel('flaky selector / timing race — fix and re-run');
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
});
