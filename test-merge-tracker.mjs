#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { __test__ } from './merge-tracker.mjs';

const { parseAddition } = __test__;

const ROOT = process.cwd();
const REPORTS_DIR = join(ROOT, 'reports');
const tempReport = join(REPORTS_DIR, '999-merge-test-2099-01-01.md');

function run() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(tempReport, [
    '# Evaluation: Test - Role',
    '',
    '**Date:** 2099-01-01',
    '**URL:** https://example.com/job',
    '**PDF:** output/cv-candidate-test-2099-01-01.pdf',
  ].join('\n'), 'utf8');

  const row = parseAddition('001\t2026-04-09\tLeidos\tSoftware Developer Intern\tEvaluated\t4.2/5\toutput/cv-candidate-leidos-2026-04-09.pdf\t[001](reports/001-leidos-2026-04-09.md)\tStrong fit');
  assert.equal(row.status, 'Evaluated', 'status should come from column 5');
  assert.equal(row.score, '4.2/5', 'score should come from column 6');
  assert.equal(row.custom_resume_path, 'output/cv-candidate-leidos-2026-04-09.pdf', 'column 7 should preserve the real PDF path');

  const fallback = parseAddition('999\t2099-01-01\tTest\tRole\tEvaluated\t4.0/5\t📄\t[999](reports/999-merge-test-2099-01-01.md)\tFallback PDF');
  assert.equal(
    fallback.custom_resume_path,
    'output/cv-candidate-test-2099-01-01.pdf',
    'legacy emoji PDF column should fall back to the report header PDF path',
  );

  console.log('merge tracker regression tests passed');
}

try {
  run();
} finally {
  rmSync(tempReport, { force: true });
}
