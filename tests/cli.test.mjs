import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
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
    expect(res.stderr).toContain('REJECTED');
  });

  it('exits 2 with usage when no file is given', () => {
    const res = run();
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('usage');
  });

  it('exits 1 with "cannot read file" for a missing path', () => {
    const res = run(join(tmpdir(), 'flowprint-does-not-exist', 'nope.workflow.json'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cannot read file');
  });

  it('accepts a valid file with a UTF-8 BOM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowprint-'));
    const bomFile = join(dir, 'bom.workflow.json');
    writeFileSync(bomFile, '\uFEFF' + readFileSync(fixture, 'utf8'));
    const res = run(bomFile);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK:');
  });
});
