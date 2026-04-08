# Driftfin Roadmap

This is the concrete implementation checklist for the next major steps in Driftfin.

## Phase 1: Stabilize The Core Apply Loop

- [ ] Implement real AgentMail inbox automation.
  - Files: `batch/autosubmit-runner.mjs`, `autosubmit-state.mjs`, `config/profile.example.yml`, `config/profile.yml`
  - Add inbox polling for OTPs and verification links.
  - Add timeout handling and structured failure logging.
  - Persist verification outcomes into `data/apply-log.csv`.

- [ ] Harden autosubmit on real ATS platforms.
  - Files: `batch/autosubmit-prompt.md`, `batch/autosubmit-runner.mjs`, `modes/apply.md`
  - Validate real flows on Greenhouse, Lever, Ashby, and Workday.
  - Record where failures happen: account creation, login, upload, form fill, submit, or confirmation.
  - Add platform-specific notes and fallback behavior.

- [ ] Improve failure handling in the apply engine.
  - Files: `batch/autosubmit-runner.mjs`, `autosubmit-state.mjs`, `applications-store.mjs`
  - Distinguish blocked states from hard failures.
  - Improve handling for CAPTCHA, MFA, email timeouts, file upload failures, and duplicate applications.
  - Make retries bounded and reason-specific instead of generic.

- [ ] Run the Go dashboard end to end against live tracker data.
  - Files: `dashboard/main.go`, `dashboard/internal/data/career.go`, `dashboard/internal/ui/screens/pipeline.go`
  - Verify `applications.csv` and `apply-log.csv` render correctly.
  - Check score, grade, error states, and apply metadata in the UI.
  - Confirm status edits persist correctly.

## Phase 2: Clean Up The Product Surface

- [ ] Clean up the file structure and remove irrelevant leftovers from the original fork.
  - Files/directories to review: `examples/`, `modes/de/`, `modes/fr/`, legacy markdown-tracker tooling, stray docs that still reflect the old product shape
  - Remove files and flows that are no longer part of Driftfin's core mission.
  - Consolidate duplicate docs and outdated prompts.
  - Make the repo layout easier to understand for a new user.

- [ ] Tighten documentation around the actual first-run flow.
  - Files: `README.md`, `docs/SETUP.md`, `docs/CODEX_WORKFLOWS.md`, `AGENTS.md`
  - Make onboarding clearer for profile setup, resume import, batch testing, and autosubmit.
  - Document what is fully automated and what still needs manual intervention.

- [ ] Clean up public project metadata.
  - Files: `package.json`, `CITATION.cff`, GitHub repo About/topics/description
  - Make all public naming and summaries consistently reflect Driftfin.
  - Remove leftover `career-ops` references wherever they are still user-facing.

## Phase 3: Make Discovery And Tracking More Reliable

- [ ] Make the discovery-to-apply flow more deterministic.
  - Files: `modes/scan.md`, `modes/pipeline.md`, `batch/batch-runner.mjs`, `portals.yml`
  - Improve the default scan prompts and role selection behavior.
  - Reduce prompt brittleness for "find N jobs and process them".

- [ ] Strengthen the CSV data model and locking behavior.
  - Files: `csv-store.mjs`, `applications-store.mjs`, `merge-tracker.mjs`, `dedup-tracker.mjs`
  - Stress test concurrent reads and writes.
  - Verify migration, dedupe, and merge behavior under parallel workers.
  - Reassess whether plaintext `data/credentials.csv` should remain the long-term default.

- [ ] Expand validation coverage.
  - Files: `test-all.mjs`, `verify-pipeline.mjs`, `migrate-applications-csv.mjs`
  - Add tests for score-threshold enforcement.
  - Add tests for credential reuse and rotation.
  - Add tests for migration idempotence and lock contention.

## Phase 4: Multi-Backend Support

- [ ] Keep Codex as the primary supported backend.
  - Files: `AGENTS.md`, `docs/CODEX_WORKFLOWS.md`, `package.json`
  - Preserve the current Codex workflow as the reference path.

- [ ] Add OpenCode support as a second backend.
  - Files: backend runner layer, prompt entrypoints, docs, and any CLI-specific wrappers
  - Introduce a backend abstraction for interactive runs and worker execution.
  - Separate backend-specific invocation logic from core evaluation/apply logic.
  - Ensure OpenCode can reuse the same data model, tracker, and autosubmit pipeline.

- [ ] Define backend-specific documentation.
  - Files: `README.md`, `docs/SETUP.md`, new backend docs if needed
  - Document exact setup and run commands for Codex and OpenCode separately.
  - Make the supported/unsupported matrix explicit.

## Phase 5: UX And Quality Of Life

- [ ] Add a guided onboarding flow.
  - Files: onboarding scripts or prompts, `README.md`, `docs/SETUP.md`
  - Make it easier to create `cv.md`, `config/profile.yml`, `modes/_profile.md`, and `portals.yml`.

- [ ] Improve dashboard UX.
  - Files: `dashboard/internal/ui/screens/*`
  - Add clearer views for applied, blocked, failed, and pending roles.
  - Consider optional CSV exports and better filtering.

- [ ] Add platform intelligence and tuning.
  - Files: `batch/autosubmit-runner.mjs`, `data/apply-log.csv` consumers, ATS-specific helpers
  - Use `duration_seconds` to tune timeouts and retries by platform.
  - Add platform-specific heuristics for common form quirks.

## Acceptance Checklist

- [ ] AgentMail works for at least one real email verification flow.
- [ ] One real application succeeds end to end on each major ATS platform.
- [ ] Parallel workers do not corrupt CSV state.
- [ ] The dashboard builds and runs cleanly against real tracker data.
- [ ] Discovery, evaluation, and autosubmit can run on a small batch without manual file edits.
- [ ] Codex support stays stable while OpenCode support is added cleanly.
