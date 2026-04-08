# Codex Workflows

Run Codex from the repo root, then use prompts like these.

## Evaluate One Job

`Evaluate this JD URL with Driftfin and run the full pipeline: <url>`

## Evaluate Pasted JD Text

`Evaluate this JD with Driftfin and produce a report plus tailored PDF: <paste jd>`

## PDF Only

`Use the Driftfin PDF workflow for this JD URL and generate a tailored resume PDF only: <url>`

## Compare Offers

`Compare these offers with Driftfin and rank them: <url or jd list>`

## Tracker Review

`Summarize my current application tracker and flag the highest-priority next actions.`

## Process Inbox

`Process the pending URLs in data/pipeline.md using the Driftfin pipeline workflow.`

## Scan Portals

`Use the Driftfin scan workflow and append any new high-fit roles to my pipeline.`

## One-Off Autosubmit

`Use the Driftfin apply workflow for this job page and autosubmit it using my saved profile and credential ledger.`

## Batch Dry Run

```bash
npm run batch -- --dry-run
```

## Batch Run

```bash
npm run batch -- --parallel 2
```

## Autosubmit Dry Run

```bash
npm run autosubmit -- --dry-run
```

## Autosubmit Run

```bash
npm run autosubmit -- --parallel 1
```
