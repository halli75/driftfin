# Architecture

## System Overview

```text
            AGENTS.md
                |
          Codex session
        /       |         |          \
single eval   scan    batch eval   autosubmit
                      batch/batch-runner.mjs   batch/autosubmit-runner.mjs
                              |                 |
                        codex exec workers  codex exec workers
                              |                 |
         reports/   output/   tracker-additions/   data/credentials.csv
                              |                 |
                        merge-tracker.mjs   data/apply-log.csv
                              |                 |
                         data/applications.csv  agentmail-state.mjs
                                                |
                                          data/agentmail-state.json
                                                |
                                          dashboard summary
```

## Single Evaluation Flow

1. Codex reads `AGENTS.md`, `modes/_shared.md`, and the selected mode file.
2. The job description is gathered from a URL, pasted text, or a local JD file.
3. The agent evaluates fit, writes a report, generates a PDF when needed, and writes a tracker TSV addition.
4. `merge-tracker.mjs` merges additions into the canonical CSV tracker.

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

## Autosubmit Flow

1. `batch/autosubmit-runner.mjs` reads evaluated tracker entries.
2. Each worker loads the report, verifies the job is still open, and uses `autosubmit-state.mjs`.
3. Credentials are reused or rotated through `data/credentials.csv`.
4. If AgentMail is enabled, `agentmail-state.mjs` creates or reuses one shared inbox and polls it for verification links or OTPs.
5. Each attempt is written to `data/apply-log.csv`.
6. Tracker notes and statuses are updated based on the autosubmit outcome.

## Source Files

- `cv.md` - canonical CV
- `article-digest.md` - proof points
- `config/profile.yml` - candidate identity and targets
- `data/credentials.csv` - local ATS credential ledger
- `data/apply-log.csv` - autosubmit outcome log
- `data/agentmail-state.json` - shared inbox metadata and poll cursor
- `modes/_profile.md` - user-specific framing
- `portals.yml` - scanner configuration
- `templates/states.yml` - canonical statuses
- `templates/cv-template.html` - PDF template
