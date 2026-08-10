import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const serve = fileURLToPath(new URL('../scripts/serve.mjs', import.meta.url));
const distDir = fileURLToPath(new URL('../viewer/dist/', import.meta.url));
const gallery = fileURLToPath(
  new URL('../gallery/ship-a-payments-feature.workflow.json', import.meta.url)
);

// The range serve.mjs scans, kept here as a literal rather than imported: a test
// that reads the constant from the thing it tests cannot notice it moving.
const PORTS = Array.from({ length: 27 }, (_, i) => 4173 + i);

// Raw node:http rather than fetch, because the traversal cases are about the
// exact bytes on the request line: fetch normalizes `/../package.json` to
// `/package.json` before it ever leaves the client, and the guard under test
// would never see the shape it exists to refuse.
const request = (port, path) =>
  new Promise((ok, no) => {
    const req = httpGet({ host: '127.0.0.1', port, path, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        ok({
          status: res.statusCode,
          type: res.headers['content-type'] ?? '',
          body: Buffer.concat(chunks),
        })
      );
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', no);
  });

/** Whether an untangle viewer answers on that port. */
async function pinged(port) {
  try {
    const res = await request(port, '/__untangle_ping');
    return res.status === 200 && JSON.parse(res.body.toString()).untangle === true;
  } catch {
    // nothing listening there, which is the usual answer
    return false;
  }
}

/** Every port in the scan range answering as an untangle viewer, in order. */
async function responders() {
  const found = [];
  for (const port of PORTS) if (await pinged(port)) found.push(port);
  return found;
}

const delay = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * A server in this process's care: spawned with --foreground so the test owns
 * its lifetime and can kill it, and never detached — a suite that leaves a
 * daemon behind has changed the machine it ran on.
 */
function startForeground(...args) {
  return new Promise((ok, no) => {
    const child = spawn(process.execPath, [serve, '--foreground', ...args], {
      env: { ...process.env, UNTANGLE_NO_OPEN: '1' },
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      no(new Error(`no address within 10s (stdout: ${out})`));
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const found = out.match(/http:\/\/localhost:(\d+)\//);
      if (!found) return;
      clearTimeout(timer);
      ok({ child, port: Number(found[1]) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      no(err);
    });
  });
}

// Run from outside the repo, as the skill runs it: every path this script needs
// comes from its own location, never from where the shell stands. And with the
// conveniences off — a suite must not seize the clipboard or throw a browser
// window at whoever is at the keyboard.
const run = (...args) =>
  spawnSync(process.execPath, [serve, ...args], {
    encoding: 'utf8',
    cwd: tmpdir(),
    env: { ...process.env, UNTANGLE_NO_OPEN: '1' },
  });

describe('the viewer serve.mjs serves', () => {
  let server;

  beforeAll(async () => {
    server = await startForeground('--port', '0');
  });

  afterAll(() => {
    server?.child.kill();
  });

  it('serves index.html at the root', async () => {
    const res = await request(server.port, '/');
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/html');
    expect(res.body.toString()).toContain('<div id="root">');
  });

  // The hashed name comes out of the committed index.html rather than being
  // written down here: the hash changes with every viewer build, and a test
  // pinned to one of them would fail for the wrong reason.
  it('serves the hashed script the build actually references', async () => {
    const index = readFileSync(join(distDir, 'index.html'), 'utf8');
    const asset = index.match(/src="\.(\/assets\/[^"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const res = await request(server.port, asset);
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/javascript');
  });

  it('serves fonts as fonts', async () => {
    const font = readdirSync(join(distDir, 'assets')).find((name) => name.endsWith('.woff2'));
    expect(font).toBeTruthy();
    const res = await request(server.port, `/assets/${font}`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('font/woff2');
  });

  it('answers the ping that identifies it as ours', async () => {
    const res = await request(server.port, '/__untangle_ping');
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/json');
    const answer = JSON.parse(res.body.toString());
    expect(answer.untangle).toBe(true);
    expect(typeof answer.version).toBe('string');
    expect(answer.version.length).toBeGreaterThan(0);
  });

  // Both shapes: the one a path normalizer collapses on its own, and the one
  // that is only `..` after the server decodes it — which is the shape a guard
  // written as a scan for the two characters would hand straight over.
  it('refuses to leave dist, encoded or not', async () => {
    expect((await request(server.port, '/../package.json')).status).toBe(404);
    expect((await request(server.port, '/..%2fpackage.json')).status).toBe(404);
  });

  it('lists no directories', async () => {
    expect((await request(server.port, '/assets')).status).toBe(404);
  });
});

describe('the link serve.mjs mints', () => {
  let server;
  let dir;
  let input;

  beforeAll(async () => {
    server = await startForeground('--port', '0');
    dir = mkdtempSync(join(tmpdir(), 'untangle-serve-'));
    input = join(dir, 'ship-a-payments-feature.workflow.json');
    copyFileSync(gallery, input);
  });

  afterAll(() => {
    server?.child.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints one link, whose fragment unzips to the file byte for byte', () => {
    const res = run(input, '--port', String(server.port));
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);

    const [link] = lines;
    expect(link.startsWith(`http://localhost:${server.port}/#g=`)).toBe(true);
    const fragment = link.slice(link.indexOf('#g=') + '#g='.length);
    expect(gunzipSync(Buffer.from(fragment, 'base64url')).equals(readFileSync(input))).toBe(true);
  });

  it('writes that same link beside the graph it opens', () => {
    const res = run(input, '--port', String(server.port));
    expect(res.status).toBe(0);
    const written = readFileSync(join(dir, 'ship-a-payments-feature.link.txt'), 'utf8');
    expect(written.trim()).toBe(res.stdout.trim());
  });

  it('skips the clipboard and the browser when told to', () => {
    const res = run(input, '--port', String(server.port));
    expect(res.stderr).toContain('UNTANGLE_NO_OPEN');
    expect(res.stderr).not.toContain('opened in your browser');
  });
});

describe('a second run reuses the first run’s server', () => {
  let server;
  let before;

  beforeAll(async () => {
    // No --port: this one lands in the scan range, which is where a link-mode
    // run with no arguments of its own goes looking.
    server = await startForeground();
    before = await responders();
  });

  afterAll(() => {
    server?.child.kill();
  });

  it('mints the link on the port already answering, and starts nothing new', async () => {
    expect(before).toContain(server.port);

    const res = run();
    expect(res.status).toBe(0);
    const port = Number(res.stdout.trim().match(/http:\/\/localhost:(\d+)\//)[1]);

    // The first responder in the range is what reuse picks, and on a clean
    // machine that is the server started above. Asserted against the scan
    // rather than against the port directly so a viewer someone left running
    // makes this test tell the truth instead of failing.
    expect(port).toBe(before[0]);
    expect(res.stderr).toContain('reusing the viewer');
    expect(await responders()).toEqual(before);
  });
});

// Copied out of the repo rather than run against a moved dist: ROOT comes from
// this file's own location, so a copy in a bare temp directory is a checkout
// with no build in it — and it must say which path it looked in, not spawn a
// server that will never answer.
describe('a checkout with no viewer build', () => {
  it('exits 1 naming the path it expected', () => {
    const dir = mkdtempSync(join(tmpdir(), 'untangle-nodist-'));
    const copy = join(dir, 'scripts', 'serve.mjs');
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(serve, copy);
    const res = spawnSync(process.execPath, [copy], {
      encoding: 'utf8',
      cwd: tmpdir(),
      env: { ...process.env, UNTANGLE_NO_OPEN: '1' },
    });
    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(join(dir, 'viewer', 'dist'));
    expect(res.stdout).toBe('');
  });
});

describe('--stop', () => {
  let server;

  beforeAll(async () => {
    server = await startForeground();
  });

  afterAll(() => {
    server?.child.kill();
  });

  it('stops the running viewer, and says so when there is none', async () => {
    const stopped = run('--stop', '--port', String(server.port));
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toContain(`stopped the untangle viewer on port ${server.port}`);

    // The server answers and then exits, in that order, so the port can outlive
    // the reply by a few milliseconds. Polled rather than slept on.
    let alive = true;
    for (let i = 0; i < 30 && alive; i += 1) {
      alive = await pinged(server.port);
      if (alive) await delay(100);
    }
    expect(alive).toBe(false);

    const again = run('--stop', '--port', String(server.port));
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('no untangle viewer running');
  });
});
