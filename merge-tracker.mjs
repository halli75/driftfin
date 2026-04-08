#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  applicationsCsvPath,
  applicationsLegacyMdPath,
  canonicalStatus,
  findExistingApplication,
  gradeFromScore,
  makeApplicationRow,
  parseScoreValue,
  readApplications,
  updateApplications,
} from './applications-store.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const ADDITIONS_DIR = join(CAREER_OPS, 'batch', 'tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const DRY_RUN = process.argv.includes('--dry-run');

const STATUS_RANK = {
  discovered: 0,
  skipped: 0,
  evaluated: 1,
  applying: 2,
  failed: 2,
  blocked: 2,
  applied: 3,
  responded: 4,
  interview: 5,
  offer: 6,
  rejected: 7,
  closed: 7,
  duplicate: 7,
};

function readReportUrl(reportPath) {
  if (!reportPath) return '';
  const fullPath = join(CAREER_OPS, reportPath);
  if (!existsSync(fullPath)) return '';
  const header = readFileSync(fullPath, 'utf8').slice(0, 1000);
  const match = header.match(/^\*\*URL:\*\*\s*(https?:\/\/\S+)/m);
  return match ? match[1] : '';
}

function parseAddition(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('|')) {
    const parts = trimmed.split('|').map((value) => value.trim()).filter(Boolean);
    if (parts.length < 8) return null;
    return {
      application_id: parts[0],
      discovered_at: parts[1],
      company: parts[2],
      position: parts[3],
      score: parts[4],
      status: parts[5],
      custom_resume_path: parts[6],
      report_raw: parts[7],
      details: parts[8] || '',
    };
  }

  const parts = trimmed.split('\t');
  if (parts.length < 8) return null;
  const statusFirst = /\b(evalu|aplic|applied|respond|interview|offer|rechaz|reject|descart|discard|skip|no aplicar|cerrada|closed|blocked|failed)\b/i.test(parts[4]);
  return {
    application_id: parts[0],
    discovered_at: parts[1],
    company: parts[2],
    position: parts[3],
    status: statusFirst ? parts[4] : parts[5],
    score: statusFirst ? parts[5] : parts[4],
    custom_resume_path: parts[6],
    report_raw: parts[7],
    details: parts[8] || '',
  };
}

function extractReportParts(raw) {
  const text = String(raw ?? '').trim();
  const match = text.match(/\[(\d+)\]\(([^)]+)\)/);
  if (match) {
    return { report_num: match[1], report_path: match[2] };
  }
  return { report_num: '', report_path: text.endsWith('.md') ? text : '' };
}

function mergeText(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  return `${a}; ${b}`;
}

function chooseStatus(current, next) {
  const currentKey = canonicalStatus(current);
  const nextKey = canonicalStatus(next);
  return (STATUS_RANK[nextKey] ?? 0) >= (STATUS_RANK[currentKey] ?? 0) ? nextKey : currentKey;
}

function applyAdditions(rows, additions) {
  let added = 0;
  let updated = 0;
  const timestamp = new Date().toISOString();

  for (const addition of additions) {
    const report = extractReportParts(addition.report_raw);
    const score = parseScoreValue(addition.score);
    const candidate = makeApplicationRow({
      application_id: addition.application_id,
      discovered_at: addition.discovered_at,
      updated_at: timestamp,
      company: addition.company,
      position: addition.position,
      url: readReportUrl(report.report_path),
      source: 'evaluation',
      status: canonicalStatus(addition.status || 'evaluated'),
      score,
      grade: gradeFromScore(score),
      details: addition.details,
      report_num: report.report_num,
      report_path: report.report_path,
      custom_resume_path: addition.custom_resume_path,
    }, rows, timestamp);

    const existing = rows.find((row) => (
      (candidate.report_num && row.report_num === candidate.report_num)
      || row.application_id === candidate.application_id
    )) || findExistingApplication(rows, candidate);

    if (!existing) {
      rows.push(candidate);
      added += 1;
      continue;
    }

    const currentScore = parseScoreValue(existing.score);
    existing.updated_at = timestamp;
    existing.status = chooseStatus(existing.status, candidate.status);
    existing.details = mergeText(existing.details, candidate.details);
    if (!existing.url && candidate.url) existing.url = candidate.url;
    if (!existing.report_num && candidate.report_num) existing.report_num = candidate.report_num;
    if (!existing.report_path && candidate.report_path) existing.report_path = candidate.report_path;
    if (!existing.custom_resume_path && candidate.custom_resume_path) existing.custom_resume_path = candidate.custom_resume_path;
    if (score > currentScore) {
      existing.score = score.toFixed(2);
      existing.grade = gradeFromScore(score);
    }
    updated += 1;
  }

  return { rows, added, updated };
}

async function main() {
  if (!existsSync(ADDITIONS_DIR)) {
    console.log('No tracker-additions directory found.');
    return;
  }

  const files = readdirSync(ADDITIONS_DIR).filter((name) => name.endsWith('.tsv'));
  if (files.length === 0) {
    console.log('No pending additions to merge.');
    return;
  }

  const additions = files.map((file) => parseAddition(readFileSync(join(ADDITIONS_DIR, file), 'utf8'))).filter(Boolean);
  const preview = applyAdditions(readApplications(CAREER_OPS).map((row) => ({ ...row })), additions);

  if (!existsSync(applicationsCsvPath(CAREER_OPS)) && existsSync(applicationsLegacyMdPath(CAREER_OPS))) {
    console.log('Warning: applications.csv does not exist yet. This merge will create it without importing legacy markdown history.');
  }

  console.log(`Tracker additions: ${additions.length}`);
  console.log(`Summary: +${preview.added} added, ${preview.updated} updated`);

  if (DRY_RUN) {
    console.log('(dry-run - no changes written)');
    return;
  }

  await updateApplications(CAREER_OPS, (rows) => applyAdditions(rows, additions).rows);
  mkdirSync(MERGED_DIR, { recursive: true });
  for (const file of files) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`Moved ${files.length} TSV files to merged/`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
