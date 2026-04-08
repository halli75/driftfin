#!/usr/bin/env node

import { existsSync, renameSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  APPLICATION_HEADERS,
  applicationsCsvPath,
  applicationsLegacyMdPath,
  parseLegacyApplicationsMarkdown,
  replaceApplications,
} from './applications-store.mjs';
import { readCsv } from './csv-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--commit');
const FORCE = process.argv.includes('--force');

function usage() {
  console.log(`driftfin applications.csv migration

Usage:
  node migrate-applications-csv.mjs --dry-run
  node migrate-applications-csv.mjs --commit [--force]

Notes:
  - default mode is --dry-run
  - --commit writes data/applications.csv and renames the source markdown file to *.legacy
  - --force allows overwriting a non-empty applications.csv
`);
}

async function main() {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    usage();
    return;
  }

  const legacyPath = applicationsLegacyMdPath(ROOT);
  if (!existsSync(legacyPath)) {
    console.log('No legacy applications.md found. Nothing to migrate.');
    return;
  }

  const rows = parseLegacyApplicationsMarkdown(ROOT);
  const csvPath = applicationsCsvPath(ROOT);
  const legacyTarget = `${legacyPath}.legacy`;
  const existingCsv = existsSync(csvPath);
  const existingCsvRows = existingCsv ? readCsv(csvPath, APPLICATION_HEADERS) : [];

  console.log(`Source: ${legacyPath}`);
  console.log(`Target: ${csvPath}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Headers: ${APPLICATION_HEADERS.join(', ')}`);

  if (rows.length > 0) {
    console.log('\nSample:');
    for (const row of rows.slice(0, 3)) {
      console.log(`- #${row.application_id} ${row.company} | ${row.position} | ${row.status} | score=${row.score || '-'} | grade=${row.grade || '-'}`);
    }
  }

  if (DRY_RUN) {
    console.log('\nDry run only. Re-run with --commit to write applications.csv.');
    return;
  }

  if (existingCsvRows.length > 0 && !FORCE) {
    throw new Error('applications.csv already exists. Re-run with --force if you want to overwrite it.');
  }

  await replaceApplications(ROOT, rows);

  if (!existsSync(legacyTarget)) {
    renameSync(legacyPath, legacyTarget);
    console.log(`Renamed legacy tracker to ${basename(legacyTarget)}`);
  } else {
    console.log(`Legacy tracker already preserved at ${basename(legacyTarget)}`);
  }

  console.log(`Wrote ${rows.length} rows to ${csvPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
