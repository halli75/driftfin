# Driftfin

`Driftfin` is an autonomous job discovery, evaluation, and application agent for Codex. It can find roles, evaluate fit, generate tailored resumes, track applications in CSV, and attempt autosubmission through browser automation.

## Current State

- Claude-specific repo wiring has been replaced with Codex-native workflows.
- `data/applications.csv` is the canonical application tracker.
- Batch evaluation runs through `codex exec`.
- Autosubmit is implemented and uses local credential and attempt logs.
- AgentMail is optional and recommended for agent-managed inboxes, but full inbox polling and OTP/link handling are not fully implemented yet.

Treat this repo as a strong prototype, not a fully polished one-click apply system.

## What It Does

- Evaluates job descriptions against your resume, profile, and target roles
- Generates tailored ATS-friendly PDFs with Playwright
- Tracks jobs and outcomes in `data/applications.csv`
- Stores portal credentials separately in `data/credentials.csv`
- Logs every submission attempt in `data/apply-log.csv`
- Scans configured companies and search queries for new roles
- Runs parallel batch evaluation through `codex exec`
- Autosubmits evaluated roles that meet your minimum score threshold

## Setup

Clone and install:

```bash
git clone <your-driftfin-repo-url> driftfin
cd driftfin
npm install
npx playwright install chromium
```

Create or fill in these files before you use the repo:

- `cv.md`: your resume in markdown
- `config/profile.yml`: your identity, links, work authorization, target roles, autosubmit settings, and email-provider config
- `modes/_profile.md`: reusable narrative, framing, and custom application context
- `portals.yml`: search filters, search queries, and tracked companies

Use `config/profile.example.yml` and `modes/_profile.template.md` as templates if needed.

Put only safe personal data in `config/profile.yml`. Do not store SSN, passport numbers, tax IDs, bank data, or credit card information.

Initialize and verify:

```bash
npm run doctor
npm run autosubmit:init
```

## AgentMail Setup

AgentMail is optional but recommended if you want the agent to use a dedicated inbox for account creation and verification flows.

Set your API key in the environment:

```powershell
$env:AGENTMAIL_API_KEY="your_key_here"
```

Then enable it in `config/profile.yml`:

```yml
automation:
  email:
    preferred_provider: "agentmail"
    verification_timeout_seconds: 180
    agentmail:
      enabled: true
      api_key_env: "AGENTMAIL_API_KEY"
      inbox_domain: ""
```

Current limitation: the repo is config-wired to prefer AgentMail, but it does not yet include a dedicated local helper that fully automates inbox polling, OTP extraction, and verification-link handling in every flow.

## How To Run It

Start Codex from the repo root:

```bash
cd <path-to-driftfin>
codex
```

Then give it direct prompts.

Single-job example:

```text
Evaluate this job with Driftfin, generate a tailored resume, and if the score meets my threshold, autosubmit it: <job-url>
```

Find and process multiple jobs:

```text
Find 10 matching internship, new grad, entry-level, or mid-level roles in quant, software engineering, and AI/ML. Add them to the tracker, evaluate them, generate tailored resumes, and autosubmit any role with score >= 4.0.
```

If you want to inspect the repo state without entering Codex:

```bash
npm run doctor
npm run verify
npm run batch -- --dry-run
npm run autosubmit -- --dry-run
```

## Main Workflows

### 1. Single Job

Give Codex one JD URL. It will:

1. evaluate the role
2. generate a report
3. generate a tailored PDF
4. log the role in `data/applications.csv`
5. autosubmit only if the score meets `automation.autosubmit.minimum_score`

### 2. Batch Evaluation

Create `batch/batch-input.tsv`:

```tsv
id	url	source
1	https://example.com/job-1	manual
2	https://example.com/job-2	manual
```

Then run:

```bash
npm run batch -- --dry-run
npm run batch -- --parallel 1
```

This evaluates jobs, writes reports to `reports/`, writes tailored PDFs to `output/`, and merges results into `data/applications.csv`.

### 3. Autosubmit

After jobs are evaluated, run:

```bash
npm run autosubmit -- --dry-run
npm run autosubmit -- --parallel 1
```

Autosubmit only picks rows that:

- are already evaluated
- are still eligible
- meet or exceed `automation.autosubmit.minimum_score`

Default minimum score is `4.0`.

### 4. Legacy Tracker Migration

If you still have `data/applications.md`, preview the migration first:

```bash
npm run migrate:applications
node migrate-applications-csv.mjs --commit
```

The migration defaults to dry-run and preserves the markdown tracker as a legacy file instead of deleting it.

## Data Model

### Canonical Tracker

`data/applications.csv` is the source of truth. It stores one row per job listing and is updated over time.

Important columns include:

- `company`
- `position`
- `url`
- `status`
- `score`
- `grade`
- `report_path`
- `custom_resume_path`
- `application_successful`
- `credential_id`
- `login_identity`
- `applied_at`
- `last_error`

### Status Lifecycle

Main statuses:

- `discovered`
- `evaluated`
- `applying`
- `applied`
- `blocked`
- `failed`
- `duplicate`
- `closed`
- `skipped`

### Credentials and Apply Logs

- `data/credentials.csv`: local credential store for ATS logins; contains raw passwords and must stay local
- `data/apply-log.csv`: append-only submission attempt log, including result and `duration_seconds`

Passwords are intentionally kept out of `data/applications.csv`.

## Repository Layout

- `AGENTS.md`: repo-wide Codex instructions
- `modes/`: workflow-specific instructions
- `batch/`: batch runners, prompts, logs, and state
- `reports/`: evaluation reports
- `output/`: generated PDFs
- `data/`: tracker, credentials, apply logs, scan history
- `templates/`: resume template and status definitions
- `dashboard/`: local tracker UI

## Known Limitations

- Autosubmit is not equally reliable across all ATS platforms.
- CAPTCHA, MFA, some email verification flows, and unusual form logic can block automation.
- Workday accounts often need to be scoped per company tenant.
- AgentMail is only partially integrated today.
- The dashboard was updated for CSV-first tracking, but if your local Go toolchain is missing you will need to install Go to build or run it.

## Useful Commands

```bash
npm run doctor
npm run verify
npm run normalize
npm run dedup
npm run merge
npm run batch -- --dry-run
npm run batch -- --parallel 1
npm run autosubmit:init
npm run autosubmit -- --dry-run
npm run autosubmit -- --parallel 1
npm run migrate:applications
codex
```

## More Docs

- `docs/SETUP.md`
- `docs/ARCHITECTURE.md`
- `docs/CODEX_WORKFLOWS.md`

## Resumen En Espanol

Driftfin para Codex te ayuda a buscar ofertas, evaluarlas, generar CVs adaptados, guardar el pipeline en CSV y ejecutar autosubmit local. El tracker canonico es `data/applications.csv`, las credenciales viven en `data/credentials.csv`, y los intentos de aplicacion viven en `data/apply-log.csv`. AgentMail es opcional y recomendado, pero su automatizacion todavia no esta completa.
