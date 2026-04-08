#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

let envLoaded = false;

function loadEnvFile(path, override) {
  if (existsSync(path)) {
    dotenv.config({ path, override, quiet: true });
  }
}

export function loadProfileEnv(root = ROOT) {
  if (envLoaded) {
    return;
  }
  loadEnvFile(join(root, '.env'), false);
  loadEnvFile(join(root, '.env.local'), true);
  envLoaded = true;
}

export function profilePath(root = ROOT) {
  return join(root, 'config', 'profile.yml');
}

export function readProfileConfig(root = ROOT) {
  loadProfileEnv(root);
  const path = profilePath(root);
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, 'utf8');
  const parsed = YAML.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberValue(value, fallback) {
  const numeric = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function boolValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export function getCandidateProfile(root = ROOT) {
  const profile = readProfileConfig(root);
  return profile.candidate && typeof profile.candidate === 'object' ? profile.candidate : {};
}

export function getCandidateEmail(root = ROOT) {
  return stringValue(getCandidateProfile(root).email);
}

export function getAutosubmitSettings(root = ROOT) {
  const profile = readProfileConfig(root);
  const autosubmit = profile?.automation?.autosubmit ?? {};
  return {
    enabled: boolValue(autosubmit.enabled, false),
    applyAllMatches: boolValue(autosubmit.apply_all_matches, false),
    minimumScore: numberValue(autosubmit.minimum_score, 4.0),
    blockerPolicy: stringValue(autosubmit.blocker_policy, 'pause'),
    emailAliasStrategy: stringValue(autosubmit.email_alias_strategy, 'platform'),
    workdayReuseScope: stringValue(autosubmit.workday_reuse_scope, 'company'),
  };
}

function defaultSharedInboxUsername(candidateEmail) {
  const local = stringValue(candidateEmail).split('@')[0] || 'driftfin';
  const safe = local.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? `${safe}-driftfin` : 'driftfin';
}

export function getAgentMailSettings(root = ROOT) {
  const profile = readProfileConfig(root);
  const candidate = getCandidateProfile(root);
  const email = profile?.automation?.email ?? {};
  const agentmail = email.agentmail ?? {};
  const candidateEmail = stringValue(candidate.email);
  const apiKeyEnv = stringValue(agentmail.api_key_env, 'AGENTMAIL_API_KEY');
  const preferredProvider = stringValue(email.preferred_provider, 'agentmail');
  const enabled = preferredProvider === 'agentmail' && boolValue(agentmail.enabled, false);
  const sharedInboxUsername = stringValue(agentmail.shared_inbox_username)
    || defaultSharedInboxUsername(candidateEmail);

  return {
    preferredProvider,
    enabled,
    verificationTimeoutSeconds: numberValue(email.verification_timeout_seconds, 180),
    pollIntervalSeconds: numberValue(email.poll_interval_seconds, 5),
    apiKeyEnv,
    apiKey: stringValue(process.env[apiKeyEnv]),
    inboxDomain: stringValue(agentmail.inbox_domain),
    sharedInboxUsername,
    candidateEmail,
    candidateName: stringValue(candidate.full_name, 'Driftfin'),
  };
}
