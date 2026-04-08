#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readApplications, parseScoreValue } from '../applications-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');
const PROMPT_FILE = join(__dirname, 'autosubmit-prompt.md');
const STATE_FILE = join(__dirname, 'autosubmit-state.tsv');
const LOCK_FILE = join(__dirname, 'autosubmit-runner.pid');
const LOGS_DIR = join(__dirname, 'logs');
const APPLY_LOG_FILE = join(PROJECT_DIR, 'data', 'apply-log.csv');
const AUTOSUBMIT_STATE = join(PROJECT_DIR, 'autosubmit-state.mjs');
const STATE_HEADER = 'report_num\ttracker_num\tcompany\trole\tstatus\tstarted_at\tcompleted_at\tcredential_id\tcredential_action\tresult\terror\tretries';
const isWindows = process.platform === 'win32';

let stateQueue = Promise.resolve();

function usage() {
  console.log(`driftfin autosubmit runner

Usage: node batch/autosubmit-runner.mjs [OPTIONS]

Options:
  --parallel N
  --dry-run
  --retry-failed
  --retry-blocked
  --start-from N
  --limit N
  --max-retries N
  -h, --help`);
}

function parseArgs(argv) {
  const options = {
    parallel: 1,
    dryRun: false,
    retryFailed: false,
    retryBlocked: false,
    startFrom: 0,
    limit: 0,
    maxRetries: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--parallel':
        options.parallel = Number.parseInt(argv[++index], 10) || 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--retry-failed':
        options.retryFailed = true;
        break;
      case '--retry-blocked':
        options.retryBlocked = true;
        break;
      case '--start-from':
        options.startFrom = Number.parseInt(argv[++index], 10) || 0;
        break;
      case '--limit':
        options.limit = Number.parseInt(argv[++index], 10) || 0;
        break;
      case '--max-retries':
        options.maxRetries = Number.parseInt(argv[++index], 10) || 2;
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

function nowIso() {
  return new Date().toISOString();
}

function parseTrackerRows() {
  return readApplications(PROJECT_DIR)
    .filter((row) => row.report_path || row.report_num)
    .map((row) => ({
      applicationId: String(row.application_id || ''),
      trackerNum: String(row.application_id || ''),
      reportNum: String(row.report_num || ''),
      reportPath: row.report_path || '',
      reportFullPath: row.report_path ? join(PROJECT_DIR, row.report_path) : '',
      company: row.company || '',
      role: row.position || '',
      score: parseScoreValue(row.score),
      status: String(row.status || '').toLowerCase(),
      notes: row.details || '',
      loginIdentity: row.login_identity || '',
      url: row.url || '',
    }));
}

function readReportUrl(reportPath) {
  const fullPath = reportPath && reportPath.startsWith(PROJECT_DIR) ? reportPath : join(PROJECT_DIR, reportPath || '');
  if (!reportPath || !existsSync(fullPath)) {
    return '';
  }
  const content = readFileSync(fullPath, 'utf8');
  const header = content.slice(0, 1000);
  const match = header.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/m);
  return match ? match[1] : '';
}

function readProfileSettings() {
  const profilePath = join(PROJECT_DIR, 'config', 'profile.yml');
  if (!existsSync(profilePath)) {
    return {
      baseEmail: '',
      minimumScore: 4.0,
    };
  }
  const content = readFileSync(profilePath, 'utf8');
  const emailMatch = content.match(/^\s*email:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  const scoreMatch = content.match(/^\s*minimum_score:\s*["']?([^"'\r\n]+)["']?\s*$/m);
  return {
    baseEmail: emailMatch ? emailMatch[1].trim() : '',
    minimumScore: scoreMatch ? Number.parseFloat(scoreMatch[1]) || 4.0 : 4.0,
  };
}

function ensurePrerequisites() {
  if (!existsSync(PROMPT_FILE)) {
    throw new Error(`Missing ${PROMPT_FILE}`);
  }
  if (!existsSync(AUTOSUBMIT_STATE)) {
    throw new Error(`Missing ${AUTOSUBMIT_STATE}`);
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
  runStateCommand(['init']);
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
        throw new Error(`Another autosubmit runner is already running (PID ${stalePid})`);
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

function readStateRows() {
  if (!existsSync(STATE_FILE)) {
    return [];
  }
  const lines = readFileSync(STATE_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [report_num, tracker_num, company, role, status, started_at, completed_at, credential_id, credential_action, result, error, retries] = line.split('\t');
    return {
      report_num,
      tracker_num,
      company,
      role,
      status,
      started_at,
      completed_at,
      credential_id,
      credential_action,
      result,
      error,
      retries: retries ?? '0',
    };
  });
}

function writeStateRows(rows) {
  const body = rows.map((row) => [
    row.report_num,
    row.tracker_num,
    row.company,
    row.role,
    row.status,
    row.started_at,
    row.completed_at,
    row.credential_id,
    row.credential_action,
    row.result,
    row.error,
    row.retries,
  ].join('\t')).join('\n');

  writeFileSync(STATE_FILE, body ? `${STATE_HEADER}\n${body}\n` : `${STATE_HEADER}\n`, 'utf8');
}

function withStateLock(fn) {
  const run = stateQueue.then(fn, fn);
  stateQueue = run.then(() => {}, () => {});
  return run;
}

function getStateRow(reportNum) {
  return readStateRows().find((row) => row.report_num === String(reportNum));
}

function getRetries(reportNum) {
  const row = getStateRow(reportNum);
  return Number.parseInt(row?.retries ?? '0', 10) || 0;
}

function updateState(row) {
  return withStateLock(() => {
    const rows = readStateRows();
    const index = rows.findIndex((entry) => entry.report_num === row.report_num);
    if (index >= 0) {
      rows[index] = row;
    } else {
      rows.push(row);
    }
    writeStateRows(rows);
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === ',') {
      values.push(current);
      current = '';
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function readApplyLogLatest() {
  if (!existsSync(APPLY_LOG_FILE)) {
    return new Map();
  }

  const content = readFileSync(APPLY_LOG_FILE, 'utf8').trimEnd();
  if (!content) {
    return new Map();
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= 1) {
    return new Map();
  }

  const header = parseCsvLine(lines[0]);
  const latest = new Map();

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] ?? '';
    }
    const key = row.report_num || row.application_id;
    if (!key) continue;
    const previous = latest.get(key);
    if (!previous || (row.timestamp || '').localeCompare(previous.timestamp || '') > 0) {
      latest.set(key, row);
    }
  }

  return latest;
}

function selectEligibleApps(options, settings) {
  const latestLog = readApplyLogLatest();
  let apps = parseTrackerRows()
    .filter((app) => app.status === 'evaluated')
    .filter((app) => app.score >= settings.minimumScore)
    .filter((app) => Number.parseInt(app.trackerNum, 10) >= options.startFrom);

  apps = apps.map((app) => ({
    ...app,
    jobUrl: readReportUrl(app.reportPath) || app.url || '',
    latestApply: latestLog.get(app.reportNum) || latestLog.get(app.applicationId) || null,
  })).filter((app) => app.jobUrl);

  apps = apps.filter((app) => {
    const retries = getRetries(app.reportNum);
    if (retries >= options.maxRetries) {
      return false;
    }

    const last = app.latestApply;
    if (!last) {
      return true;
    }

    if (last.result === 'submitted' || last.result === 'duplicate_skipped') {
      return false;
    }

    if (last.result === 'blocked') {
      return options.retryBlocked;
    }

    if (last.result === 'failed') {
      return options.retryFailed;
    }

    if (last.result === 'closed_skipped') {
      return false;
    }

    return true;
  });

  if (options.limit > 0) {
    apps = apps.slice(0, options.limit);
  }

  return apps;
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
  const content = [
    '=== driftfin autosubmit worker ===',
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
  ].join('\n');
  writeFileSync(logFile, content, 'utf8');
}

function runStateCommand(args) {
  const result = runCommand(process.execPath, [AUTOSUBMIT_STATE, ...args]);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `autosubmit-state failed: ${args.join(' ')}`).trim());
  }
  return result.stdout.trim();
}

function sanitizeNote(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function defaultTrackerStatus(result) {
  switch (result) {
    case 'submitted':
    case 'duplicate_skipped':
      return 'Applied';
    case 'closed_skipped':
      return 'Discarded';
    default:
      return '';
  }
}

function fallbackTrackerNote(app, payload) {
  const stamp = nowIso();
  switch (payload.result) {
    case 'submitted':
      return `Autosubmit submitted ${stamp} via ${payload.platform} (${payload.credential_action || 'credential'})`;
    case 'duplicate_skipped':
      return `Portal reported an existing application ${stamp} via ${payload.platform}`;
    case 'closed_skipped':
      return `Job closed before autosubmit ${stamp}`;
    case 'blocked':
      return `Autosubmit blocked ${stamp}: ${payload.blocker_type || payload.notes || 'manual gate required'}`;
    default:
      return `Autosubmit failed ${stamp}: ${payload.notes || 'unknown error'}`;
  }
}

function recordApplyOutcome(app, payload, durationSeconds) {
  const attemptId = `apply_${Date.now()}_${app.reportNum || app.applicationId}`;
  runStateCommand([
    'append-apply-log',
    '--attempt-id', attemptId,
    '--company', app.company,
    '--role', app.role,
    '--job-url', app.jobUrl,
    '--platform', payload.platform || 'unknown',
    '--tenant-key', payload.tenant_key || 'unknown',
    '--application-id', app.applicationId,
    '--report-num', app.reportNum,
    '--credential-id', payload.credential_id || '',
    '--credential-action', payload.credential_action || '',
    '--duration-seconds', String(durationSeconds),
    '--action', 'autosubmit',
    '--result', payload.result || 'failed',
    '--blocker-type', payload.blocker_type || '',
    '--notes', sanitizeNote(payload.notes || ''),
  ]);

  const trackerStatus = payload.tracker_status || defaultTrackerStatus(payload.result);
  const trackerNote = sanitizeNote(payload.tracker_note || fallbackTrackerNote(app, payload));
  const trackerArgs = ['update-tracker', '--application-id', app.applicationId, '--note', trackerNote];
  if (trackerStatus) {
    trackerArgs.push('--status', trackerStatus);
  }
  if (payload.credential_id) {
    trackerArgs.push('--credential-id', payload.credential_id);
  }
  if (payload.login_identity) {
    trackerArgs.push('--login-identity', payload.login_identity);
  }
  if (payload.result === 'submitted') {
    trackerArgs.push('--application-successful', 'Y', '--applied-at', nowIso());
  } else if (payload.result === 'failed' || payload.result === 'blocked') {
    trackerArgs.push('--application-successful', 'N');
  }
  if (payload.result !== 'submitted') {
    trackerArgs.push('--last-error', sanitizeNote(payload.blocker_type || payload.notes || 'autosubmit_failed'));
  }
  runStateCommand(trackerArgs);
}

async function runWorker(app, baseEmail) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const retries = getRetries(app.reportNum);
  const logFile = join(LOGS_DIR, `autosubmit-${app.reportNum}-${app.trackerNum}.log`);
  const outputFile = join(os.tmpdir(), `driftfin-autosubmit-${process.pid}-${app.reportNum}.json`);

  await updateState({
    report_num: app.reportNum,
    tracker_num: app.trackerNum,
    company: app.company,
    role: app.role,
    status: 'processing',
    started_at: startedAt,
    completed_at: '-',
    credential_id: '-',
    credential_action: '-',
    result: '-',
    error: '-',
    retries: String(retries),
  });

  const template = readFileSync(PROMPT_FILE, 'utf8');
  const prompt = replaceAll(template, {
    URL: app.jobUrl,
    COMPANY: app.company,
    ROLE: app.role,
    REPORT_NUM: app.reportNum,
    TRACKER_NUM: app.trackerNum,
    REPORT_PATH: app.reportPath,
    BASE_EMAIL: baseEmail,
    DATE: nowIso().slice(0, 10),
  });

  const { command, args } = codexCommandArgs(outputFile);
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
    command: `${command} ${args.join(' ')}`,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  let payload;
  let failure = '';
  if (existsSync(outputFile)) {
    try {
      payload = JSON.parse(readFileSync(outputFile, 'utf8'));
    } catch (error) {
      failure = `Invalid worker JSON: ${error.message}`;
    }
  } else {
    failure = 'Worker did not produce final JSON output';
  }

  const completedAt = nowIso();
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedMs) / 1000));
  const nextRetries = result.exitCode === 0 ? retries : retries + 1;

  if (result.exitCode === 0 && payload && payload.result) {
    try {
      recordApplyOutcome(app, payload, durationSeconds);
      await updateState({
        report_num: app.reportNum,
        tracker_num: app.trackerNum,
        company: app.company,
        role: app.role,
        status: payload.result === 'submitted' ? 'completed' : payload.result,
        started_at: startedAt,
        completed_at: completedAt,
        credential_id: payload.credential_id || '-',
        credential_action: payload.credential_action || '-',
        result: payload.result,
        error: '-',
        retries: String(retries),
      });
    } catch (error) {
      const message = sanitizeNote(error.message || 'Failed to persist autosubmit outcome');
      await updateState({
        report_num: app.reportNum,
        tracker_num: app.trackerNum,
        company: app.company,
        role: app.role,
        status: 'failed',
        started_at: startedAt,
        completed_at: completedAt,
        credential_id: payload.credential_id || '-',
        credential_action: payload.credential_action || '-',
        result: 'failed',
        error: message.slice(0, 240),
        retries: String(retries + 1),
      });
    }
  } else {
    const message = sanitizeNote(payload?.notes || payload?.error || failure || result.stderr || result.stdout || `Worker exited with code ${result.exitCode}`);
    const failedPayload = {
      platform: payload?.platform || 'unknown',
      tenant_key: payload?.tenant_key || 'unknown',
      credential_id: payload?.credential_id || '',
      credential_action: payload?.credential_action || '',
      result: 'failed',
      blocker_type: payload?.blocker_type || '',
      notes: message,
      tracker_status: '',
    };
    try {
      recordApplyOutcome(app, failedPayload, durationSeconds);
    } catch {
      // Best-effort logging; the state row below still captures the failure.
    }
    await updateState({
      report_num: app.reportNum,
      tracker_num: app.trackerNum,
      company: app.company,
      role: app.role,
      status: 'failed',
      started_at: startedAt,
      completed_at: completedAt,
      credential_id: failedPayload.credential_id || '-',
      credential_action: failedPayload.credential_action || '-',
      result: 'failed',
      error: message.slice(0, 240),
      retries: String(nextRetries),
    });
  }

  if (existsSync(outputFile)) {
    unlinkSync(outputFile);
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

function printSummary() {
  const rows = readStateRows();
  const counts = {
    total: rows.length,
    completed: 0,
    blocked: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (row.result === 'submitted' || row.status === 'completed') counts.completed += 1;
    else if (row.result === 'blocked' || row.status === 'blocked') counts.blocked += 1;
    else if (row.result === 'failed' || row.status === 'failed') counts.failed += 1;
  }

  console.log(`Total: ${counts.total} | Submitted: ${counts.completed} | Blocked: ${counts.blocked} | Failed: ${counts.failed}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensurePrerequisites();
  initStateFile();

  const settings = readProfileSettings();
  if (!settings.baseEmail) {
    throw new Error('Could not read candidate email from config/profile.yml');
  }

  const apps = selectEligibleApps(options, settings);
  console.log(`Eligible evaluated offers (score >= ${settings.minimumScore.toFixed(1)}): ${apps.length}`);

  if (options.dryRun) {
    for (const app of apps) {
      console.log(`#${app.trackerNum}\t[${app.reportNum}]\t${app.company}\t${app.role}\t${basename(app.reportPath)}`);
    }
    return;
  }

  acquireRunnerLock();
  try {
    await runPool(apps, options.parallel, (app) => runWorker(app, settings.baseEmail));
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
