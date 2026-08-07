import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));

const marketplace = read('.claude-plugin/marketplace.json');
const plugin = read('.claude-plugin/plugin.json');

// Names are the namespace users type, so kebab-case is the only shape the
// install and invocation strings can carry.
const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

// Every "./…" string in either manifest is a promise about the repo layout.
// Collect them all rather than spot-checking the two we happen to know about,
// so a future field pointing somewhere that does not exist fails here.
const relativePaths = (value, found = []) => {
  if (typeof value === 'string') {
    if (value.startsWith('./')) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) relativePaths(item, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) relativePaths(item, found);
  }
  return found;
};

describe('plugin + marketplace manifests', () => {
  // Pinned to the literal, not merely to the shape: these two strings are the
  // ones the README hands the reader — `untangle@untangle` is <plugin>@<marketplace>,
  // and `/untangle:graph-my-task` is the plugin name again. Rename either half
  // and the documented commands stop working while a shape-only check stays green.
  it('both parse and name themselves untangle, in kebab case', () => {
    expect(marketplace.name).toBe('untangle');
    expect(plugin.name).toBe('untangle');
    expect(marketplace.name).toMatch(KEBAB);
    expect(plugin.name).toMatch(KEBAB);
    for (const entry of marketplace.plugins) expect(entry.name).toMatch(KEBAB);
  });

  it('offers exactly one plugin, served from the repo root, under the plugin name', () => {
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins;
    expect(entry.source).toBe('./');
    expect(entry.name).toBe(plugin.name);
    expect(entry.description).toBeTruthy();
  });

  it('credits the same owner and author', () => {
    expect(marketplace.owner.name).toBe('Tahir Lone');
    expect(plugin.author.name).toBe('Tahir Lone');
  });

  it('points every relative path it names at something that is really there', () => {
    const paths = [...relativePaths(marketplace), ...relativePaths(plugin)];
    expect(paths.length).toBeGreaterThan(0);
    for (const rel of paths) expect(existsSync(join(repoRoot, rel))).toBe(true);
  });

  // The default `skills/` directory does not exist here; the skill lives under
  // `.claude/skills/`. plugin.json's `skills` field is what makes Claude look
  // there, so the field and the directory have to agree.
  it('adds the scan path where graph-my-task actually lives', () => {
    expect(plugin.skills).toContain('./.claude/skills/');
    const skills = join(repoRoot, '.claude/skills');
    expect(statSync(skills).isDirectory()).toBe(true);
    expect(existsSync(join(skills, 'graph-my-task/SKILL.md'))).toBe(true);
  });
});

// A plugin install copies the repo as git knows it. A file that exists on this
// machine but was never committed simply is not in the cache, and the skill
// fails there in ways it never fails here — the bundled validator, for one,
// dies with a raw ENOENT stack rather than a REJECTED message if schema/ is
// not sitting beside it. So: tracked, not merely present.
describe('what a plugin-cache copy must ship', () => {
  const required = [
    'schema/workflow.schema.json',
    'scripts/validate.bundle.mjs',
    'kb/kb.json',
    '.claude/skills/graph-my-task/SKILL.md',
  ];

  const lsFiles = (rel) =>
    spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], {
      encoding: 'utf8',
      cwd: repoRoot,
    });

  for (const rel of required) {
    it(`tracks ${rel} in git`, () => {
      expect(existsSync(join(repoRoot, rel))).toBe(true);
      expect(lsFiles(rel).status).toBe(0);
    });
  }
});
