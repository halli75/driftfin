#!/usr/bin/env node

import { copyFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  applicationsCsvPath,
  canonicalStatus,
  normalizeCompany,
  normalizeUrl,
  parseScoreValue,
  readApplications,
  replaceApplications,
  roleMatch,
} from './applications-store.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = applicationsCsvPath(ROOT);
const DRY_RUN = process.argv.includes('--dry-run');

const STATUS_RANK = {
  discovered: 0,
  skipped: 0,
  evaluated: 1,
  applying: 2,
  blocked: 2,
  failed: 2,
  applied: 3,
  responded: 4,
  interview: 5,
  offer: 6,
  rejected: 7,
  closed: 7,
  duplicate: 7,
};

function chooseKeeper(cluster) {
  return [...cluster].sort((left, right) => {
    const scoreDelta = parseScoreValue(right.score) - parseScoreValue(left.score);
    if (scoreDelta !== 0) return scoreDelta;
    return Number.parseInt(left.application_id, 10) - Number.parseInt(right.application_id, 10);
  })[0];
}

function mergeRows(keeper, duplicate) {
  const keeperStatus = canonicalStatus(keeper.status);
  const duplicateStatus = canonicalStatus(duplicate.status);
  if ((STATUS_RANK[duplicateStatus] ?? 0) > (STATUS_RANK[keeperStatus] ?? 0)) {
    keeper.status = duplicate.status;
  }

  if (parseScoreValue(duplicate.score) > parseScoreValue(keeper.score)) {
    keeper.score = duplicate.score;
    keeper.grade = duplicate.grade;
  }

  if (!keeper.url && duplicate.url) keeper.url = duplicate.url;
  if (!keeper.report_num && duplicate.report_num) keeper.report_num = duplicate.report_num;
  if (!keeper.report_path && duplicate.report_path) keeper.report_path = duplicate.report_path;
  if (!keeper.custom_resume_path && duplicate.custom_resume_path) keeper.custom_resume_path = duplicate.custom_resume_path;
  if (!keeper.application_successful && duplicate.application_successful) keeper.application_successful = duplicate.application_successful;
  if (!keeper.credential_id && duplicate.credential_id) keeper.credential_id = duplicate.credential_id;
  if (!keeper.login_identity && duplicate.login_identity) keeper.login_identity = duplicate.login_identity;
  if (!keeper.applied_at && duplicate.applied_at) keeper.applied_at = duplicate.applied_at;
  if (!keeper.last_error && duplicate.last_error) keeper.last_error = duplicate.last_error;

  const notes = [keeper.details, duplicate.details].filter(Boolean);
  keeper.details = [...new Set(notes)].join('; ');
}

function buildClusters(rows) {
  const clusters = [];
  const used = new Set();

  for (let index = 0; index < rows.length; index += 1) {
    if (used.has(index)) continue;
    const seed = rows[index];
    const cluster = [seed];
    used.add(index);

    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      if (used.has(cursor)) continue;
      const candidate = rows[cursor];
      const sameUrl = normalizeUrl(seed.url) && normalizeUrl(seed.url) === normalizeUrl(candidate.url);
      const sameRole = normalizeCompany(seed.company) === normalizeCompany(candidate.company) && roleMatch(seed.position, candidate.position);
      if (sameUrl || sameRole) {
        cluster.push(candidate);
        used.add(cursor);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

async function main() {
  const rows = readApplications(ROOT).map((row) => ({ ...row }));
  if (rows.length === 0) {
    console.log('No applications found. Nothing to dedup.');
    return;
  }

  const clusters = buildClusters(rows);
  const deduped = [];
  let removed = 0;

  for (const cluster of clusters) {
    if (cluster.length === 1) {
      deduped.push(cluster[0]);
      continue;
    }

    const keeper = chooseKeeper(cluster);
    for (const row of cluster) {
      if (row === keeper) continue;
      mergeRows(keeper, row);
      removed += 1;
    }
    deduped.push(keeper);
  }

  console.log(`Loaded: ${rows.length}`);
  console.log(`Duplicates removed: ${removed}`);

  if (DRY_RUN || removed === 0) {
    if (DRY_RUN) console.log('(dry-run - no changes written)');
    return;
  }

  if (existsSync(APPS_FILE)) {
    copyFileSync(APPS_FILE, `${APPS_FILE}.bak`);
  }
  await replaceApplications(ROOT, deduped);
  console.log('Wrote applications.csv (backup: applications.csv.bak)');
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
