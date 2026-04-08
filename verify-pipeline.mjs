#!/usr/bin/env node

import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  applicationsCsvPath,
  canonicalStatus,
  normalizeCompany,
  normalizeUrl,
  parseScoreValue,
  readApplications,
  roleMatch,
} from './applications-store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = applicationsCsvPath(ROOT);
const REPORTS_DIR = join(ROOT, 'reports');
const ADDITIONS_DIR = join(ROOT, 'batch', 'tracker-additions');

let errors = 0;
let warnings = 0;

function error(message) {
  console.log(`ERROR ${message}`);
  errors += 1;
}

function warn(message) {
  console.log(`WARN ${message}`);
  warnings += 1;
}

function ok(message) {
  console.log(`OK ${message}`);
}

function main() {
  const rows = readApplications(ROOT);
  if (rows.length === 0) {
    console.log('No applications found. This is normal for a fresh setup.');
    return;
  }

  console.log(`Checking ${rows.length} rows in ${existsSync(APPS_FILE) ? 'applications.csv' : 'legacy applications.md'}`);

  let badStatuses = 0;
  let badScores = 0;
  let badReports = 0;
  let duplicates = 0;

  for (const row of rows) {
    const status = canonicalStatus(row.status);
    if (![
      'discovered', 'evaluated', 'applying', 'applied', 'blocked',
      'failed', 'duplicate', 'closed', 'skipped', 'responded',
      'interview', 'offer', 'rejected',
    ].includes(status)) {
      error(`#${row.application_id}: unknown status "${row.status}"`);
      badStatuses += 1;
    }

    if (row.score) {
      const numeric = parseScoreValue(row.score);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 5) {
        error(`#${row.application_id}: invalid score "${row.score}"`);
        badScores += 1;
      }
    }

    if (row.report_path) {
      const reportPath = join(ROOT, row.report_path);
      if (!existsSync(reportPath)) {
        error(`#${row.application_id}: missing report ${row.report_path}`);
        badReports += 1;
      }
    }
  }

  if (badStatuses === 0) ok('All statuses valid');
  if (badScores === 0) ok('All scores valid');
  if (badReports === 0) ok('All report paths valid');

  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const sameUrl = normalizeUrl(rows[left].url) && normalizeUrl(rows[left].url) === normalizeUrl(rows[right].url);
      const sameRole = normalizeCompany(rows[left].company) === normalizeCompany(rows[right].company)
        && roleMatch(rows[left].position, rows[right].position);
      if (sameUrl || sameRole) {
        warn(`possible duplicate: #${rows[left].application_id} and #${rows[right].application_id}`);
        duplicates += 1;
      }
    }
  }
  if (duplicates === 0) ok('No duplicates found');

  const pendingTsvs = existsSync(ADDITIONS_DIR)
    ? readdirSync(ADDITIONS_DIR).filter((file) => file.endsWith('.tsv')).length
    : 0;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSV additions not merged`);
  } else {
    ok('No pending TSV additions');
  }

  console.log(`Results: ${errors} errors, ${warnings} warnings`);
  process.exit(errors > 0 ? 1 : 0);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
