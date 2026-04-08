#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getAgentMailSettings } from './profile-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

const isTTY = process.stdout.isTTY;
const green = (value) => isTTY ? `\x1b[32m${value}\x1b[0m` : value;
const red = (value) => isTTY ? `\x1b[31m${value}\x1b[0m` : value;
const dim = (value) => isTTY ? `\x1b[2m${value}\x1b[0m` : value;
const isWindows = process.platform === 'win32';

function run(command, args) {
  return spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  return major >= 18
    ? { pass: true, label: `Node.js >= 18 (v${process.versions.node})` }
    : { pass: false, label: `Node.js >= 18 (found v${process.versions.node})`, fix: 'Install Node.js 18 or later.' };
}

function checkDependencies() {
  return existsSync(join(ROOT, 'node_modules'))
    ? { pass: true, label: 'Dependencies installed' }
    : { pass: false, label: 'Dependencies not installed', fix: 'Run: npm install' };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const executable = chromium.executablePath();
    return existsSync(executable)
      ? { pass: true, label: 'Playwright chromium installed' }
      : { pass: false, label: 'Playwright chromium not installed', fix: 'Run: npx playwright install chromium' };
  } catch {
    return { pass: false, label: 'Playwright chromium not installed', fix: 'Run: npx playwright install chromium' };
  }
}

function checkCodexCli() {
  const result = isWindows ? run('cmd', ['/c', 'codex', '--version']) : run('codex', ['--version']);
  return result.status === 0
    ? { pass: true, label: `Codex CLI available (${result.stdout.trim()})` }
    : { pass: false, label: 'Codex CLI not available', fix: 'Install Codex CLI and ensure `codex` is on PATH.' };
}

function checkCodexLogin() {
  const result = isWindows ? run('cmd', ['/c', 'codex', 'login', 'status']) : run('codex', ['login', 'status']);
  return result.status === 0
    ? { pass: true, label: 'Codex login configured' }
    : { pass: false, label: 'Codex login not configured', fix: 'Run: codex login or configure your API-key login.' };
}

function checkAgentMail() {
  const settings = getAgentMailSettings(ROOT);
  if (!settings.enabled) {
    return { pass: true, label: 'AgentMail disabled (optional)' };
  }
  if (!settings.apiKey) {
    return {
      pass: false,
      label: `AgentMail enabled but ${settings.apiKeyEnv} is not set`,
      fix: [
        `Set ${settings.apiKeyEnv} in your shell or .env file.`,
        'Run: npm run agentmail:status',
      ],
    };
  }

  const result = run(process.execPath, ['agentmail-state.mjs', 'status']);
  return result.status === 0
    ? { pass: true, label: 'AgentMail ready' }
    : {
      pass: false,
      label: 'AgentMail check failed',
      fix: (result.stderr || result.stdout || 'Run: npm run agentmail:status').trim(),
    };
}

function checkCv() {
  return existsSync(join(ROOT, 'cv.md'))
    ? { pass: true, label: 'cv.md found' }
    : { pass: false, label: 'cv.md not found', fix: 'Create cv.md in the project root with your resume in markdown.' };
}

function checkProfile() {
  return existsSync(join(ROOT, 'config', 'profile.yml'))
    ? { pass: true, label: 'config/profile.yml found' }
    : { pass: false, label: 'config/profile.yml not found', fix: 'Copy config/profile.example.yml to config/profile.yml and fill it in.' };
}

function checkModesProfile() {
  const profilePath = join(ROOT, 'modes', '_profile.md');
  if (existsSync(profilePath)) {
    return { pass: true, label: 'modes/_profile.md found' };
  }

  const templatePath = join(ROOT, 'modes', '_profile.template.md');
  if (existsSync(templatePath)) {
    return { pass: false, label: 'modes/_profile.md not found', fix: 'Copy modes/_profile.template.md to modes/_profile.md.' };
  }

  return { pass: false, label: 'modes/_profile.template.md not found', fix: 'Restore modes/_profile.template.md from the repo.' };
}

function checkPortals() {
  return existsSync(join(ROOT, 'portals.yml'))
    ? { pass: true, label: 'portals.yml found' }
    : { pass: false, label: 'portals.yml not found', fix: 'Copy templates/portals.example.yml to portals.yml and customize it.' };
}

function checkFonts() {
  const fontsDir = join(ROOT, 'fonts');
  if (!existsSync(fontsDir)) {
    return { pass: false, label: 'fonts/ directory not found', fix: 'Restore the fonts/ directory.' };
  }
  try {
    const files = readdirSync(fontsDir);
    return files.length > 0
      ? { pass: true, label: 'Fonts directory ready' }
      : { pass: false, label: 'fonts/ directory is empty', fix: 'Restore the font files used by the CV template.' };
  } catch {
    return { pass: false, label: 'fonts/ directory not readable', fix: 'Check permissions on fonts/.' };
  }
}

function checkDirectory(name) {
  const target = join(ROOT, name);
  if (existsSync(target)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, '.gitkeep'), '', { flag: 'a' });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return { pass: false, label: `${name}/ directory could not be created`, fix: `Create ${name}/ manually.` };
  }
}

async function main() {
  console.log('\ndriftfin doctor');
  console.log('================\n');

  const checks = [
    checkNodeVersion(),
    checkCodexCli(),
    checkCodexLogin(),
    checkAgentMail(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    checkModesProfile(),
    checkPortals(),
    checkFonts(),
    checkDirectory('data'),
    checkDirectory('output'),
    checkDirectory('reports'),
  ];

  let failures = 0;
  for (const check of checks) {
    if (check.pass) {
      console.log(`${green('✓')} ${check.label}`);
    } else {
      failures += 1;
      console.log(`${red('✗')} ${check.label}`);
      for (const fix of Array.isArray(check.fix) ? check.fix : [check.fix]) {
        console.log(`  ${dim(`→ ${fix}`)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  }

  console.log('Result: All checks passed. You are ready to go. Run `codex` from the repo root to start.');
}

main().catch((error) => {
  console.error(`doctor.mjs failed: ${error.message}`);
  process.exit(1);
});
