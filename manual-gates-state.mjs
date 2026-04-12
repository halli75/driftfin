#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import lockfile from 'proper-lockfile';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(ROOT, 'data', 'manual-gates.json');

function usage() {
  console.log(`driftfin manual gate state

Usage:
  node manual-gates-state.mjs init
  node manual-gates-state.mjs list
  node manual-gates-state.mjs get --application-id ID
  node manual-gates-state.mjs set --application-id ID [--report-num N] [--company TEXT] [--role TEXT] [--job-url URL] [--gate-type TYPE] [--gate-url URL] [--session-id ID] [--browser-profile-dir PATH] [--current-url URL] [--resume-url URL] [--state waiting|resume_requested|resumed|expired|abandoned] [--notes TEXT] [--paused-at ISO] [--resumed-at ISO]
  node manual-gates-state.mjs clear --application-id ID
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

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: 1,
    entries: {},
  };
}

function statePath() {
  return STATE_FILE;
}

function ensureStateFile() {
  mkdirSync(dirname(statePath()), { recursive: true });
  if (!existsSync(statePath())) {
    writeFileSync(statePath(), `${JSON.stringify(defaultState(), null, 2)}\n`, 'utf8');
  }
}

function readState() {
  ensureStateFile();
  const raw = readFileSync(statePath(), 'utf8').trim();
  if (!raw) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...defaultState(),
        ...parsed,
        entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
      };
    }
  } catch {
    // Fall through.
  }
  return defaultState();
}

function writeState(state) {
  const filePath = statePath();
  const tempPath = join(dirname(filePath), `.${Date.now()}-${process.pid}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

function lockOptions() {
  return {
    stale: 30000,
    update: 5000,
    realpath: false,
    retries: {
      retries: 30,
      factor: 1.3,
      minTimeout: 25,
      maxTimeout: 400,
      randomize: false,
    },
  };
}

async function withLock(callback) {
  ensureStateFile();
  const release = await lockfile.lock(statePath(), lockOptions());
  try {
    return await callback(readState());
  } finally {
    await release();
  }
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`Missing required flag --${name}`);
  }
  return flags[name];
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeEntry(applicationId, flags, current = {}) {
  return {
    application_id: applicationId,
    report_num: flags['report-num'] ?? current.report_num ?? '',
    company: flags.company ?? current.company ?? '',
    role: flags.role ?? current.role ?? '',
    job_url: flags['job-url'] ?? current.job_url ?? '',
    gate_type: flags['gate-type'] ?? current.gate_type ?? '',
    gate_url: flags['gate-url'] ?? current.gate_url ?? '',
    browser_session_id: flags['session-id'] ?? current.browser_session_id ?? '',
    browser_profile_dir: flags['browser-profile-dir'] ?? current.browser_profile_dir ?? '',
    current_url: flags['current-url'] ?? current.current_url ?? '',
    resume_url: flags['resume-url'] ?? current.resume_url ?? '',
    state: flags.state ?? current.state ?? 'waiting',
    notes: flags.notes ?? current.notes ?? '',
    paused_at: flags['paused-at'] ?? current.paused_at ?? nowIso(),
    resumed_at: flags['resumed-at'] ?? current.resumed_at ?? '',
    updated_at: nowIso(),
  };
}

function findEntry(state, flags) {
  if (flags['application-id']) {
    return state.entries[flags['application-id']] || null;
  }
  if (flags['report-num']) {
    return Object.values(state.entries).find((entry) => entry.report_num === flags['report-num']) || null;
  }
  return null;
}

async function runInit() {
  ensureStateFile();
  printJson({
    status: 'ok',
    state_file: statePath(),
  });
}

async function runList() {
  const state = readState();
  printJson({
    status: 'ok',
    entries: Object.values(state.entries),
  });
}

async function runGet(flags) {
  const state = readState();
  const entry = findEntry(state, flags);
  printJson({
    status: entry ? 'ok' : 'missing',
    entry,
  });
}

async function runSet(flags) {
  const applicationId = requireFlag(flags, 'application-id');
  let payload;
  await withLock(async (state) => {
    const current = state.entries[applicationId] || {};
    const entry = normalizeEntry(applicationId, flags, current);
    state.entries[applicationId] = entry;
    writeState(state);
    payload = entry;
  });
  printJson({
    status: 'ok',
    entry: payload,
  });
}

async function runClear(flags) {
  const applicationId = requireFlag(flags, 'application-id');
  let removed = null;
  await withLock(async (state) => {
    removed = state.entries[applicationId] || null;
    delete state.entries[applicationId];
    writeState(state);
  });
  printJson({
    status: removed ? 'ok' : 'missing',
    entry: removed,
  });
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'init':
      return runInit();
    case 'list':
      return runList();
    case 'get':
      return runGet(flags);
    case 'set':
      return runSet(flags);
    case 'clear':
      return runClear(flags);
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
