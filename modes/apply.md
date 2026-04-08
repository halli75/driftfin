# Mode: apply - Live Apply And Autosubmit

Use this mode when the goal is to complete an application form, not just evaluate the job.

There are two valid operating modes:

1. **Interactive assist**
   - The user has the form open.
   - Read the page, identify the role, load the matching report, and generate answers or field values.

2. **Autosubmit**
   - `config/profile.yml` has autosubmit enabled.
   - Read the page, sign in or create an account, fill the form, and submit without a last-step approval prompt.

## Required context

- Job page URL and visible form
- Matching report in `reports/`
- `config/profile.yml`
- `modes/_profile.md`
- `cv.md`
- `autosubmit-state.mjs` for credential reuse and apply logging
- `data/applications.csv` as the canonical application tracker

## Workflow

1. Detect the company, role, platform, and current page state.
2. Find the matching report and confirm the role is still the same.
3. Verify the role is still open and has a real apply path.
4. In autosubmit mode, initialize local state with `node autosubmit-state.mjs init`.
5. Detect the ATS platform and tenant key.
6. Fetch credentials with `node autosubmit-state.mjs get-or-create ...`.
7. Sign in or create the account.
8. If stored credentials fail:
   - call `record-failure`
   - call `rotate`
   - retry once with the new credential
9. If a safe missing identity field appears, ask once, then save it in `config/profile.yml`.
10. If AgentMail is configured and email verification appears, use it before blocking.
11. Fill every required field from the profile, CV, report, and generated answers.
12. Upload the tailored PDF if required.
13. Submit the application.
14. On success, call `record-success`.

## Manual gates

If the flow hits CAPTCHA or MFA:

- stop the application
- do not submit partial data
- log it as blocked in `data/apply-log.csv`
- leave the tracker status unchanged

## Workday rule

Treat Workday credentials as company-specific.

- Reuse only when the same company tenant already exists in `data/credentials.csv`
- Never assume one Workday account works across different companies

## Output

Interactive assist:
- return copy-paste answers and any warnings

Autosubmit:
- perform the submission
- log the attempt
- update tracker notes
- return a short summary with platform, credential action, and outcome
