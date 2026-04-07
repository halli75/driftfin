# Setup Guide

## Prerequisites

- Codex CLI installed and available on `PATH`
- Codex authenticated with an API key
- Node.js 18+
- Playwright Chromium installed

## Setup

```bash
git clone https://github.com/halli75/career-ops-codex.git
cd career-ops
npm install
npx playwright install chromium
```

Create these personal files:

- `config/profile.yml` copied from `config/profile.example.yml`
- `portals.yml` copied from `templates/portals.example.yml`
- `cv.md`
- `modes/_profile.md` from `modes/_profile.template.md` if it does not exist
- optional `article-digest.md`

## Verify

```bash
npm run codex:check
npm run doctor
```

## Start

Run Codex from the repo root:

```bash
codex
```

Then paste a JD URL or ask Codex to process one of the workflows documented in `docs/CODEX_WORKFLOWS.md`.
