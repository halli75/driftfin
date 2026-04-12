#!/usr/bin/env node

/**
 * generate-pdf.mjs - HTML to PDF via Playwright
 *
 * Usage:
 *   node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: playwright installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 * If the environment blocks browser launch, falls back to a simple ATS-safe text PDF.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Normalize text for ATS compatibility by converting problematic Unicode.
 *
 * ATS parsers and legacy systems often fail on em-dashes, smart quotes,
 * zero-width characters, and non-breaking spaces. These cause mojibake,
 * parsing errors, or display issues.
 *
 * Only touches body text - preserves CSS, JS, tag attributes, and URLs.
 * Returns { html, replacements } so the caller can log what was changed.
 */
function normalizeTextForATS(html) {
  const replacements = {};
  const bump = (key, n) => { replacements[key] = (replacements[key] || 0) + n; };

  const masks = [];
  const masked = html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `\u0000MASK${masks.length}\u0000`;
      masks.push(match);
      return token;
    }
  );

  let out = '';
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf('<', i);
    if (lt === -1) {
      out += sanitizeText(masked.slice(i));
      break;
    }
    out += sanitizeText(masked.slice(i, lt));
    const gt = masked.indexOf('>', lt);
    if (gt === -1) {
      out += masked.slice(lt);
      break;
    }
    out += masked.slice(lt, gt + 1);
    i = gt + 1;
  }

  const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
  return { html: restored, replacements };

  function sanitizeText(text) {
    if (!text) return text;
    let t = text;
    t = t.replace(/\u2014/g, () => { bump('em-dash', 1); return '-'; });
    t = t.replace(/\u2013/g, () => { bump('en-dash', 1); return '-'; });
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, () => { bump('smart-double-quote', 1); return '"'; });
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, () => { bump('smart-single-quote', 1); return "'"; });
    t = t.replace(/\u2026/g, () => { bump('ellipsis', 1); return '...'; });
    t = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, () => { bump('zero-width', 1); return ''; });
    t = t.replace(/\u00A0/g, () => { bump('nbsp', 1); return ' '; });
    return t;
  }
}

function decodeHtmlEntities(text) {
  if (!text) return text;

  const named = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
    ['nbsp', ' '],
  ]);

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (named.has(lower)) return named.get(lower);
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return match;
  });
}

function extractPlainTextFromHtml(html) {
  const blockBreaks = [
    'br', '/div', '/p', '/section', '/article', '/header', '/footer', '/main',
    '/h1', '/h2', '/h3', '/h4', '/h5', '/h6', '/ul', '/ol', '/li', '/title'
  ];

  let text = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`<(${blockBreaks.join('|')})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeHtmlEntities(text);
  text = text.replace(/\r/g, '');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n[ \t]+/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .reduce((acc, line) => {
      if (!line) {
        if (acc[acc.length - 1] !== '') acc.push('');
        return acc;
      }
      acc.push(line);
      return acc;
    }, []);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function wrapParagraph(text, maxChars) {
  if (!text) return [''];

  const bullet = text.startsWith('- ');
  const firstPrefix = bullet ? '- ' : '';
  const restPrefix = bullet ? '  ' : '';
  const content = bullet ? text.slice(2).trim() : text;
  const words = content.split(/\s+/).filter(Boolean);

  if (words.length === 0) return [firstPrefix.trimEnd()];

  const lines = [];
  let prefix = firstPrefix;
  let currentWords = [];

  for (const word of words) {
    const candidate = `${prefix}${currentWords.length ? `${currentWords.join(' ')} ` : ''}${word}`;
    if (candidate.length <= maxChars || currentWords.length === 0) {
      currentWords.push(word);
      continue;
    }

    lines.push(`${prefix}${currentWords.join(' ')}`);
    prefix = restPrefix;
    currentWords = [word];
  }

  if (currentWords.length > 0) {
    lines.push(`${prefix}${currentWords.join(' ')}`);
  }

  return lines;
}

function escapePdfText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function createSimplePdfBuffer(lines, format) {
  const pageSize = format === 'letter'
    ? { width: 612, height: 792 }
    : { width: 595, height: 842 };

  const margin = 43.2;
  const fontSize = 10;
  const leading = 13;
  const usableWidth = pageSize.width - (margin * 2);
  const maxChars = Math.max(60, Math.floor(usableWidth / 6));
  const linesPerPage = Math.max(20, Math.floor((pageSize.height - (margin * 2)) / leading));

  const wrapped = [];
  for (const paragraph of lines) {
    if (paragraph === '') {
      if (wrapped[wrapped.length - 1] !== '') wrapped.push('');
      continue;
    }
    wrapped.push(...wrapParagraph(paragraph, maxChars));
  }

  const pages = [];
  for (let i = 0; i < wrapped.length; i += linesPerPage) {
    pages.push(wrapped.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  const objects = [null];
  const pageObjectNumbers = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = 'PAGES_PLACEHOLDER';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>';

  let nextObjectNumber = 4;
  for (const pageLines of pages) {
    const pageObjectNumber = nextObjectNumber++;
    const contentObjectNumber = nextObjectNumber++;
    pageObjectNumbers.push(pageObjectNumber);

    const contentLines = [
      'BT',
      `/F1 ${fontSize} Tf`,
      `${leading} TL`,
      `${margin} ${pageSize.height - margin - fontSize} Td`,
      ...pageLines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
      'ET',
    ];
    const stream = contentLines.join('\n');

    objects[pageObjectNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageSize.width} ${pageSize.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber] = `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`;
  }

  objects[2] = `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] >>`;

  let pdf = '%PDF-1.4\n%AAAA\n';
  const offsets = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return {
    buffer: Buffer.from(pdf, 'utf8'),
    pageCount: pageObjectNumbers.length,
  };
}

async function generateFallbackPDF(html, outputPath, format) {
  const { writeFile } = await import('fs/promises');
  const text = extractPlainTextFromHtml(html);
  const paragraphs = text.split('\n');
  const { buffer, pageCount } = createSimplePdfBuffer(paragraphs, format);

  await writeFile(outputPath, buffer);

  console.log('Fallback PDF generated because Playwright launch was blocked.');
  console.log(`PDF generated: ${outputPath}`);
  console.log(`Pages: ${pageCount}`);
  console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);

  return { outputPath, pageCount, size: buffer.length, fallback: true };
}

async function generatePDF() {
  const args = process.argv.slice(2);

  let inputPath;
  let outputPath;
  let format = 'a4';

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]');
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Format: ${format.toUpperCase()}`);

  let html = await readFile(inputPath, 'utf-8');

  const fontsDir = resolve(__dirname, 'fonts');
  html = html.replace(
    /url\(['"]?\.\/fonts\//g,
    `url('file://${fontsDir}/`
  );
  html = html.replace(
    /file:\/\/([^'")]+)\.woff2['"]\)/g,
    `file://$1.woff2')`
  );

  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'networkidle',
      baseURL: `file://${dirname(inputPath)}/`,
    });

    await page.evaluate(() => document.fonts.ready);

    const pdfBuffer = await page.pdf({
      format: format,
      printBackground: true,
      margin: {
        top: '0.6in',
        right: '0.6in',
        bottom: '0.6in',
        left: '0.6in',
      },
      preferCSSPageSize: false,
    });

    const { writeFile } = await import('fs/promises');
    await writeFile(outputPath, pdfBuffer);

    const pdfString = pdfBuffer.toString('latin1');
    const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

    await browser.close();

    console.log(`PDF generated: ${outputPath}`);
    console.log(`Pages: ${pageCount}`);
    console.log(`Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    return { outputPath, pageCount, size: pdfBuffer.length };
  } catch (err) {
    const message = typeof err?.message === 'string' ? err.message : String(err);
    if (!/spawn EPERM|browserType\.launch/i.test(message)) throw err;
    return generateFallbackPDF(html, outputPath, format);
  }
}

generatePDF().catch((err) => {
  console.error('PDF generation failed:', err.message);
  process.exit(1);
});
