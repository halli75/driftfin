# Codex Workflows

Run Codex from the repo root, then use prompts like these.

## Evaluate One Job

`Evaluate this JD URL with career-ops and run the full pipeline: <url>`

## Evaluate Pasted JD Text

`Evaluate this JD with career-ops and produce a report plus tailored PDF: <paste jd>`

## PDF Only

`Use career-ops PDF mode for this JD URL and generate a tailored resume PDF only: <url>`

## Compare Offers

`Compare these offers with career-ops and rank them: <url or jd list>`

## Tracker Review

`Summarize my current application tracker and flag the highest-priority next actions.`

## Process Inbox

`Process the pending URLs in data/pipeline.md using the career-ops pipeline workflow.`

## Scan Portals

`Use the career-ops scan workflow and append any new high-fit roles to my pipeline.`

## Batch Dry Run

```bash
npm run batch -- --dry-run
```

## Batch Run

```bash
npm run batch -- --parallel 2
```
