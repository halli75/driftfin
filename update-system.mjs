#!/usr/bin/env node

/**
 * update-system.mjs - Safe auto-updater for career-ops
 *
 * Updates only system-layer files.
 * Never touches user data such as cv.md, profile.yml, portals.yml, reports, or tracker data.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const SYSTEM_PATHS = [
  'AGENTS.md',
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/scan.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/de/',
  'modes/fr/',
  'generate-pdf.mjs',
  'merge-tracker.mjs',
  'verify-pipeline.mjs',
  'dedup-tracker.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'doctor.mjs',
  'test-all.mjs',
  'update-system.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.mjs',
  'dashboard/',
  'templates/',
  'fonts/',
  'docs/',
  'VERSION',
  'DATA_CONTRACT.md',
  'CONTRIBUTING.md',
  'README.md',
  'LICENSE',
  'CITATION.cff',
  '.github/',
  'package.json',
];

const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/story-bank.md',
  'data/',
  'reports/',
  'output/',
  'jds/',
];

function git(command) {
  return execSync(`git ${command}`, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  }).trim();
}

function localVersion() {
  const versionPath = join(ROOT, 'VERSION');
  return existsSync(versionPath) ? readFileSync(versionPath, 'utf8').trim() : '0.0.0';
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

function normalizeRepoUrl(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/\.git$/, '');
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)\/(.+)$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)\/(.+)$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

function resolvedRepoInfo() {
  const override = process.env.CAREER_OPS_UPSTREAM;
  const originUrl = override || git('remote get-url origin');
  const parsed = normalizeRepoUrl(originUrl);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    fetchUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
    rawVersionUrl: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/main/VERSION`,
    releasesApi: `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/latest`,
  };
}

function dismissPath() {
  return join(ROOT, '.update-dismissed');
}

function lockPath() {
  return join(ROOT, '.update-lock');
}

async function check() {
  if (existsSync(dismissPath())) {
    console.log(JSON.stringify({ status: 'dismissed' }));
    return;
  }

  const repo = resolvedRepoInfo();
  const local = localVersion();
  if (!repo) {
    console.log(JSON.stringify({ status: 'offline', local }));
    return;
  }

  let remote;
  try {
    const response = await fetch(repo.rawVersionUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    remote = (await response.text()).trim();
  } catch {
    console.log(JSON.stringify({ status: 'offline', local }));
    return;
  }

  if (compareVersions(local, remote) >= 0) {
    console.log(JSON.stringify({ status: 'up-to-date', local, remote }));
    return;
  }

  let changelog = '';
  try {
    const response = await fetch(repo.releasesApi, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (response.ok) {
      const release = await response.json();
      changelog = (release.body || '').slice(0, 500);
    }
  } catch {
    // Best-effort only.
  }

  console.log(JSON.stringify({
    status: 'update-available',
    local,
    remote,
    changelog,
    source: `${repo.owner}/${repo.repo}`,
  }));
}

async function apply() {
  const repo = resolvedRepoInfo();
  if (!repo) {
    console.error('Cannot resolve update source. Set CAREER_OPS_UPSTREAM or configure git origin.');
    process.exit(1);
  }

  if (existsSync(lockPath())) {
    console.error('Update already in progress (.update-lock exists).');
    process.exit(1);
  }

  writeFileSync(lockPath(), nowIso());

  try {
    const backupBranch = `backup-pre-update-${localVersion()}`;
    try {
      git(`branch ${backupBranch}`);
      console.log(`Backup branch created: ${backupBranch}`);
    } catch {
      console.log(`Backup branch already exists: ${backupBranch}`);
    }

    console.log(`Fetching latest system files from ${repo.owner}/${repo.repo}...`);
    git(`fetch ${repo.fetchUrl} main`);

    const updated = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git(`checkout FETCH_HEAD -- ${path}`);
        updated.push(path);
      } catch {
        // Path may not exist in remote fork. Skip.
      }
    }

    const status = git('status --porcelain');
    const touchedUserPaths = status
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3))
      .filter((file) => USER_PATHS.some((prefix) => file.startsWith(prefix)));

    if (touchedUserPaths.length > 0) {
      console.error('Safety violation: user files were modified by the updater.');
      for (const file of touchedUserPaths) {
        console.error(`- ${file}`);
      }
      process.exit(1);
    }

    try {
      execSync('npm install --silent', { cwd: ROOT, timeout: 60000, stdio: 'ignore' });
    } catch {
      console.log('npm install skipped. Run it manually if dependencies changed.');
    }

    try {
      git('add .');
      git(`commit -m "chore: auto-update system files to v${localVersion()}"`);
    } catch {
      // Nothing to commit is acceptable.
    }

    if (existsSync(dismissPath())) {
      unlinkSync(dismissPath());
    }

    console.log(`Update complete from ${repo.owner}/${repo.repo}.`);
    console.log(`Updated ${updated.length} system paths.`);
  } finally {
    if (existsSync(lockPath())) {
      unlinkSync(lockPath());
    }
  }
}

function rollback() {
  let branches;
  try {
    branches = git('branch --list "backup-pre-update-*"');
  } catch (error) {
    console.error(`Rollback failed: ${error.message}`);
    process.exit(1);
  }

  const candidates = branches
    .split('\n')
    .map((line) => line.replace('*', '').trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    console.error('No backup branches found.');
    process.exit(1);
  }

  const latest = candidates[candidates.length - 1];
  for (const path of SYSTEM_PATHS) {
    try {
      git(`checkout ${latest} -- ${path}`);
    } catch {
      // Path may not have existed in backup branch.
    }
  }

  try {
    git('add .');
    git(`commit -m "chore: rollback system files from ${latest}"`);
  } catch {
    // Nothing to commit.
  }

  console.log(`Rollback complete from ${latest}.`);
}

function dismiss() {
  writeFileSync(dismissPath(), nowIso());
  console.log('Update check dismissed.');
}

function nowIso() {
  return new Date().toISOString();
}

const command = process.argv[2] || 'check';

switch (command) {
  case 'check':
    await check();
    break;
  case 'apply':
    await apply();
    break;
  case 'rollback':
    rollback();
    break;
  case 'dismiss':
    dismiss();
    break;
  default:
    console.log('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
    process.exit(1);
}
