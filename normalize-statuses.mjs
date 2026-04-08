#!/usr/bin/env node

import { copyFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  applicationsCsvPath,
  canonicalStatus,
  readApplications,
  replaceApplications,
} from './applications-store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = applicationsCsvPath(ROOT);
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const rows = readApplications(ROOT).map((row) => ({ ...row }));
  if (rows.length === 0) {
    console.log('No applications found. Nothing to normalize.');
    return;
  }

  let changes = 0;
  for (const row of rows) {
    const normalized = canonicalStatus(row.status);
    if (row.status !== normalized) {
      row.status = normalized;
      row.updated_at = new Date().toISOString();
      changes += 1;
    }
  }

  console.log(`Statuses normalized: ${changes}`);

  if (DRY_RUN || changes === 0) {
    if (DRY_RUN) console.log('(dry-run - no changes written)');
    return;
  }

  if (existsSync(APPS_FILE)) {
    copyFileSync(APPS_FILE, `${APPS_FILE}.bak`);
  }
  await replaceApplications(ROOT, rows);
  console.log('Wrote applications.csv (backup: applications.csv.bak)');
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
