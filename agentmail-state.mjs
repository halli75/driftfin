#!/usr/bin/env node

import {
  ensureSharedInbox,
  getAgentMailStatus,
  initAgentMailState,
  pollVerification,
} from './agentmail-client.mjs';

function usage() {
  console.log(`driftfin agentmail state

Usage:
  node agentmail-state.mjs status
  node agentmail-state.mjs init
  node agentmail-state.mjs ensure-shared-inbox
  node agentmail-state.mjs poll-verification --since ISO [--timeout-seconds N] [--interval-seconds N] [--platform NAME] [--company NAME] [--sender-hint TEXT] [--subject-hint TEXT]
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

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function requireFlag(flags, name) {
  if (!flags[name]) {
    throw new Error(`Missing required flag --${name}`);
  }
  return flags[name];
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'status':
      printJson(await getAgentMailStatus());
      return;
    case 'init':
      printJson(await initAgentMailState());
      return;
    case 'ensure-shared-inbox':
      printJson(await ensureSharedInbox());
      return;
    case 'poll-verification':
      printJson(await pollVerification(undefined, {
        since: requireFlag(flags, 'since'),
        timeoutSeconds: flags['timeout-seconds'],
        intervalSeconds: flags['interval-seconds'],
        platform: flags.platform,
        company: flags.company,
        senderHint: flags['sender-hint'],
        subjectHint: flags['subject-hint'],
      }));
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
