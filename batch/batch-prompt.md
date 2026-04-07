# career-ops Batch Worker

You are processing one job offer inside the `career-ops` repository.

Complete the full pipeline for this offer:

1. Evaluate the role
2. Write the report markdown
3. Generate the tailored PDF
4. Write one tracker TSV addition
5. Output a final JSON object only in your last message

This worker runs inside the repo root. Read local files directly.

## Required source files

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `modes/_shared.md`
- `article-digest.md` if present
- `templates/cv-template.html`
- `templates/states.yml`
- `generate-pdf.mjs`

Never invent metrics. Read them from the source files at runtime.

## Placeholders

- `{{URL}}`
- `{{JD_FILE}}`
- `{{REPORT_NUM}}`
- `{{DATE}}`
- `{{ID}}`

## Workflow

### 1. Gather the JD

- Read `{{JD_FILE}}`
- If it is empty, use `{{URL}}` as the source of truth and gather the job description from the live page
- If you cannot gather enough information to evaluate, fail explicitly

### 2. Evaluate the role

- Detect company, title, archetype, seniority, remote policy, and strongest fit signals
- Compare the JD against `cv.md`, `modes/_profile.md`, and `article-digest.md`
- Identify gaps and say whether each gap is a blocker or mitigable
- Estimate compensation only if you can verify it; otherwise say it is unverified
- Write a global score from `1.0` to `5.0`

### 3. Save the report

Write the report to:

```text
reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md
```

Required header:

```markdown
# Evaluation: {Company} - {Role}

**Date:** {{DATE}}
**Archetype:** {detected}
**Score:** {X.X/5}
**URL:** {{URL}}
**PDF:** output/cv-candidate-{company-slug}-{{DATE}}.pdf
**Batch ID:** {{ID}}
```

Required sections:

- `## A) Role Summary`
- `## B) CV Match`
- `## C) Level and Strategy`
- `## D) Compensation and Demand`
- `## E) Customization Plan`
- `## F) Interview Plan`
- `## Extracted Keywords`

### 4. Generate the PDF

- Tailor the CV to the JD without inventing experience
- Extract 15-20 keywords from the JD
- Reuse `templates/cv-template.html`
- Write temporary HTML if needed
- Run `node generate-pdf.mjs ...`
- Save the PDF to:

```text
output/cv-candidate-{company-slug}-{{DATE}}.pdf
```

### 5. Write the tracker line

Write one TSV line to:

```text
batch/tracker-additions/{{ID}}.tsv
```

Format:

```text
{num}\t{{DATE}}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{{REPORT_NUM}}](reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md)\t{note}
```

Rules:

- Use canonical English statuses from `templates/states.yml`
- For a completed evaluation, default to `Evaluated`
- Do not edit `data/applications.md` directly

## Failure Handling

If any step fails, still return a final JSON object with `status: "failed"` and a concrete `error` message.

## Final Output

Your final message must be valid JSON and nothing else.

Success shape:

```json
{
  "status": "completed",
  "id": "{{ID}}",
  "report_num": "{{REPORT_NUM}}",
  "company": "{company}",
  "role": "{role}",
  "score": 4.2,
  "pdf": "output/cv-candidate-{company-slug}-{{DATE}}.pdf",
  "report": "reports/{{REPORT_NUM}}-{company-slug}-{{DATE}}.md",
  "error": null
}
```

Failure shape:

```json
{
  "status": "failed",
  "id": "{{ID}}",
  "report_num": "{{REPORT_NUM}}",
  "company": "{company-or-unknown}",
  "role": "{role-or-unknown}",
  "score": null,
  "pdf": null,
  "report": null,
  "error": "{reason}"
}
```
