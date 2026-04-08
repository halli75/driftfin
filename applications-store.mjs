#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureCsvFile, readCsv, replaceCsvFile, updateCsvRows, writeCsv } from './csv-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

export const APPLICATION_HEADERS = [
  'application_id',
  'discovered_at',
  'updated_at',
  'company',
  'position',
  'url',
  'source',
  'status',
  'score',
  'grade',
  'details',
  'report_num',
  'report_path',
  'custom_resume_path',
  'application_successful',
  'credential_id',
  'login_identity',
  'applied_at',
  'last_error',
];

export function applicationsCsvPath(root = ROOT) {
  return join(root, 'data', 'applications.csv');
}

export function applicationsLegacyMdPath(root = ROOT) {
  const dataPath = join(root, 'data', 'applications.md');
  if (existsSync(dataPath)) {
    return dataPath;
  }
  return join(root, 'applications.md');
}

export function ensureApplicationsCsv(root = ROOT) {
  ensureCsvFile(applicationsCsvPath(root), APPLICATION_HEADERS);
}

export function normalizeUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    parsed.hash = '';

    const removableParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gh_src',
      'gh_jid',
      'gh_jid',
      'source',
      'sourceid',
      'src',
      'ref',
      'refs',
    ];
    for (const key of removableParams) {
      parsed.searchParams.delete(key);
    }

    let normalizedPath = parsed.pathname.replace(/\/{2,}/g, '/');
    if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    parsed.pathname = normalizedPath;
    parsed.host = parsed.host.toLowerCase();
    return parsed.toString();
  } catch {
    return text.replace(/\/+$/, '');
  }
}

export function normalizeCompany(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

export function normalizeRole(role) {
  return String(role ?? '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 /]/g, '')
    .trim();
}

export function roleMatch(a, b) {
  const wordsA = normalizeRole(a).split(/\s+/).filter((word) => word.length > 3);
  const wordsB = normalizeRole(b).split(/\s+/).filter((word) => word.length > 3);
  const overlap = wordsA.filter((word) => wordsB.some((candidate) => candidate.includes(word) || word.includes(candidate)));
  return overlap.length >= 2;
}

export function parseScoreValue(raw) {
  const text = String(raw ?? '').replace(/\*\*/g, '').trim();
  const match = text.match(/([\d.]+)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

export function gradeFromScore(score) {
  const numeric = Number.parseFloat(score);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  if (numeric >= 4.5) return 'A';
  if (numeric >= 4.0) return 'B';
  if (numeric >= 3.5) return 'C';
  if (numeric >= 3.0) return 'D';
  return 'F';
}

export function canonicalStatus(raw) {
  const text = String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase();
  const status = text.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!status) return 'discovered';
  if (status.includes('closed')) return 'closed';
  if (status.includes('duplicate')) return 'duplicate';
  if (status.includes('blocked')) return 'blocked';
  if (status.includes('failed')) return 'failed';
  if (status.includes('applied') || status.includes('aplicad') || status === 'sent') return 'applied';
  if (status.includes('respond')) return 'responded';
  if (status.includes('interview') || status.includes('entrevista')) return 'interview';
  if (status.includes('offer') || status.includes('oferta')) return 'offer';
  if (status.includes('reject') || status.includes('rechaz')) return 'rejected';
  if (status.includes('discard') || status.includes('descart') || status.includes('cerrada') || status.includes('cancelada')) return 'closed';
  if (status.includes('skip') || status.includes('no aplicar') || status.includes('no_aplicar')) return 'skipped';
  if (status.includes('evaluated') || status.includes('evaluada') || status === 'condicional' || status === 'hold' || status === 'monitor' || status === 'evaluar' || status === 'verificar') return 'evaluated';
  if (status === 'applying') return 'applying';
  return status;
}

export function displayStatus(raw) {
  switch (canonicalStatus(raw)) {
    case 'evaluated':
      return 'Evaluated';
    case 'applied':
      return 'Applied';
    case 'responded':
      return 'Responded';
    case 'interview':
      return 'Interview';
    case 'offer':
      return 'Offer';
    case 'rejected':
      return 'Rejected';
    case 'closed':
      return 'Closed';
    case 'duplicate':
      return 'Duplicate';
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Failed';
    case 'applying':
      return 'Applying';
    case 'skipped':
      return 'Skipped';
    default:
      return raw || 'Discovered';
  }
}

function extractReportParts(raw) {
  const text = String(raw ?? '').trim();
  const markdownMatch = text.match(/\[(\d+)\]\(([^)]+)\)/);
  if (markdownMatch) {
    return {
      report_num: markdownMatch[1],
      report_path: markdownMatch[2],
    };
  }

  if (text.endsWith('.md')) {
    return {
      report_num: '',
      report_path: text,
    };
  }

  return { report_num: '', report_path: '' };
}

function extractPdfPath(raw) {
  const text = String(raw ?? '').trim();
  const markdownMatch = text.match(/\]\(([^)]+\.pdf)\)/i);
  if (markdownMatch) return markdownMatch[1];
  if (/\.pdf$/i.test(text)) return text;
  return '';
}

export function parseLegacyApplicationsMarkdown(root = ROOT) {
  const filePath = applicationsLegacyMdPath(root);
  if (!existsSync(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf8');
  const rows = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith('|') || line.includes('| # ') || line.includes('|---')) {
      continue;
    }

    const fields = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((part) => part.trim());

    if (fields.length < 9) continue;

    const applicationId = fields[0];
    if (!/^\d+$/.test(applicationId)) continue;

    const scoreValue = parseScoreValue(fields[4]);
    const report = extractReportParts(fields[7]);

    rows.push({
      application_id: applicationId,
      discovered_at: fields[1],
      updated_at: fields[1],
      company: fields[2],
      position: fields[3],
      url: '',
      source: 'legacy_markdown',
      status: canonicalStatus(fields[5]),
      score: scoreValue ? scoreValue.toFixed(2) : '',
      grade: gradeFromScore(scoreValue),
      details: fields[8] || '',
      report_num: report.report_num,
      report_path: report.report_path,
      custom_resume_path: extractPdfPath(fields[6]),
      application_successful: canonicalStatus(fields[5]) === 'applied' ? 'Y' : '',
      credential_id: '',
      login_identity: '',
      applied_at: '',
      last_error: '',
    });
  }

  return rows;
}

export function readApplications(root = ROOT) {
  const csvPath = applicationsCsvPath(root);
  if (existsSync(csvPath)) {
    return readCsv(csvPath, APPLICATION_HEADERS);
  }
  return parseLegacyApplicationsMarkdown(root);
}

export function nextApplicationId(rows) {
  let maxValue = 0;
  for (const row of rows) {
    const numeric = Number.parseInt(row.application_id, 10);
    if (Number.isFinite(numeric) && numeric > maxValue) {
      maxValue = numeric;
    }
  }
  return String(maxValue + 1);
}

export function findExistingApplication(rows, candidate) {
  const normalizedUrl = normalizeUrl(candidate.url);
  if (normalizedUrl) {
    const byUrl = rows.find((row) => normalizeUrl(row.url) === normalizedUrl);
    if (byUrl) {
      return byUrl;
    }
  }

  const companyKey = normalizeCompany(candidate.company);
  const role = candidate.position || candidate.role || '';
  return rows.find((row) => normalizeCompany(row.company) === companyKey && roleMatch(row.position, role));
}

export function makeApplicationRow(candidate, rows, timestamp) {
  const scoreValue = parseScoreValue(candidate.score);
  return {
    application_id: candidate.application_id || nextApplicationId(rows),
    discovered_at: candidate.discovered_at || candidate.date || timestamp,
    updated_at: candidate.updated_at || timestamp,
    company: candidate.company || '',
    position: candidate.position || candidate.role || '',
    url: candidate.url || '',
    source: candidate.source || '',
    status: canonicalStatus(candidate.status || 'discovered'),
    score: scoreValue ? scoreValue.toFixed(2) : '',
    grade: candidate.grade || gradeFromScore(scoreValue),
    details: candidate.details || candidate.notes || '',
    report_num: candidate.report_num || '',
    report_path: candidate.report_path || '',
    custom_resume_path: candidate.custom_resume_path || candidate.pdf || '',
    application_successful: candidate.application_successful || '',
    credential_id: candidate.credential_id || '',
    login_identity: candidate.login_identity || '',
    applied_at: candidate.applied_at || '',
    last_error: candidate.last_error || '',
  };
}

export async function updateApplications(root = ROOT, mutator) {
  ensureApplicationsCsv(root);
  return updateCsvRows(applicationsCsvPath(root), APPLICATION_HEADERS, mutator);
}

export function writeApplications(root = ROOT, rows) {
  ensureApplicationsCsv(root);
  writeCsv(applicationsCsvPath(root), APPLICATION_HEADERS, rows);
}

export async function replaceApplications(root = ROOT, rows) {
  ensureApplicationsCsv(root);
  return replaceCsvFile(applicationsCsvPath(root), APPLICATION_HEADERS, rows);
}
