# Career-Ops for Codex

AI-powered job search operations for Codex. Evaluate roles, generate tailored PDFs, scan portals, and keep a structured application tracker on your machine.

## What It Does

- Evaluates job descriptions against your CV and target roles
- Generates tailored ATS-friendly PDFs with Playwright
- Tracks offers, reports, and application state in local files
- Scans configured portals for new roles
- Runs batch evaluation through `codex exec`

## Quick Start

```bash
git clone https://github.com/halli75/career-ops-codex.git
cd career-ops
npm install
npx playwright install chromium
codex
```

Then copy `config/profile.example.yml` to `config/profile.yml`, copy `templates/portals.example.yml` to `portals.yml`, create `cv.md`, and ask Codex to evaluate a JD URL or pasted job description.

## Common Workflows

- Evaluate one job: start Codex in the repo root and paste a JD URL
- Generate a PDF only: ask Codex to run the PDF workflow for a specific JD
- Process inbox URLs: ask Codex to process `data/pipeline.md`
- Batch process: `npm run batch -- --dry-run`
- Validate pipeline: `npm run verify`

Detailed prompt recipes live in `docs/CODEX_WORKFLOWS.md`.

## Required Personal Files

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `portals.yml`

If `modes/_profile.md` is missing, create it from `modes/_profile.template.md`.

## Repo Structure

- `modes/` - workflow instructions
- `batch/` - batch runner, worker prompt, state, logs
- `templates/` - CV template and canonical states
- `reports/` - evaluation reports
- `output/` - generated PDFs
- `data/` - tracker, pipeline inbox, scan history

## Resumen en Espanol

Career-Ops para Codex te ayuda a evaluar ofertas, generar CVs adaptados, escanear portales y mantener tu pipeline local con una CLI de Codex. La logica principal sigue en `modes/*`, los datos personales siguen fuera de los archivos del sistema, y el procesamiento por lotes usa `codex exec`.
