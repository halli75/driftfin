#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, extname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(message) {
  console.log(`  PASS ${message}`);
  passed += 1;
}

function fail(message) {
  console.log(`  FAIL ${message}`);
  failed += 1;
}

function warn(message) {
  console.log(`  WARN ${message}`);
  warnings += 1;
}

function run(command, args, cwd = ROOT) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fileExists(path) {
  return existsSync(join(ROOT, path));
}

function readFile(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function listFiles(directory = ROOT) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    if (entry === '.git' || entry === 'node_modules') continue;
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      output.push(...listFiles(fullPath));
    } else {
      output.push(fullPath);
    }
  }
  return output;
}

console.log('\ncareer-ops test suite\n');

console.log('1. Syntax checks');
for (const file of readdirSync(ROOT).filter((name) => name.endsWith('.mjs'))) {
  const result = run(process.execPath, ['--check', file]);
  if (result.status === 0) {
    pass(`${file} syntax OK`);
  } else {
    fail(`${file} has syntax errors`);
  }
}

console.log('\n2. Script execution');
for (const script of [
  ['verify-pipeline.mjs'],
  ['normalize-statuses.mjs'],
  ['dedup-tracker.mjs'],
  ['merge-tracker.mjs'],
  ['update-system.mjs', 'check'],
]) {
  const result = run(process.execPath, script);
  if (result.status === 0) {
    pass(`${script.join(' ')} runs`);
  } else {
    fail(`${script.join(' ')} failed`);
  }
}

const syncCheck = run(process.execPath, ['cv-sync-check.mjs']);
if (syncCheck.status === 0) {
  pass('cv-sync-check.mjs runs');
} else {
  warn('cv-sync-check.mjs reported missing user data');
}

if (!QUICK) {
  console.log('\n3. Dashboard build');
  const build = run('go', ['build', '-o', join(ROOT, 'career-dashboard-test'), '.'], join(ROOT, 'dashboard'));
  if (build.status === 0) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n3. Dashboard build skipped (--quick)');
}

console.log('\n4. Data contract files');
for (const file of [
  'AGENTS.md',
  'VERSION',
  'DATA_CONTRACT.md',
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/scan.md',
  'batch/batch-runner.mjs',
  'batch/batch-prompt.md',
  'templates/states.yml',
  'templates/cv-template.html',
]) {
  if (fileExists(file)) {
    pass(`System file exists: ${file}`);
  } else {
    fail(`Missing system file: ${file}`);
  }
}

console.log('\n5. User file tracking');
for (const file of ['config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
  const result = run('git', ['ls-files', '--error-unmatch', file]);
  if (result.status !== 0) {
    pass(`User file not tracked: ${file}`);
  } else {
    fail(`User file is tracked: ${file}`);
  }
}

console.log('\n6. Personal data leak check');
const leakPatterns = [
  'Santiago',
  'santifer.io',
  'Santifer iRepair',
  'Zinkee',
  'ALMAS',
  'hi@santifer.io',
  '688921377',
  '/Users/santifer/',
];
const allowedFiles = new Set([
  join(ROOT, 'LICENSE'),
  join(ROOT, 'CITATION.cff'),
  join(ROOT, '.github', 'FUNDING.yml'),
  join(ROOT, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'),
  join(ROOT, '.github', 'ISSUE_TEMPLATE', 'feature_request.yml'),
  join(ROOT, 'dashboard', 'internal', 'ui', 'screens', 'pipeline.go'),
  join(ROOT, 'package.json'),
  join(ROOT, 'test-all.mjs'),
]);
let leakFound = false;
for (const file of listFiles()) {
  const ext = extname(file).toLowerCase();
  if (!['.md', '.yml', '.html', '.mjs', '.json', '.go'].includes(ext)) continue;
  if (allowedFiles.has(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const pattern of leakPatterns) {
    if (content.includes(pattern)) {
      warn(`Possible personal data in ${file.replace(`${ROOT}\\`, '')}: ${pattern}`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

console.log('\n7. Absolute path check');
const badPaths = [];
for (const file of listFiles()) {
  const ext = extname(file).toLowerCase();
  if (!['.md', '.yml', '.html', '.mjs', '.json', '.go'].includes(ext)) continue;
  if (allowedFiles.has(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (content.includes('/Users/') || content.includes('C:\\Users\\')) {
    badPaths.push(file.replace(`${ROOT}\\`, ''));
  }
}
if (badPaths.length === 0) {
  pass('No absolute user paths in code files');
} else {
  for (const file of badPaths) {
    fail(`Absolute path found in ${file}`);
  }
}

console.log('\n8. Mode file integrity');
for (const mode of [
  '_shared.md',
  '_profile.template.md',
  'oferta.md',
  'pdf.md',
  'scan.md',
  'batch.md',
  'apply.md',
  'auto-pipeline.md',
  'contacto.md',
  'deep.md',
  'ofertas.md',
  'pipeline.md',
  'project.md',
  'tracker.md',
  'training.md',
]) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

if (readFile('modes/_shared.md').includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does not reference _profile.md');
}

console.log('\n9. AGENTS.md integrity');
const agents = readFile('AGENTS.md');
for (const section of [
  'Data Contract',
  'Update Check',
  'Ethical Use',
  'Offer Verification',
  'Canonical States',
  'TSV Format',
  'First Run',
  'Onboarding',
]) {
  if (agents.includes(section)) {
    pass(`AGENTS.md has section: ${section}`);
  } else {
    fail(`AGENTS.md missing section: ${section}`);
  }
}

console.log('\n10. Version file');
if (!fileExists('VERSION')) {
  fail('VERSION missing');
} else if (/^\d+\.\d+\.\d+$/.test(readFile('VERSION').trim())) {
  pass(`VERSION is valid semver: ${readFile('VERSION').trim()}`);
} else {
  fail(`VERSION is invalid: ${readFile('VERSION').trim()}`);
}

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  process.exit(1);
}

process.exit(0);
