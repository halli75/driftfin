# Setup Guide

## Prerequisites

- Codex CLI installed and available on `PATH`
- Codex authenticated with an API key
- Node.js 18+
- Playwright Chromium installed

## Setup

```bash
git clone <your-driftfin-repo-url> driftfin
cd driftfin
npm install
npx playwright install chromium
```

Create these personal files:

- `config/profile.yml` copied from `config/profile.example.yml`
- `portals.yml` copied from `templates/portals.example.yml`
- `cv.md`
- `modes/_profile.md` from `modes/_profile.template.md` if it does not exist
- optional `article-digest.md`

If you plan to use autosubmit, the first run will also create:

- `data/credentials.csv`
- `data/apply-log.csv`
- `data/agentmail-state.json` when AgentMail is enabled

## Verify

```bash
npm run codex:check
npm run doctor
npm run agentmail:status
```

## Start

Run Codex from the repo root:

```bash
codex
```

Then paste a JD URL or ask Codex to process one of the workflows documented in `docs/CODEX_WORKFLOWS.md`.

## Autosubmit

Initialize the local credential and apply logs:

```bash
npm run autosubmit:init
```

Preview the evaluated roles that are eligible for autosubmit:

```bash
npm run autosubmit -- --dry-run
```

## AgentMail

If you want email verification handled automatically, set:

```powershell
$env:AGENTMAIL_API_KEY="your_key_here"
```

Then enable AgentMail in `config/profile.yml` and verify it:

```bash
npm run agentmail:status
```
