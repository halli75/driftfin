# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `config/profile.yml` | Your identity, targets, comp range |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/applications.csv` | Your canonical application tracker |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/credentials.csv` | Your local portal credentials ledger |
| `data/apply-log.csv` | Your autosubmit attempt log |
| `data/agentmail-state.json` | Your local shared AgentMail inbox state |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/evaluate.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/outreach.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/compare.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `AGENTS.md` | Agent instructions |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.mjs` | Batch orchestrator |
| `batch/autosubmit-prompt.md` | Autosubmit worker prompt |
| `batch/autosubmit-runner.mjs` | Autosubmit orchestrator |
| `autosubmit-state.mjs` | Credential store and autosubmit logging utilities |
| `agentmail-state.mjs` | AgentMail inbox lifecycle and verification polling CLI |
| `agentmail-client.mjs` | AgentMail SDK wrapper and state manager |
| `profile-config.mjs` | Shared profile and email automation config loader |
| `applications-store.mjs` | Application CSV store and legacy parsing helpers |
| `csv-store.mjs` | Locked CSV read/write helpers |
| `migrate-applications-csv.mjs` | Explicit markdown-to-CSV migration tool |
| `dashboard/*` | Go TUI dashboard |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
