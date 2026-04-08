#!/usr/bin/env node

import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import lockfile from 'proper-lockfile';

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function ensureCsvFile(filePath, headers) {
  ensureParentDir(filePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${headers.join(',')}\n`, 'utf8');
  }
}

export function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === ',') {
      values.push(current);
      current = '';
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function readCsv(filePath, headers) {
  ensureCsvFile(filePath, headers);
  const raw = readFileSync(filePath, 'utf8').trimEnd();
  if (!raw) {
    return [];
  }

  const lines = raw.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const rows = [];

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] ?? '';
    }
    for (const column of headers) {
      if (!(column in row)) {
        row[column] = '';
      }
    }
    rows.push(row);
  }

  return rows;
}

export function writeCsv(filePath, headers, rows) {
  ensureCsvFile(filePath, headers);
  const content = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')),
  ].join('\n');
  const tempPath = join(dirname(filePath), `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(tempPath, `${content}\n`, 'utf8');
  renameSync(tempPath, filePath);
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

export async function withCsvLock(filePath, headers, callback) {
  ensureCsvFile(filePath, headers);
  const release = await lockfile.lock(filePath, lockOptions());
  try {
    return await callback();
  } finally {
    await release();
  }
}

export async function updateCsvRows(filePath, headers, mutator) {
  return withCsvLock(filePath, headers, async () => {
    const draft = readCsv(filePath, headers).map((row) => ({ ...row }));
    const result = await mutator(draft);
    const nextRows = Array.isArray(result) ? result : draft;
    writeCsv(filePath, headers, nextRows);
    return nextRows;
  });
}

export async function appendCsvRow(filePath, headers, row) {
  return updateCsvRows(filePath, headers, (rows) => {
    rows.push(row);
    return rows;
  });
}

export async function replaceCsvFile(filePath, headers, rows) {
  return withCsvLock(filePath, headers, async () => {
    writeCsv(filePath, headers, rows);
    return rows;
  });
}

export function safeUnlink(filePath) {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
