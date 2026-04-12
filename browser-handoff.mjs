#!/usr/bin/env node

import http from 'http';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from 'playwright';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 47821;
const USER_DATA_ROOT = join(ROOT, 'data', 'manual-browser');

const sessions = new Map();

function usage() {
  console.log(`driftfin browser handoff

Usage:
  node browser-handoff.mjs serve
  node browser-handoff.mjs open --session-id ID --url URL
  node browser-handoff.mjs status --session-id ID
  node browser-handoff.mjs close --session-id ID
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = 'true';
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { command, flags };
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`Missing required flag --${name}`);
  }
  return flags[name];
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function sessionDir(sessionId) {
  return join(USER_DATA_ROOT, sessionId);
}

async function ensureSession(sessionId) {
  const current = sessions.get(sessionId);
  if (current) {
    return current;
  }

  mkdirSync(USER_DATA_ROOT, { recursive: true });
  const userDataDir = sessionDir(sessionId);
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 1200 },
  });
  const page = context.pages()[0] || await context.newPage();
  const session = { sessionId, context, page, userDataDir };
  sessions.set(sessionId, session);
  context.on('close', () => {
    sessions.delete(sessionId);
  });
  return session;
}

async function openSession({ sessionId, url }) {
  const session = await ensureSession(sessionId);
  if (url && session.page.url() !== url) {
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  await session.page.bringToFront();
  return getSessionStatus(sessionId);
}

async function getSessionStatus(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      status: 'missing',
      session_id: sessionId,
      open: false,
      current_url: '',
      title: '',
      browser_profile_dir: sessionDir(sessionId),
    };
  }

  return {
    status: 'ok',
    session_id: sessionId,
    open: !session.page.isClosed(),
    current_url: session.page.url(),
    title: await session.page.title().catch(() => ''),
    browser_profile_dir: session.userDataDir,
  };
}

async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      status: 'missing',
      session_id: sessionId,
    };
  }
  await session.context.close();
  sessions.delete(sessionId);
  return {
    status: 'ok',
    session_id: sessionId,
    closed: true,
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function serve() {
  mkdirSync(USER_DATA_ROOT, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${SERVER_HOST}:${SERVER_PORT}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/open') {
        const body = await readJsonBody(req);
        const payload = await openSession({
          sessionId: body.session_id,
          url: body.url,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/status') {
        const body = await readJsonBody(req);
        const payload = await getSessionStatus(body.session_id);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/close') {
        const body = await readJsonBody(req);
        const payload = await closeSession(body.session_id);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'not_found' }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: error.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SERVER_PORT, SERVER_HOST, resolve);
  });

  process.stdout.write(`${JSON.stringify({ status: 'ok', host: SERVER_HOST, port: SERVER_PORT })}\n`);
}

async function fetchJson(path, body) {
  const response = await fetch(`http://${SERVER_HOST}:${SERVER_PORT}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`browser-handoff server responded ${response.status}`);
  }
  return response.json();
}

async function serverReady() {
  try {
    const payload = await fetchJson('/health');
    return payload.status === 'ok';
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverReady()) {
    return;
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, [scriptPath, 'serve'], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await serverReady()) {
      return;
    }
  }
  throw new Error('browser-handoff server did not become ready');
}

async function clientOpen(flags) {
  await ensureServer();
  const payload = await fetchJson('/open', {
    session_id: requireFlag(flags, 'session-id'),
    url: requireFlag(flags, 'url'),
  });
  printJson(payload);
}

async function clientStatus(flags) {
  await ensureServer();
  const payload = await fetchJson('/status', {
    session_id: requireFlag(flags, 'session-id'),
  });
  printJson(payload);
}

async function clientClose(flags) {
  await ensureServer();
  const payload = await fetchJson('/close', {
    session_id: requireFlag(flags, 'session-id'),
  });
  printJson(payload);
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'serve':
      return serve();
    case 'open':
      return clientOpen(flags);
    case 'status':
      return clientStatus(flags);
    case 'close':
      return clientClose(flags);
    case '-h':
    case '--help':
    case undefined:
      usage();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
