#!/usr/bin/env node
// The viewer, served from this checkout, by one command.
//
// Node built-ins only — http, fs, path, zlib, child_process, url — and never a
// bare specifier. This file runs where node_modules does not exist: a
// plugin-cache copy of this repo, or a fresh clone nobody has installed. It is
// the law scripts/validate.bundle.mjs lives under, for the same reason — the
// rung that ends a skill run cannot depend on an install the user never ran —
// and it is why viewer/dist is committed rather than built on demand.
//
//   node scripts/serve.mjs <workflow.json>   the link to that graph, served here
//   node scripts/serve.mjs                   the viewer's address, nothing loaded
//   node scripts/serve.mjs --foreground      serve in THIS process (tests, ops)
//   node scripts/serve.mjs --port N          pin the port (0 = ephemeral)
//   node scripts/serve.mjs --stop            stop the server this repo started
//
// Two streams, one rule: stdout carries the answer — the link, the address, or
// what --stop found — and every status line goes to stderr. So
// `url=$(node scripts/serve.mjs graph.workflow.json)` is the link and nothing
// else, while a human reading the terminal still sees the whole story.
//
// A run with no file and no flags leaves a server behind on purpose: the next
// graph reuses it instead of starting a second one. `--stop` ends it.
//
// UNTANGLE_NO_OPEN=1 suppresses both conveniences — no clipboard copy, no
// browser launch. The suite sets it: a test run must not seize the clipboard or
// throw windows at whoever happens to be at the keyboard.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, get as httpGet, request as httpRequest } from 'node:http';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// ROOT is one level above scripts/, derived from this file rather than from the
// working directory: the skill invokes this by absolute path from whatever
// project the user is standing in, and viewer/dist is here, not there.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DIST = join(ROOT, 'viewer', 'dist');

// The range every invocation scans — vite's preview port and the 26 above it.
const PORT_MIN = 4173;
const PORT_MAX = 4199;
const SCAN = Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i);

const PING = '/__untangle_ping';
const STOP = '/__untangle_stop';

const TEXT = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const OCTET = 'application/octet-stream';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': JSON_TYPE,
  '.png': 'image/png',
};

/** A status line. Never stdout: stdout is the answer, and only the answer. */
const note = (message) => process.stderr.write(`${message}\n`);

/** The end of a run that produced nothing. */
function fail(message, code = 1) {
  process.stderr.write(`untangle: ${message}\n`);
  process.exit(code);
}

const USAGE =
  'usage: node scripts/serve.mjs [<workflow.json>] [--foreground] [--port N] [--stop]';

function parseArgs(argv) {
  const opts = { file: null, foreground: false, daemon: false, stop: false, port: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--foreground') opts.foreground = true;
    else if (arg === '--stop') opts.stop = true;
    // Internal, and deliberately ugly: it is how a detached child knows it is
    // the server rather than another client. Nobody types this.
    else if (arg === '--__daemon') opts.daemon = true;
    else if (arg === '--port' || arg.startsWith('--port=')) {
      const raw = arg === '--port' ? argv[(i += 1)] : arg.slice('--port='.length);
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`not a port: ${raw}`, 2);
      opts.port = port;
    } else if (arg.startsWith('-')) fail(`unknown option ${arg}\n${USAGE}`, 2);
    else if (opts.file === null) opts.file = arg;
    else fail(`one file at a time (got ${opts.file} and ${arg})\n${USAGE}`, 2);
  }
  return opts;
}

/** The version the ping reports. Absent or unreadable is not fatal — it is a label. */
function pluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * A build has to exist before any of this means anything. Defensive rather than
 * expected: viewer/dist is committed, so a checkout that lacks it has had it
 * deleted, and the honest thing is to name the path we looked in.
 */
function requireDist() {
  if (existsSync(join(DIST, 'index.html'))) return;
  fail(`no viewer build at ${DIST} — expected index.html there (npm run build:viewer)`);
}

// ── the server ────────────────────────────────────────────────────────────────

/** The addresses a request from this machine can arrive from. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function send(res, status, type, body, method = 'GET') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'content-type': type,
    'content-length': payload.length,
    // Nothing here is worth caching across a rebuild: the dist this serves is
    // regenerated by hand, and a stale index.html is a viewer that quietly
    // stopped matching its source.
    'cache-control': 'no-store',
  });
  res.end(method === 'HEAD' ? undefined : payload);
}

/**
 * A file from viewer/dist, or 404 — including for every path that tries to
 * leave it. The guard is a resolve-and-compare rather than a scan for `..`,
 * because the shapes that escape are more numerous than the ones you think of:
 * `/../package.json`, `/..%2fpackage.json` which is only `..` after decoding,
 * a drive letter on Windows. Resolved against dist, each of them comes back as
 * a path that no longer starts with dist, and that is the whole test.
 */
function serveStatic(rawPath, method, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    return send(res, 400, TEXT, 'bad request', method);
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = resolve(DIST, `.${pathname}`);
  if (file !== DIST && !file.startsWith(DIST + sep)) return send(res, 404, TEXT, 'not found', method);

  let stats;
  try {
    stats = statSync(file);
  } catch {
    return send(res, 404, TEXT, 'not found', method);
  }
  // A directory is a 404 and never a listing: this serves a build, not a folder.
  if (!stats.isFile()) return send(res, 404, TEXT, 'not found', method);

  let body;
  try {
    body = readFileSync(file);
  } catch (err) {
    return send(res, 500, TEXT, `cannot read that file (${err.message})`, method);
  }
  return send(res, 200, MIME[extname(file).toLowerCase()] ?? OCTET, body, method);
}

function createViewerServer() {
  const version = pluginVersion();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';

    // How every other invocation recognises this process as one of ours rather
    // than as whatever else happens to be listening on a dev port.
    if (url.pathname === PING) {
      if (method !== 'GET' && method !== 'HEAD') return send(res, 405, TEXT, 'method not allowed');
      return send(res, 200, JSON_TYPE, JSON.stringify({ untangle: true, version }), method);
    }

    if (url.pathname === STOP) {
      if (method !== 'POST') return send(res, 405, TEXT, 'method not allowed', method);
      // Belt as well as braces: the listener is bound to 127.0.0.1, so nothing
      // off this machine can reach it — and the one endpoint that ends the
      // process still checks who is asking.
      if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
        return send(res, 403, TEXT, 'loopback only', method);
      }
      send(res, 200, JSON_TYPE, JSON.stringify({ stopped: true }), method);
      res.on('finish', () => {
        server.close();
        server.closeAllConnections();
        process.exit(0);
      });
      return undefined;
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, TEXT, 'method not allowed');
    return serveStatic(url.pathname, method, res);
  });
  return server;
}

function listen(server, port) {
  return new Promise((ok, no) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      no(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      ok(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/** Listening, on the port asked for or on the first free one in the range. */
async function startServer(wanted) {
  const server = createViewerServer();
  // An explicit port is an instruction; the scan is only for "wherever is free".
  const candidates = wanted === null ? SCAN : [wanted];
  for (const candidate of candidates) {
    try {
      return { server, port: await listen(server, candidate) };
    } catch (err) {
      // Two runs can find the same port free and race to bind it. The loser
      // takes the next one — cheaper and far less fragile than a lock file, and
      // the reuse probe below means we seldom get here at all.
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(
    wanted === null
      ? `every port from ${PORT_MIN} to ${PORT_MAX} is taken`
      : `port ${wanted} is already taken by something else`,
  );
}

// ── finding one that is already running ───────────────────────────────────────

/** What the ping said, or null for silence, a stranger, or anything malformed. */
function ping(port, timeout = 500) {
  return new Promise((ok) => {
    const req = httpGet({ host: '127.0.0.1', port, path: PING, timeout }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return ok(null);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      return res.on('end', () => {
        try {
          const answer = JSON.parse(body);
          ok(answer && answer.untangle === true ? answer : null);
        } catch {
          ok(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(null));
  });
}

/** The first port in the list already answering as an untangle viewer. */
async function findServer(ports) {
  for (const port of ports) {
    if (await ping(port)) return port;
  }
  return null;
}

const delay = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * detached + ignored stdio + unref is what outlives the terminal that typed the
 * command: the child holds no handle on our streams and we hold none on the
 * child, so this process can exit — or the whole shell can close — with the
 * viewer still serving. windowsHide keeps a console window from flashing up.
 */
function spawnDaemon(port) {
  const args = [SELF, '--__daemon'];
  if (port !== null) args.push('--port', String(port));
  spawn(process.execPath, args, {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/** A running viewer: the one already up, or a new detached one. */
async function ensureServer(opts) {
  const ports = opts.port === null ? SCAN : [opts.port];
  const running = await findServer(ports);
  if (running !== null) return { port: running, started: false };

  // Nothing can report the port an ephemeral listener landed on once its stdio
  // is thrown away, so this combination is refused rather than half-honoured.
  if (opts.port === 0) fail('--port 0 needs --foreground: a detached server cannot report its port', 2);

  spawnDaemon(opts.port);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await delay(150);
    const port = await findServer(ports);
    if (port !== null) return { port, started: true };
  }
  return fail(`the viewer did not come up on ${ports.length === 1 ? ports[0] : `${PORT_MIN}–${PORT_MAX}`}`);
}

function requestStop(port) {
  return new Promise((ok) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: STOP, method: 'POST', timeout: 1000 },
      (res) => {
        res.resume();
        ok(res.statusCode === 200);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => ok(false));
    req.end();
  });
}

// ── the link ──────────────────────────────────────────────────────────────────

/** `out/ship-it.workflow.json` → `out/ship-it.link.txt`, beside the graph. */
function linkFileFor(file) {
  const name = basename(file);
  const stem = name.endsWith('.workflow.json')
    ? name.slice(0, -'.workflow.json'.length)
    : name.replace(/\.json$/, '');
  return join(dirname(resolve(file)), `${stem}.link.txt`);
}

/** In order of the platforms they belong to; the first one present takes it. */
const CLIPBOARDS = [
  ['clip', []],
  ['pbcopy', []],
  ['xclip', ['-selection', 'clipboard']],
  ['wl-copy', []],
];

/** The tool that took the copy, or null when this machine has none. */
function copyToClipboard(text) {
  for (const [command, args] of CLIPBOARDS) {
    const res = spawnSync(command, args, { input: text, windowsHide: true });
    if (!res.error && res.status === 0) return command;
  }
  return null;
}

/** Opens the link in whatever this platform calls a browser, and says so. */
function openInBrowser(url) {
  // The URL is ours and a base64url fragment has no `&`, `^` or `%` in it, so
  // there is nothing here for cmd to reinterpret on the way through.
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  // Timed, because a launcher that hangs must not hold the run open; a launcher
  // still working when the clock runs out has already handed the URL on.
  const res = spawnSync(command, args, { stdio: 'ignore', timeout: 4000, windowsHide: true });
  if (res.error?.code === 'ETIMEDOUT') return note('browser still opening — the link is above');
  if (res.error?.code === 'ENOENT') return note(`no browser launcher here (${command}) — open the link yourself`);
  if (res.error) return note(`could not open a browser (${res.error.message}) — open the link yourself`);
  if (res.status !== 0) return note(`could not open a browser (${command} exited ${res.status}) — open the link yourself`);
  return note('opened in your browser');
}

const noOpen = () => {
  const set = process.env.UNTANGLE_NO_OPEN;
  return set !== undefined && set !== '' && set !== '0';
};

/**
 * The graph, gzipped into the address of a viewer that is already running.
 *
 * The printed link is the contract. Everything after it — the file beside the
 * graph, the clipboard, the browser — is a convenience, guarded so that none of
 * them can turn a run that already delivered its link into a failure.
 */
function mintLink(port, file) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    return fail(`cannot read ${file} (${err.message})`);
  }
  // The exact bytes, never a re-serialized copy: what the link unzips to is the
  // file the validator passed, byte for byte.
  const link = `http://localhost:${port}/#g=${gzipSync(bytes, { level: 9 }).toString('base64url')}`;
  process.stdout.write(`${link}\n`);

  const linkFile = linkFileFor(file);
  try {
    writeFileSync(linkFile, `${link}\n`);
    note(`link written to ${linkFile}`);
  } catch (err) {
    note(`could not write ${linkFile} (${err.message})`);
  }

  if (noOpen()) return note('UNTANGLE_NO_OPEN — no clipboard, no browser');

  try {
    const tool = copyToClipboard(link);
    // No clipboard tool is worth an apology: the link is printed and on disk.
    if (tool) note(`copied to the clipboard (${tool})`);
  } catch (err) {
    note(`clipboard skipped (${err.message})`);
  }

  try {
    openInBrowser(link);
  } catch (err) {
    note(`could not open a browser (${err.message}) — open the link yourself`);
  }
  return undefined;
}

// ── the run ───────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));

if (opts.stop) {
  const ports = opts.port === null ? SCAN : [opts.port];
  const running = await findServer(ports);
  if (running === null) {
    process.stdout.write(`no untangle viewer running on ${PORT_MIN}–${PORT_MAX}\n`);
  } else if (await requestStop(running)) {
    process.stdout.write(`stopped the untangle viewer on port ${running}\n`);
  } else {
    fail(`found a viewer on port ${running} but it would not stop`);
  }
} else if (opts.daemon || opts.foreground) {
  requireDist();
  // A port that will not bind is an ordinary answer here — a stack trace from
  // the top of the module would be a worse way to say "something else has it".
  const { port } = await startServer(opts.port).catch((err) => fail(err.message));
  if (opts.foreground) {
    note(`serving ${DIST}`);
    process.stdout.write(`http://localhost:${port}/\n`);
    if (opts.file) mintLink(port, opts.file);
  }
  // and then this process simply keeps listening
} else {
  requireDist();
  const { port, started } = await ensureServer(opts);
  note(started ? `viewer started on port ${port}` : `reusing the viewer on port ${port}`);
  if (opts.file) mintLink(port, opts.file);
  else process.stdout.write(`http://localhost:${port}/\n`);
}
