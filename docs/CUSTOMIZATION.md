# Customization Guide

## Personal Data

These files are yours and should hold all personal customization:

- `config/profile.yml`
- `modes/_profile.md`
- `portals.yml`
- `article-digest.md`
- `cv.md`

## What To Edit

- Target roles and personal narrative: `config/profile.yml`
- Archetype-specific framing and negotiation notes: `modes/_profile.md`
- Company list and job filters: `portals.yml`
- Portfolio proof points and metrics: `article-digest.md`
- PDF visual design: `templates/cv-template.html`

## Workflow

Run Codex from the repo root and ask for concrete changes. Keep system logic in `modes/_shared.md` and personal preferences in user-layer files so updates stay safe.

## Statuses

If you need to change workflow states, update:

1. `templates/states.yml`
2. `normalize-statuses.mjs`
3. Any docs or prompts that mention canonical states
