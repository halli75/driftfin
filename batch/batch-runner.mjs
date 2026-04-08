#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');
const BATCH_DIR = __dirname;
const INPUT_FILE = join(BATCH_DIR, 'batch-input.tsv');
const STATE_FILE = join(BATCH_DIR, 'batch-state.tsv');
const PROMPT_FILE = join(BATCH_DIR, 'batch-prompt.md');
const LOGS_DIR = join(BATCH_DIR, 'logs');
const TRACKER_DIR = join(BATCH_DIR, 'tracker-additions');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const LOCK_FILE = join(BATCH_DIR, 'batch-runner.pid');

const STATE_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';
const isWindows = process.platform === 'win32';

let stateQueue = Promise.resolve();

function usage() {
  console.log(`driftfin batch runner

Usage: node batch/batch-runner.mjs [OPTIONS]

Options:
  --parallel N
  --dry-run
  --retry-failed
  --start-from N
  --max-retries N
  -h, --help`);
}

function parseArgs(argv) {
  const options = {
    parallel: 1,
    dryRun: false,
    retryFailed: false,
    startFrom: 0,
    maxRetries: 2,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--parallel':
        options.parallel = Number.parseInt(argv[++i], 10) || 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--retry-failed':
        options.retryFailed = true;
        break;
      case '--start-from':
        options.startFrom = Number.parseInt(argv[++i], 10) || 0;
        break;
      case '--max-retries':
        options.maxRetries = Number.parseInt(argv[++i], 10) || 2;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function runCommand(command, args, cwd = PROJECT_DIR) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runNodeScript(scriptName) {
  return runCommand(process.execPath, [join(PROJECT_DIR, scriptName)]);
}

function codexVersionOk() {
  if (isWindows) {
    return runCommand('cmd', ['/c', 'codex', '--version']);
  }
  return runCommand('codex', ['--version']);
}

function codexLoginOk() {
  if (isWindows) {
    return runCommand('cmd', ['/c', 'codex', 'login', 'status']);
  }
  return runCommand('codex', ['login', 'status']);
}

function checkPrerequisites() {
  if (!existsSync(INPUT_FILE)) {
    throw new Error(`Missing ${INPUT_FILE}`);
  }
  if (!existsSync(PROMPT_FILE)) {
    throw new Error(`Missing ${PROMPT_FILE}`);
  }

  const version = codexVersionOk();
  if (version.status !== 0) {
    throw new Error(`Codex CLI not available: ${version.stderr || version.stdout}`.trim());
  }

  const login = codexLoginOk();
  if (login.status !== 0) {
    throw new Error(`Codex login check failed: ${login.stderr || login.stdout}`.trim());
  }

  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(TRACKER_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function acquireRunnerLock() {
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return;
  } catch {
    const stalePid = existsSync(LOCK_FILE) ? Number.parseInt(readFileSync(LOCK_FILE, 'utf8').trim(), 10) : null;
    if (stalePid) {
      try {
        process.kill(stalePid, 0);
        throw new Error(`Another batch runner is already running (PID ${stalePid})`);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
    }

    if (existsSync(LOCK_FILE)) {
      unlinkSync(LOCK_FILE);
    }
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  }
}

function releaseRunnerLock() {
  if (existsSync(LOCK_FILE)) {
    unlinkSync(LOCK_FILE);
  }
}

function initStateFile() {
  if (!existsSync(STATE_FILE)) {
    writeFileSync(STATE_FILE, `${STATE_HEADER}\n`, 'utf8');
  }
}

function parseTsvLine(line) {
  return line.split('\t');
}

function readStateRows() {
  if (!existsSync(STATE_FILE)) {
    return [];
  }
  const lines = readFileSync(STATE_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [id, url, status, started_at, completed_at, report_num, score, error, retries] = parseTsvLine(line);
    return {
      id,
      url,
      status,
      started_at,
      completed_at,
      report_num,
      score,
      error,
      retries: retries ?? '0',
    };
  });
}

function writeStateRows(rows) {
  const body = rows.map((row) => [
    row.id,
    row.url,
    row.status,
    row.started_at,
    row.completed_at,
    row.report_num,
    row.score,
    row.error,
    row.retries,
  ].join('\t')).join('\n');
  const file = body ? `${STATE_HEADER}\n${body}\n` : `${STATE_HEADER}\n`;
  writeFileSync(STATE_FILE, file, 'utf8');
}

function withStateLock(fn) {
  const run = stateQueue.then(fn, fn);
  stateQueue = run.then(() => {}, () => {});
  return run;
}

function getStatus(id) {
  const row = readStateRows().find((entry) => entry.id === String(id));
  return row?.status ?? 'none';
}

function getRetries(id) {
  const row = readStateRows().find((entry) => entry.id === String(id));
  return Number.parseInt(row?.retries ?? '0', 10) || 0;
}

function nextReportNumber(rows) {
  let max = 0;

  if (existsSync(REPORTS_DIR)) {
    for (const file of readdirSync(REPORTS_DIR)) {
      if (!file.endsWith('.md')) continue;
      const prefix = basename(file).split('-')[0];
      const parsed = Number.parseInt(prefix, 10);
      if (Number.isFinite(parsed)) {
        max = Math.max(max, parsed);
      }
    }
  }

  for (const row of rows) {
    const parsed = Number.parseInt(row.report_num, 10);
    if (Number.isFinite(parsed)) {
      max = Math.max(max, parsed);
    }
  }

  return String(max + 1).padStart(3, '0');
}

async function reserveReportNumber(id, url, startedAt, retries) {
  return withStateLock(() => {
    const rows = readStateRows();
    const reportNum = nextReportNumber(rows);
    const nextRow = {
      id: String(id),
      url,
      status: 'processing',
      started_at: startedAt,
      completed_at: '-',
      report_num: reportNum,
      score: '-',
      error: '-',
      retries: String(retries),
    };

    const index = rows.findIndex((row) => row.id === String(id));
    if (index >= 0) {
      rows[index] = nextRow;
    } else {
      rows.push(nextRow);
    }
    writeStateRows(rows);
    return reportNum;
  });
}

async function updateState(row) {
  return withStateLock(() => {
    const rows = readStateRows();
    const index = rows.findIndex((entry) => entry.id === row.id);
    if (index >= 0) {
      rows[index] = row;
    } else {
      rows.push(row);
    }
    writeStateRows(rows);
    return row;
  });
}

function readBatchInput() {
  const lines = readFileSync(INPUT_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [id, url, source = '', ...rest] = parseTsvLine(line);
    return {
      id,
      url,
      source,
      notes: rest.join('\t'),
    };
  }).filter((row) => row.id && row.url);
}

function selectPendingOffers(inputRows, options) {
  return inputRows.filter((row) => {
    const idNumber = Number.parseInt(row.id, 10);
    if (Number.isFinite(idNumber) && idNumber < options.startFrom) {
      return false;
    }

    const status = getStatus(row.id);
    const retries = getRetries(row.id);

    if (options.retryFailed) {
      return status === 'failed' && retries < options.maxRetries;
    }

    if (status === 'completed') {
      return false;
    }

    if (status === 'failed' && retries >= options.maxRetries) {
      return false;
    }

    return true;
  });
}

function replaceAll(template, replacements) {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function codexCommandArgs(outputFile) {
  const execArgs = [
    '--search',
    '-a',
    'never',
    'exec',
    '-s',
    'workspace-write',
    '-C',
    PROJECT_DIR,
    '--output-last-message',
    outputFile,
    '-',
  ];

  if (isWindows) {
    return { command: 'cmd', args: ['/c', 'codex', ...execArgs] };
  }

  return { command: 'codex', args: execArgs };
}

function writeLog(logFile, details) {
  const chunks = [
    `=== driftfin batch worker ===`,
    `timestamp: ${nowIso()}`,
    `command: ${details.command}`,
    `exit_code: ${details.exitCode}`,
    '',
    '--- stdout ---',
    details.stdout || '',
    '',
    '--- stderr ---',
    details.stderr || '',
    '',
  ];
  writeFileSync(logFile, chunks.join('\n'), 'utf8');
}

async function runWorker(job) {
  const startedAt = nowIso();
  const retries = getRetries(job.id);
  const reportNum = await reserveReportNumber(job.id, job.url, startedAt, retries);
  const date = todayDate();
  const jdFile = join(os.tmpdir(), `driftfin-batch-jd-${process.pid}-${job.id}.txt`);
  const outputFile = join(os.tmpdir(), `driftfin-batch-result-${process.pid}-${job.id}.json`);
  const logFile = join(LOGS_DIR, `${reportNum}-${job.id}.log`);

  writeFileSync(jdFile, '', 'utf8');

  const template = readFileSync(PROMPT_FILE, 'utf8');
  const prompt = replaceAll(template, {
    URL: job.url,
    JD_FILE: jdFile,
    REPORT_NUM: reportNum,
    DATE: date,
    ID: String(job.id),
  });

  const { command, args } = codexCommandArgs(outputFile);
  const commandString = `${command} ${args.join(' ')}`;

  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: PROJECT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });

  writeLog(logFile, {
    command: commandString,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  let payload = null;
  let errorMessage = '';
  if (existsSync(outputFile)) {
    try {
      payload = JSON.parse(readFileSync(outputFile, 'utf8'));
    } catch (error) {
      errorMessage = `Invalid worker JSON: ${error.message}`;
    }
  } else {
    errorMessage = 'Worker did not produce a final JSON message';
  }

  const completedAt = nowIso();
  const nextRetries = result.exitCode === 0 ? retries : retries + 1;

  if (result.exitCode === 0 && payload && payload.status === 'completed') {
    await updateState({
      id: String(job.id),
      url: job.url,
      status: 'completed',
      started_at: startedAt,
      completed_at: completedAt,
      report_num: reportNum,
      score: payload.score == null ? '-' : String(payload.score),
      error: '-',
      retries: String(retries),
    });
  } else {
    const summary = payload?.error || errorMessage || result.stderr || result.stdout || `Worker exited with code ${result.exitCode}`;
    await updateState({
      id: String(job.id),
      url: job.url,
      status: 'failed',
      started_at: startedAt,
      completed_at: completedAt,
      report_num: reportNum,
      score: '-',
      error: summary.replace(/\s+/g, ' ').slice(0, 240),
      retries: String(nextRetries),
    });
  }

  for (const file of [jdFile, outputFile]) {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }
}

async function runPool(items, concurrency, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

function mergeTracker() {
  const merge = runNodeScript('merge-tracker.mjs');
  process.stdout.write(merge.stdout);
  process.stderr.write(merge.stderr);

  const verify = runNodeScript('verify-pipeline.mjs');
  process.stdout.write(verify.stdout);
  process.stderr.write(verify.stderr);

  if (verify.status !== 0) {
    console.log('Verification reported issues. Review the output above.');
  }
}

function printSummary() {
  const rows = readStateRows();
  const counts = {
    total: rows.length,
    completed: 0,
    failed: 0,
    pending: 0,
  };
  let scoreSum = 0;
  let scoreCount = 0;

  for (const row of rows) {
    if (row.status === 'completed') {
      counts.completed += 1;
      const parsed = Number.parseFloat(row.score);
      if (Number.isFinite(parsed)) {
        scoreSum += parsed;
        scoreCount += 1;
      }
    } else if (row.status === 'failed') {
      counts.failed += 1;
    } else {
      counts.pending += 1;
    }
  }

  console.log(`Total: ${counts.total} | Completed: ${counts.completed} | Failed: ${counts.failed} | Pending: ${counts.pending}`);
  if (scoreCount > 0) {
    console.log(`Average score: ${(scoreSum / scoreCount).toFixed(1)}/5`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  checkPrerequisites();
  initStateFile();

  const inputRows = readBatchInput();
  if (inputRows.length === 0) {
    console.log('No offers in batch-input.tsv.');
    return;
  }

  const pending = selectPendingOffers(inputRows, options);
  console.log(`Input: ${inputRows.length} offers`);
  console.log(`Pending: ${pending.length} offers`);

  if (options.dryRun) {
    for (const row of pending) {
      console.log(`#${row.id}\t${row.url}\tstatus=${getStatus(row.id)}`);
    }
    return;
  }

  acquireRunnerLock();
  try {
    await runPool(pending, options.parallel, runWorker);
    mergeTracker();
    printSummary();
  } finally {
    releaseRunnerLock();
  }
}

main().catch((error) => {
  console.error(error.message);
  releaseRunnerLock();
  process.exit(1);
});
