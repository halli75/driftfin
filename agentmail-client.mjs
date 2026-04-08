#!/usr/bin/env node

import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import lockfile from 'proper-lockfile';
import { AgentMailClient } from 'agentmail';
import { getAgentMailSettings } from './profile-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = join(ROOT, 'data');
const STATE_FILE = join(DATA_DIR, 'agentmail-state.json');

function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function ensureStateFile(root = ROOT) {
  const filePath = agentmailStatePath(root);
  ensureParentDir(filePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(defaultState(), null, 2)}\n`, 'utf8');
  }
}

function defaultState() {
  return {
    shared_inbox: null,
  };
}

function lockOptions() {
  return {
    stale: 30000,
    update: 5000,
    realpath: false,
    retries: {
      retries: 30,
      factor: 1.3,
      minTimeout: 25,
      maxTimeout: 400,
      randomize: false,
    },
  };
}

function readState(root = ROOT) {
  ensureStateFile(root);
  const raw = readFileSync(agentmailStatePath(root), 'utf8').trim();
  if (!raw) {
    return defaultState();
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        ...defaultState(),
        ...parsed,
      };
    }
  } catch {
    // Fall through.
  }
  return defaultState();
}

function writeState(root, state) {
  const filePath = agentmailStatePath(root);
  ensureStateFile(root);
  const tempPath = join(dirname(filePath), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tempPath, filePath);
}

async function withStateLock(root, callback) {
  ensureStateFile(root);
  const filePath = agentmailStatePath(root);
  const release = await lockfile.lock(filePath, lockOptions());
  try {
    return await callback(readState(root));
  } finally {
    await release();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return normalizeString(value).replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stableClientId(settings) {
  const seed = [
    settings.candidateEmail.toLowerCase(),
    settings.sharedInboxUsername.toLowerCase(),
    settings.inboxDomain.toLowerCase(),
  ].join('|');
  const digest = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `driftfin-shared-inbox-${digest}`;
}

function createClient(settings) {
  if (!settings.enabled) {
    return null;
  }
  if (!settings.apiKeyEnv) {
    throw new Error('AgentMail config is missing automation.email.agentmail.api_key_env');
  }
  if (!settings.apiKey) {
    throw new Error(`AgentMail is enabled but ${settings.apiKeyEnv} is not set`);
  }
  return new AgentMailClient({ apiKey: settings.apiKey });
}

function inboxSnapshot(inbox, settings) {
  return {
    inbox_id: normalizeString(inbox.inboxId),
    email: normalizeString(inbox.email),
    username: settings.sharedInboxUsername,
    domain: settings.inboxDomain || normalizeString(inbox.email).split('@')[1] || '',
    client_id: normalizeString(inbox.clientId) || stableClientId(settings),
    created_at: toIso(inbox.createdAt) || nowIso(),
    updated_at: toIso(inbox.updatedAt) || nowIso(),
    last_poll_at: '',
    last_seen_message_id: '',
    last_seen_received_at: '',
  };
}

function messageTimestamp(message) {
  return toIso(message.timestamp || message.createdAt || message.updatedAt);
}

function messageBody(message) {
  return [
    normalizeText(message.extractedText),
    normalizeText(message.text),
    normalizeText(message.extractedHtml),
    normalizeText(message.html),
    normalizeText(message.preview),
  ].filter(Boolean).join('\n');
}

function messageFrom(message) {
  const raw = message.from;
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeText(entry)).join(', ');
  }
  return normalizeText(raw);
}

function messageSubject(message) {
  return normalizeText(message.subject);
}

function extractLinks(text) {
  return [...String(text ?? '').matchAll(/https?:\/\/[^\s<>"')]+/gi)].map((match) => match[0]);
}

function findOtp(text) {
  const patterns = [
    /\b(?:code|otp|verification|verify|security|passcode)[^0-9]{0,20}(\d{4,8})\b/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/,
  ];
  for (const pattern of patterns) {
    const match = String(text ?? '').match(pattern);
    if (match) {
      return match[1];
    }
  }
  return '';
}

function looksLikeVerificationLink(link) {
  return /(verify|confirm|signin|sign-in|login|magic|activate|access|auth|token|code)/i.test(link);
}

function extractVerification(message) {
  const body = messageBody(message);
  const links = extractLinks(body);
  const verificationLink = links.find((link) => looksLikeVerificationLink(link)) || '';
  const otp = findOtp(body);

  if (verificationLink) {
    return { kind: 'link', value: verificationLink };
  }
  if (otp) {
    return { kind: 'otp', value: otp };
  }
  if (body) {
    return { kind: 'message', value: body.slice(0, 400) };
  }
  return { kind: 'none', value: '' };
}

function scoreMessage(message, options) {
  const body = messageBody(message).toLowerCase();
  const subject = messageSubject(message).toLowerCase();
  const from = messageFrom(message).toLowerCase();
  let score = 0;

  const terms = [];
  if (options.senderHint) terms.push(String(options.senderHint).toLowerCase());
  if (options.subjectHint) terms.push(String(options.subjectHint).toLowerCase());
  if (options.company) terms.push(String(options.company).toLowerCase());
  if (options.platform) terms.push(String(options.platform).toLowerCase());

  for (const term of terms) {
    if (!term) continue;
    if (from.includes(term)) score += 5;
    if (subject.includes(term)) score += 4;
    if (body.includes(term)) score += 2;
  }

  if (/(verify|verification|confirm|security|otp|code|sign in|signin|activate|login)/i.test(`${subject}\n${body}`)) {
    score += 4;
  }

  const verification = extractVerification(message);
  if (verification.kind === 'link') score += 3;
  if (verification.kind === 'otp') score += 2;

  return score;
}

function normalizePollOptions(options = {}) {
  return {
    since: normalizeString(options.since),
    timeoutSeconds: Number.parseInt(options.timeoutSeconds, 10) || 180,
    intervalSeconds: Number.parseInt(options.intervalSeconds, 10) || 5,
    platform: normalizeString(options.platform),
    company: normalizeString(options.company),
    senderHint: normalizeString(options.senderHint),
    subjectHint: normalizeString(options.subjectHint),
  };
}

export function agentmailStatePath(root = ROOT) {
  return join(root, 'data', 'agentmail-state.json');
}

export async function initAgentMailState(root = ROOT) {
  ensureStateFile(root);
  return {
    status: 'ok',
    enabled: getAgentMailSettings(root).enabled,
    state_file: agentmailStatePath(root),
  };
}

export async function getAgentMailStatus(root = ROOT) {
  const settings = getAgentMailSettings(root);
  const state = readState(root);

  if (!settings.enabled) {
    return {
      status: 'disabled',
      enabled: false,
      preferred_provider: settings.preferredProvider,
      state_file: agentmailStatePath(root),
    };
  }

  if (!settings.apiKey) {
    return {
      status: 'error',
      enabled: true,
      preferred_provider: settings.preferredProvider,
      api_key_env: settings.apiKeyEnv,
      message: `AgentMail is enabled but ${settings.apiKeyEnv} is not set`,
      state_file: agentmailStatePath(root),
    };
  }

  const client = createClient(settings);
  try {
    await client.inboxes.list({ limit: 1 });
    return {
      status: 'ok',
      enabled: true,
      preferred_provider: settings.preferredProvider,
      api_key_env: settings.apiKeyEnv,
      inbox_email: state.shared_inbox?.email || '',
      state_file: agentmailStatePath(root),
    };
  } catch (error) {
    return {
      status: 'error',
      enabled: true,
      preferred_provider: settings.preferredProvider,
      api_key_env: settings.apiKeyEnv,
      inbox_email: state.shared_inbox?.email || '',
      message: error.message,
      state_file: agentmailStatePath(root),
    };
  }
}

export async function ensureSharedInbox(root = ROOT) {
  const settings = getAgentMailSettings(root);
  if (!settings.enabled) {
    return {
      status: 'disabled',
      preferred_provider: settings.preferredProvider,
    };
  }

  const client = createClient(settings);
  return withStateLock(root, async (state) => {
    const current = state.shared_inbox;
    if (current?.inbox_id) {
      try {
        const inbox = await client.inboxes.get(current.inbox_id);
        const nextState = {
          ...state,
          shared_inbox: {
            ...current,
            email: normalizeString(inbox.email) || current.email,
            updated_at: toIso(inbox.updatedAt) || current.updated_at || nowIso(),
          },
        };
        writeState(root, nextState);
        return {
          status: 'ok',
          action: 'reused',
          inbox: nextState.shared_inbox,
        };
      } catch {
        // Fall through to idempotent create.
      }
    }

    const request = {
      clientId: stableClientId(settings),
      username: settings.sharedInboxUsername,
      displayName: 'Driftfin',
    };
    if (settings.inboxDomain) {
      request.domain = settings.inboxDomain;
    }

    const inbox = await client.inboxes.create(request);
    const snapshot = inboxSnapshot(inbox, settings);
    const nextState = {
      ...state,
      shared_inbox: snapshot,
    };
    writeState(root, nextState);
    return {
      status: 'ok',
      action: 'created',
      inbox: snapshot,
    };
  });
}

export async function pollVerification(root = ROOT, rawOptions = {}) {
  const settings = getAgentMailSettings(root);
  if (!settings.enabled) {
    return {
      status: 'disabled',
      kind: 'none',
      value: '',
      message_id: '',
      received_at: '',
      from: '',
      subject: '',
    };
  }

  const options = normalizePollOptions({
    timeoutSeconds: settings.verificationTimeoutSeconds,
    intervalSeconds: settings.pollIntervalSeconds,
    ...rawOptions,
  });
  const sinceIso = options.since || nowIso();
  const sinceMs = new Date(sinceIso).getTime();
  if (Number.isNaN(sinceMs)) {
    throw new Error(`Invalid --since timestamp: ${sinceIso}`);
  }

  const inboxResult = await ensureSharedInbox(root);
  const inbox = inboxResult.inbox;
  const client = createClient(settings);
  const timeoutAt = Date.now() + (options.timeoutSeconds * 1000);
  let bestCandidate = null;
  let lastTimestamp = '';
  let lastMessageId = '';

  while (Date.now() <= timeoutAt) {
    const response = await client.inboxes.messages.list(inbox.inbox_id, { limit: 25 });
    const messages = Array.isArray(response.messages) ? response.messages : [];

    for (const message of messages) {
      const fullMessage = (message.extractedText || message.text || message.extractedHtml || message.html || message.preview)
        ? message
        : await client.inboxes.messages.get(inbox.inbox_id, message.messageId);
      const receivedAt = messageTimestamp(fullMessage);
      const receivedMs = new Date(receivedAt).getTime();
      if (!receivedAt || Number.isNaN(receivedMs) || receivedMs < sinceMs) {
        continue;
      }

      lastTimestamp = receivedAt;
      lastMessageId = normalizeString(fullMessage.messageId);

      const verification = extractVerification(fullMessage);
      if (verification.kind === 'none') {
        continue;
      }

      const candidate = {
        status: 'found',
        kind: verification.kind,
        value: verification.value,
        message_id: normalizeString(fullMessage.messageId),
        received_at: receivedAt,
        from: messageFrom(fullMessage),
        subject: messageSubject(fullMessage),
        inbox_email: inbox.email,
        score: scoreMessage(fullMessage, options),
      };

      if (!bestCandidate || candidate.score > bestCandidate.score || candidate.received_at > bestCandidate.received_at) {
        bestCandidate = candidate;
      }
    }

    await withStateLock(root, async (state) => {
      const current = state.shared_inbox || inbox;
      const nextState = {
        ...state,
        shared_inbox: {
          ...current,
          last_poll_at: nowIso(),
          last_seen_message_id: bestCandidate?.message_id || lastMessageId || current.last_seen_message_id || '',
          last_seen_received_at: bestCandidate?.received_at || lastTimestamp || current.last_seen_received_at || '',
        },
      };
      writeState(root, nextState);
    });

    if (bestCandidate) {
      const { score, ...payload } = bestCandidate;
      return payload;
    }

    await sleep(options.intervalSeconds * 1000);
  }

  return {
    status: 'timeout',
    kind: 'none',
    value: '',
    message_id: '',
    received_at: '',
    from: '',
    subject: '',
    inbox_email: inbox.email,
  };
}
