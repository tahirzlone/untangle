import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../scripts/validate.bundle.mjs', import.meta.url));
const gallery = fileURLToPath(
  new URL('../gallery/ship-a-payments-feature.workflow.json', import.meta.url)
);
// Absolute paths and a cwd outside the repo: the schema must be found relative
// to the bundle's own location, never relative to wherever the shell happens
// to stand. That is the whole point of the committed artifact.
const run = (...args) =>
  spawnSync(process.execPath, [bundle, ...args], { encoding: 'utf8', cwd: tmpdir() });

describe('bundled validator CLI', () => {
  it('exits 0 and prints OK for a gallery workflow, run from outside the repo', () => {
    const res = run(gallery);
    expect(res.status).toBe(0);
    expect(res.stdout.startsWith('OK:')).toBe(true);
  });

  it('exits 1 and prints REJECTED for an invalid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'untangle-bundle-'));
    const bad = join(dir, 'bad.workflow.json');
    writeFileSync(bad, JSON.stringify({ meta: {} }));
    const res = run(bad);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('REJECTED');
  });
});

describe('bundled validator artifact', () => {
  const src = () => readFileSync(bundle, 'utf8');

  it('names the command that regenerates it', () => {
    expect(src()).toContain('npm run bundle:validator');
  });

  // The plugin cache has no node_modules. Anything the bundle still imports by
  // bare specifier would be ERR_MODULE_NOT_FOUND there, so every import left in
  // the file has to be a Node built-in.
  it('imports nothing but node: built-ins', () => {
    const imports = src()
      .split('\n')
      .filter((line) => /^import[\s{"']/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/"node:[a-z_/]+"/);
  });

  it('carries no ajv import left to resolve', () => {
    expect(src()).not.toContain('from "ajv');
  });

  // Inlining the schema would fork the contract. It stays a file read through
  // import.meta.url, which in ESM output still points at scripts/.
  it('reads the schema off disk rather than inlining it', () => {
    expect(src()).toContain("new URL(\"../schema/workflow.schema.json\", import.meta.url)");
  });
});
