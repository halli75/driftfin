# Mode: tracker - Application Tracker

Read and display `data/applications.csv`.

Key columns:
- `application_id`
- `company`
- `position`
- `status`
- `score`
- `grade`
- `report_path`
- `custom_resume_path`
- `application_successful`

Status lifecycle: `discovered` → `evaluated` → `applying` → `applied` / `blocked` / `failed` / `closed` / `duplicate`

If the user asks to update a status, edit the corresponding row in the canonical CSV.

Also show statistics:
- Total applications
- By status
- Average score
- % with tailored CV
- % with generated report
