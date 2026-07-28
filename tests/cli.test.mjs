import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/valid.workflow.json', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

describe('validate CLI', () => {
  it('exits 0 and prints OK for a valid file', () => {
    const res = run(fixture);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK:');
  });

  it('exits 1 and prints REJECTED for an invalid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowprint-'));
    const bad = join(dir, 'bad.workflow.json');
    writeFileSync(bad, JSON.stringify({ meta: {} }));
    const res = run(bad);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('REJECTED');
  });

  it('exits 1 for a file that is not JSON at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowprint-'));
    const bad = join(dir, 'not-json.txt');
    writeFileSync(bad, 'hello');
    const res = run(bad);
    expect(res.status).toBe(1);
  });

  it('exits 2 with usage when no file is given', () => {
    const res = run();
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('usage');
  });
});
