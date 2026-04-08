# Driftfin

## Data Contract

There are two layers in this repo.

**User Layer (never auto-updated):**
- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `article-digest.md`
- `portals.yml`
- `data/*`
- `reports/*`
- `output/*`
- `interview-prep/*`
- `jds/*`

**System Layer (safe to update):**
- `AGENTS.md`
- `modes/_shared.md`
- `modes/*.md`
- `modes/de/*`
- `modes/fr/*`
- `*.mjs`
- `batch/*`
- `templates/*`
- `fonts/*`
- `dashboard/*`
- `docs/*`
- `README.md`
- `CONTRIBUTING.md`
- `DATA_CONTRACT.md`
- `LICENSE`
- `VERSION`
- `package.json`
- `.github/*`

Rule: when the user asks to personalize Driftfin targets, narrative, negotiation posture, filters, or proof points, write to `config/profile.yml`, `modes/_profile.md`, `portals.yml`, or `article-digest.md`. Do not put user-specific content into system files.

## Update Check

At session start, silently run:

```bash
node update-system.mjs check
```

If it returns `update-available`, tell the user the version delta and that user data will not be touched. Only run `node update-system.mjs apply` after the user confirms.

## First Run

Before any evaluation or scan, confirm these files exist:
- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `portals.yml`

If `modes/_profile.md` is missing, create it from `modes/_profile.template.md`.

If any required file is missing, switch to onboarding instead of evaluating jobs.

## Onboarding

Work in this order:

1. Create `cv.md` from the user's resume, LinkedIn, or dictated background.
2. Ensure `config/profile.yml` contains identity, location, target roles, and comp targets.
3. Create `portals.yml` from `templates/portals.example.yml` and customize role filters.
4. If `data/applications.csv` is missing, create the tracker CSV.
5. Ask for higher-signal personalization: superpowers, deal-breakers, best achievement, published work, and preferred role types.

Store user-specific learnings in user-layer files so later system updates do not overwrite them.

## Mode Routing

Choose a mode from the user's request:

| User intent | Mode file |
|---|---|
| Paste JD text or JD URL | `modes/auto-pipeline.md` |
| Evaluate one offer | `modes/oferta.md` |
| Compare offers | `modes/ofertas.md` |
| Deep company research | `modes/deep.md` |
| Generate tailored PDF | `modes/pdf.md` |
| Outreach/contact plan | `modes/contacto.md` |
| Application assistant or autosubmit | `modes/apply.md` |
| Portal scan | `modes/scan.md` |
| Process inbox URLs | `modes/pipeline.md` |
| Batch processing | `modes/batch.md` |
| Tracker/status review | `modes/tracker.md` |
| Training/cert evaluation | `modes/training.md` |
| Project evaluation | `modes/project.md` |

For most evaluation flows, read `modes/_shared.md` first and then the selected mode file.

## Personalization

This system is designed to be customized in-place.

Common changes:
- target archetypes and framing: `modes/_profile.md`
- role filters and companies: `portals.yml`
- personal narrative and compensation targets: `config/profile.yml`
- proof points and metrics: `article-digest.md`
- CV visual layout: `templates/cv-template.html`

## Ethical Use

- Autosubmit is opt-in and controlled from `config/profile.yml`.
- If autosubmit is enabled, do not wait for a final human confirmation before submitting.
- Do not fabricate experience, metrics, dates, qualifications, or application answers.
- For normal evaluation flows, strongly discourage low-fit applications below `4.0/5`.
- In autosubmit mode, only submit rows whose `score` is greater than or equal to `automation.autosubmit.minimum_score` in `config/profile.yml`.
- Prefer AgentMail for new ATS accounts and email verification when it is configured. Otherwise fall back to the candidate email.
- Stop for CAPTCHA, MFA, or similar hard manual gates. Log the blocker and leave the tracker status unchanged.

## Offer Verification

Never trust a search result alone to decide a role is open.

Preferred path:
1. Open the job page in a real browser.
2. Confirm the page still contains title, description, and an apply path.
3. If the page only shows shell layout, archive notice, or footer/nav, treat it as closed or unconfirmed.

If browser automation is unavailable in a specific workflow, mark verification as unconfirmed instead of pretending the listing is live.

## Pipeline Integrity

Rules:
- `data/applications.csv` is the canonical tracker.
- Write one TSV addition per evaluation into `batch/tracker-additions/`.
- `merge-tracker.mjs` performs the merge into `data/applications.csv`.
- Use `migrate-applications-csv.mjs --dry-run` before any legacy markdown migration.
- Every report must include `**URL:**` in the header.

## TSV Format

Write tracker additions as one tab-separated line with 9 columns:

```text
num	date	company	role	status	score	pdf	report	notes
```

The required order is:
1. `num`
2. `date`
3. `company`
4. `role`
5. `status`
6. `score`
7. `pdf`
8. `report`
9. `notes`

Status must use canonical labels from `templates/states.yml`.

## Canonical States

CSV lifecycle states:
- `discovered`
- `evaluated`
- `applying`
- `applied`
- `blocked`
- `failed`
- `duplicate`
- `closed`
- `skipped`
- `responded`
- `interview`
- `offer`
- `rejected`

No markdown, no dates, and no extra commentary in the status field.

## Operating Rules

- Read `cv.md`, `config/profile.yml`, `modes/_profile.md`, and `article-digest.md` when relevant.
- Before any autosubmit run, initialize `data/applications.csv`, `data/credentials.csv`, and `data/apply-log.csv` with `node autosubmit-state.mjs init`.
- Use `data/credentials.csv` as the local credential ledger and `data/apply-log.csv` as the local submission log.
- `data/applications.csv` must include `score` and `grade`; evaluation updates both.
- Do not hardcode proof-point metrics. Read them from source files at evaluation time.
- Generate candidate-facing output in the language of the JD unless the user says otherwise.
- Keep writing direct and concrete.
- Run `node cv-sync-check.mjs` on the first evaluation of a session.
- After any batch evaluation pass, run `node merge-tracker.mjs`.
