# Architecture

## System Overview

```text
            AGENTS.md
                |
          Codex session
        /       |       \
 single eval   scan    batch runner
                    batch/batch-runner.mjs
                            |
                      codex exec workers
                            |
         reports/   output/   tracker-additions/
                            |
                  merge-tracker.mjs
                            |
                 data/applications.md
```

## Single Evaluation Flow

1. Codex reads `AGENTS.md`, `modes/_shared.md`, and the selected mode file.
2. The job description is gathered from a URL, pasted text, or a local JD file.
3. The agent evaluates fit, writes a report, generates a PDF when needed, and writes a tracker TSV addition.
4. `merge-tracker.mjs` merges additions into the canonical tracker.

## Batch Flow

1. `batch/batch-runner.mjs` reads `batch/batch-input.tsv`.
2. Each pending offer is assigned a report number and a worker prompt.
3. The runner invokes `codex exec` for each offer.
4. Workers produce:
   - one report in `reports/`
   - one PDF in `output/`
   - one TSV addition in `batch/tracker-additions/`
   - one JSON summary for the runner
5. The runner merges tracker additions and verifies integrity.

## Source Files

- `cv.md` - canonical CV
- `article-digest.md` - proof points
- `config/profile.yml` - candidate identity and targets
- `modes/_profile.md` - user-specific framing
- `portals.yml` - scanner configuration
- `templates/states.yml` - canonical statuses
- `templates/cv-template.html` - PDF template
