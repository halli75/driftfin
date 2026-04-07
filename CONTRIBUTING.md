# Contributing

Career-Ops is maintained as a Codex-first repository. Keep the repo usable from the command line on Windows and Unix-like systems.

## Local Workflow

1. Fork the repo.
2. Clone your fork.
3. Install dependencies with `npm install`.
4. Install Playwright Chromium with `npx playwright install chromium`.
5. Run `npm run doctor`.
6. Run Codex from the repo root when testing agent workflows.

## Rules

- Preserve the user/system split defined in `DATA_CONTRACT.md`.
- Do not put personal data into system files.
- Never auto-submit applications.
- Keep prompt files vendor-neutral unless they are intentionally Codex-specific.
- Prefer small, reviewable changes.
- Update docs and tests when you change workflow assumptions.

## Validation

Before opening a PR, run:

```bash
npm run test:all
npm run verify
```
