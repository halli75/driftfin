# Mode: auto-pipeline - Evaluate, Generate, Then Apply

When the user pastes a JD URL or raw JD text without a sub-command, run the full pipeline.

## Default sequence

1. Extract the JD from the URL or pasted text.
2. Run the A-F evaluation from `modes/oferta.md`.
3. Save the report in `reports/`.
4. Generate the tailored PDF through `modes/pdf.md`.
5. Write the tracker TSV addition and merge it into `data/applications.csv`.

## Autosubmit extension

If autosubmit is enabled in `config/profile.yml` and the final state is not `SKIP`:

1. Initialize local state with `node autosubmit-state.mjs init`.
2. Run the `apply` workflow immediately after the PDF step.
3. Reuse or create credentials in `data/credentials.csv`.
4. Log the outcome in `data/apply-log.csv`.
5. Update the tracker note with the submission outcome.
6. Respect `automation.autosubmit.minimum_score` before submitting.

## Failure handling

- If JD extraction fails, ask for pasted text or a screenshot.
- If the application flow hits CAPTCHA or MFA, stop the submit step, log it as blocked, and keep the evaluation output.
- If email verification appears and AgentMail is configured, use it before giving up.
- If the role is closed, write the report and tracker entry but do not attempt submission.
