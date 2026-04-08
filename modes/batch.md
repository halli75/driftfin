# Mode: batch - Batch Job Processing

This mode covers two paths:

1. **Interactive conductor**: the user navigates portals and Codex accumulates URLs.
2. **Standalone script**: `batch/batch-runner.mjs` processes `batch-input.tsv` with `codex exec` workers.

## Architecture

```text
Codex conductor
  |
  | reads portals or pre-gathered input
  |
  +-> batch-input.tsv
  +-> batch/batch-runner.mjs
         |
         +-> codex exec worker
         +-> codex exec worker
         +-> codex exec worker
                |
                +-> report .md
                +-> PDF
                +-> tracker line TSV
                +-> final JSON
```

## Files

```text
batch/
  batch-input.tsv
  batch-state.tsv
  batch-runner.mjs
  batch-prompt.md
  logs/
  tracker-additions/
```

## Flow

1. Read `batch/batch-state.tsv` to see what has already been processed.
2. For each pending URL:
   - capture or reuse JD
   - reserve `report_num`
   - resolve placeholders in `batch/batch-prompt.md`
   - run a worker with `codex exec`
   - save log and final JSON
   - update `batch-state.tsv`
3. At the end:
   - run `node merge-tracker.mjs`
   - run `node verify-pipeline.mjs`
   - show summary

## Standalone Script

```bash
node batch/batch-runner.mjs [OPTIONS]
```

Options:
- `--dry-run`
- `--retry-failed`
- `--start-from N`
- `--parallel N`
- `--max-retries N`

## State and Resumability

- `batch-state.tsv` is the source of truth for progress and retries.
- If the process dies, it can be re-run and will skip completed postings.
- A lock file prevents double execution of the batch runner.
- Each worker is independent.

## Workers

Each worker receives a resolved prompt from `batch/batch-prompt.md`. It must produce:

1. a report in `reports/`
2. a PDF in `output/`
3. a TSV line in `batch/tracker-additions/`
4. a final JSON that the runner can parse

## Rules

- Use canonical English status labels: `evaluated`, `applied`, `responded`, `interview`, `offer`, `rejected`, `closed`, `skipped`
- Do not edit `data/applications.csv` directly for new rows
- If a posting cannot be verified with a real browser, mark it as unconfirmed instead of assuming it is still open
