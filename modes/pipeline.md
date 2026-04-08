# Mode: pipeline - Inbox Of Job URLs

Process pending URLs from `data/pipeline.md`.

## Workflow

1. Read unchecked items from the `Pending` section.
2. For each pending URL:
   - fetch and verify the JD
   - run the full evaluation flow
   - write the report
   - generate the tailored PDF when applicable
   - write the tracker TSV addition, then merge it into `data/applications.csv`
3. If autosubmit is enabled in `config/profile.yml` and the result is not `SKIP`, immediately run the `apply` workflow for that role.
4. Move each processed URL to `Processed` with the report number and score.
5. At the end, summarize:
   - evaluated roles
   - submitted roles
   - blocked roles
   - failed roles

## Autosubmit notes

When autosubmit is enabled:

- initialize state with `node autosubmit-state.mjs init`
- if AgentMail is enabled, verify it with `node agentmail-state.mjs status`
- submit only rows whose score is at or above `automation.autosubmit.minimum_score`
- reuse or create credentials through `data/credentials.csv`
- log every submission attempt in `data/apply-log.csv`
- leave manual-gate cases blocked instead of forcing the submission

## Special cases

- If the URL is not accessible, mark it as `[!]` and continue.
- If the page requires a login just to read the JD, mark it blocked unless the user already provided the JD text.
- If there are 3 or more pending URLs, parallelize only the evaluation steps. Do not run multiple browser-heavy submission flows in parallel against the same ATS tenant.
