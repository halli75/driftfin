#!/usr/bin/env node

import crypto from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  applicationsCsvPath,
  canonicalStatus,
  ensureApplicationsCsv,
  readApplications,
  updateApplications,
} from './applications-store.mjs';
import { appendCsvRow, ensureCsvFile, readCsv, updateCsvRows } from './csv-store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(ROOT, 'data');
const CREDENTIALS_FILE = join(DATA_DIR, 'credentials.csv');
const APPLY_LOG_FILE = join(DATA_DIR, 'apply-log.csv');

const CREDENTIAL_HEADERS = [
  'credential_id',
  'platform',
  'company',
  'tenant_key',
  'reuse_scope',
  'login_url',
  'email_alias',
  'password',
  'status',
  'created_at',
  'last_used_at',
  'last_success_at',
  'last_failure_at',
  'failure_reason',
  'superseded_by',
];

const APPLY_LOG_HEADERS = [
  'attempt_id',
  'timestamp',
  'duration_seconds',
  'company',
  'role',
  'job_url',
  'platform',
  'tenant_key',
  'application_id',
  'report_num',
  'credential_id',
  'credential_action',
  'action',
  'result',
  'blocker_type',
  'notes',
];

function usage() {
  console.log(`driftfin autosubmit state

Usage:
  node autosubmit-state.mjs init
  node autosubmit-state.mjs get-or-create --platform PLATFORM --company COMPANY --tenant-key TENANT --base-email EMAIL [--login-url URL] [--reuse-scope company|platform] [--login-email EMAIL]
  node autosubmit-state.mjs rotate --credential-id ID --platform PLATFORM --company COMPANY --tenant-key TENANT --base-email EMAIL [--login-url URL] [--reuse-scope company|platform] [--reason TEXT] [--login-email EMAIL]
  node autosubmit-state.mjs record-success --credential-id ID
  node autosubmit-state.mjs record-failure --credential-id ID [--reason TEXT]
  node autosubmit-state.mjs append-apply-log --attempt-id ID --company COMPANY --role ROLE --job-url URL --platform PLATFORM --tenant-key TENANT --application-id N --report-num N --action ACTION --result RESULT [--credential-id ID] [--credential-action MODE] [--duration-seconds N] [--blocker-type TYPE] [--notes TEXT]
  node autosubmit-state.mjs update-tracker [--application-id N] [--report-num N] [--status STATUS] [--note TEXT] [--credential-id ID] [--login-identity EMAIL] [--application-successful Y|N] [--applied-at ISO] [--last-error TEXT]
`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = 'true';
      continue;
    }
    flags[key] = next;
    index += 1;
  }

  return { command, flags };
}

function nowIso() {
  return new Date().toISOString();
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

function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultReuseScope(platform, requested) {
  if (requested) return requested;
  return normalizeKey(platform) === 'workday' ? 'company' : 'platform';
}

function splitEmail(baseEmail) {
  const trimmed = String(baseEmail ?? '').trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) {
    throw new Error('Base email must contain @');
  }
  return {
    local: trimmed.slice(0, atIndex),
    domain: trimmed.slice(atIndex + 1),
  };
}

function aliasBase(platform, company, tenantKey, reuseScope) {
  const safePlatform = normalizeKey(platform) || 'portal';
  const safeCompany = normalizeKey(company) || normalizeKey(tenantKey) || safePlatform;
  if (safePlatform === 'workday' || reuseScope === 'company') {
    return `${safePlatform}-${safeCompany}`;
  }
  return safePlatform;
}

function uniqueAlias(rows, baseEmail, platform, company, tenantKey, reuseScope) {
  const { local, domain } = splitEmail(baseEmail);
  const root = aliasBase(platform, company, tenantKey, reuseScope);
  const existing = new Set(rows.map((row) => row.email_alias).filter(Boolean));
  let candidate = `${local}+${root}@${domain}`;
  let counter = 2;

  while (existing.has(candidate)) {
    candidate = `${local}+${root}-${counter}@${domain}`;
    counter += 1;
  }

  return candidate;
}

function generatePassword() {
  return crypto.randomBytes(18).toString('base64url');
}

function readCredentials() {
  return readCsv(CREDENTIALS_FILE, CREDENTIAL_HEADERS);
}

function readApplyLog() {
  return readCsv(APPLY_LOG_FILE, APPLY_LOG_HEADERS);
}

function credentialSortKey(row) {
  return row.last_success_at || row.last_used_at || row.created_at || '';
}

function findCredential(rows, options) {
  const platform = normalizeKey(options.platform);
  const company = normalizeKey(options.company);
  const tenantKey = normalizeKey(options.tenantKey);
  const reuseScope = defaultReuseScope(platform, options.reuseScope);

  const activeRows = rows
    .filter((row) => normalizeKey(row.platform) === platform && row.status === 'active')
    .sort((left, right) => credentialSortKey(right).localeCompare(credentialSortKey(left)));

  const exact = activeRows.find((row) => normalizeKey(row.tenant_key) === tenantKey)
    || activeRows.find((row) => normalizeKey(row.company) === company && row.reuse_scope === 'company');

  if (exact) return exact;
  if (reuseScope === 'platform' && platform !== 'workday') {
    return activeRows.find((row) => row.reuse_scope === 'platform') || null;
  }
  return null;
}

function createCredential(rows, options) {
  const createdAt = nowIso();
  const reuseScope = defaultReuseScope(options.platform, options.reuseScope);

  return {
    credential_id: `cred_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    platform: normalizeKey(options.platform),
    company: options.company,
    tenant_key: normalizeKey(options.tenantKey || options.company),
    reuse_scope: reuseScope,
    login_url: options.loginUrl || '',
    email_alias: options.loginEmail || uniqueAlias(rows, options.baseEmail, options.platform, options.company, options.tenantKey, reuseScope),
    password: generatePassword(),
    status: 'active',
    created_at: createdAt,
    last_used_at: createdAt,
    last_success_at: '',
    last_failure_at: '',
    failure_reason: '',
    superseded_by: '',
  };
}

function appendNote(existing, note) {
  const left = String(existing ?? '').trim();
  const right = String(note ?? '').trim();
  if (!left) return right;
  if (!right || left.includes(right)) return left;
  return `${left}; ${right}`;
}

async function runInit() {
  ensureCsvFile(CREDENTIALS_FILE, CREDENTIAL_HEADERS);
  ensureCsvFile(APPLY_LOG_FILE, APPLY_LOG_HEADERS);
  ensureApplicationsCsv(ROOT);
  printJson({
    status: 'ok',
    credentials_file: CREDENTIALS_FILE,
    apply_log_file: APPLY_LOG_FILE,
    applications_file: applicationsCsvPath(ROOT),
  });
}

async function runGetOrCreate(flags) {
  const options = {
    platform: requireFlag(flags, 'platform'),
    company: requireFlag(flags, 'company'),
    tenantKey: requireFlag(flags, 'tenant-key'),
    loginUrl: flags['login-url'] || '',
    baseEmail: requireFlag(flags, 'base-email'),
    reuseScope: flags['reuse-scope'] || '',
    loginEmail: flags['login-email'] || '',
  };

  let payload;
  await updateCsvRows(CREDENTIALS_FILE, CREDENTIAL_HEADERS, (rows) => {
    const existing = findCredential(rows, options);
    if (existing) {
      existing.last_used_at = nowIso();
      payload = {
        status: 'ok',
        action: 'reused',
        credential: existing,
      };
      return rows;
    }

    const credential = createCredential(rows, options);
    rows.push(credential);
    payload = {
      status: 'ok',
      action: 'created',
      credential,
    };
    return rows;
  });
  printJson(payload);
}

async function runRotate(flags) {
  const oldId = requireFlag(flags, 'credential-id');
  const options = {
    platform: requireFlag(flags, 'platform'),
    company: requireFlag(flags, 'company'),
    tenantKey: requireFlag(flags, 'tenant-key'),
    loginUrl: flags['login-url'] || '',
    baseEmail: requireFlag(flags, 'base-email'),
    reuseScope: flags['reuse-scope'] || '',
    loginEmail: flags['login-email'] || '',
  };
  const failureReason = flags.reason || 'login_failed';
  let payload;

  await updateCsvRows(CREDENTIALS_FILE, CREDENTIAL_HEADERS, (rows) => {
    const index = rows.findIndex((row) => row.credential_id === oldId);
    if (index === -1) {
      throw new Error(`Credential not found: ${oldId}`);
    }

    const replacement = createCredential(rows, options);
    rows[index] = {
      ...rows[index],
      status: 'invalid',
      last_failure_at: nowIso(),
      failure_reason: failureReason,
      superseded_by: replacement.credential_id,
    };
    rows.push(replacement);
    payload = {
      status: 'ok',
      action: 'rotated',
      invalidated: oldId,
      credential: replacement,
    };
    return rows;
  });

  printJson(payload);
}

async function runRecordSuccess(flags) {
  const credentialId = requireFlag(flags, 'credential-id');
  let payload;
  await updateCsvRows(CREDENTIALS_FILE, CREDENTIAL_HEADERS, (rows) => {
    const index = rows.findIndex((row) => row.credential_id === credentialId);
    if (index === -1) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    const timestamp = nowIso();
    rows[index] = {
      ...rows[index],
      status: 'active',
      last_used_at: timestamp,
      last_success_at: timestamp,
      failure_reason: '',
    };
    payload = { status: 'ok', credential: rows[index] };
    return rows;
  });
  printJson(payload);
}

async function runRecordFailure(flags) {
  const credentialId = requireFlag(flags, 'credential-id');
  let payload;
  await updateCsvRows(CREDENTIALS_FILE, CREDENTIAL_HEADERS, (rows) => {
    const index = rows.findIndex((row) => row.credential_id === credentialId);
    if (index === -1) {
      throw new Error(`Credential not found: ${credentialId}`);
    }
    const timestamp = nowIso();
    rows[index] = {
      ...rows[index],
      last_used_at: timestamp,
      last_failure_at: timestamp,
      failure_reason: flags.reason || 'unknown_failure',
    };
    payload = { status: 'ok', credential: rows[index] };
    return rows;
  });
  printJson(payload);
}

async function runAppendApplyLog(flags) {
  const row = {
    attempt_id: requireFlag(flags, 'attempt-id'),
    timestamp: flags.timestamp || nowIso(),
    duration_seconds: flags['duration-seconds'] || '',
    company: requireFlag(flags, 'company'),
    role: requireFlag(flags, 'role'),
    job_url: requireFlag(flags, 'job-url'),
    platform: requireFlag(flags, 'platform'),
    tenant_key: requireFlag(flags, 'tenant-key'),
    application_id: requireFlag(flags, 'application-id'),
    report_num: flags['report-num'] || '',
    credential_id: flags['credential-id'] || '',
    credential_action: flags['credential-action'] || '',
    action: requireFlag(flags, 'action'),
    result: requireFlag(flags, 'result'),
    blocker_type: flags['blocker-type'] || '',
    notes: flags.notes || '',
  };

  await appendCsvRow(APPLY_LOG_FILE, APPLY_LOG_HEADERS, row);
  printJson({ status: 'ok', row });
}

async function runUpdateTracker(flags) {
  const applicationId = flags['application-id'] || '';
  const reportNum = flags['report-num'] || '';
  if (!applicationId && !reportNum) {
    throw new Error('update-tracker requires --application-id or --report-num');
  }

  let updatedRow = null;
  await updateApplications(ROOT, (rows) => {
    const row = rows.find((entry) => (
      (applicationId && entry.application_id === applicationId)
      || (reportNum && entry.report_num === reportNum)
    ));

    if (!row) {
      throw new Error(`Tracker row not found for application=${applicationId || '-'} report=${reportNum || '-'}`);
    }

    row.updated_at = nowIso();
    if (flags.status) row.status = canonicalStatus(flags.status);
    if (flags.note) row.details = appendNote(row.details, flags.note);
    if (flags['credential-id']) row.credential_id = flags['credential-id'];
    if (flags['login-identity']) row.login_identity = flags['login-identity'];
    if (flags['application-successful']) row.application_successful = flags['application-successful'];
    if (flags['applied-at']) row.applied_at = flags['applied-at'];
    if (flags['last-error']) row.last_error = flags['last-error'];
    updatedRow = row;
    return rows;
  });

  printJson({ status: 'ok', row: updatedRow });
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'init':
      await runInit();
      return;
    case 'get-or-create':
      await runGetOrCreate(flags);
      return;
    case 'rotate':
      await runRotate(flags);
      return;
    case 'record-success':
      await runRecordSuccess(flags);
      return;
    case 'record-failure':
      await runRecordFailure(flags);
      return;
    case 'append-apply-log':
      await runAppendApplyLog(flags);
      return;
    case 'update-tracker':
      await runUpdateTracker(flags);
      return;
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
