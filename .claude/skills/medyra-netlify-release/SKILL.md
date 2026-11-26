---
name: medyra-netlify-release
description: "Validate a Medyra deployment on Netlify: actual branch and environment, database environment, migration compatibility, CI results for the exact commit, health and smoke checks, approval and rollback. Use for preview validation and any release preparation. Never deploys production."
---

# medyra-netlify-release

## Purpose and triggers
Validate a Medyra deployment on Netlify: actual branch and environment, database environment, migration compatibility, CI results for the exact commit, health and smoke checks, approval and rollback. Use for preview validation and any release preparation. Never deploys production.

**Agents:** medyra-devops-engineer, medyra-qa-engineer

**Required inputs:** Commit SHA, deploy URL, intended environment, migration plan.

## Workflow
1. Confirm the deploy URL serves the expected commit and NEXT_PUBLIC_APP_ENV (health endpoint `environment`).
2. Confirm which Supabase project the deploy uses (by project ref in Netlify env names/values the owner provides; never read secrets). The current production-labelled site uses the dev database: treat it as non-production.
3. Check every migration the commit depends on is applied in that environment (dev-migration.yml parity output). If not, the release is blocked.
4. CI must be green for the exact SHA (lint, typecheck, tests, build, secret scan, migration lock).
5. `npm run eng:smoke -- <url> --expect-env <env>` must pass.
6. Production: only via production-release.yml with owner approval, after docs/engineering/RELEASE_POLICY.md prerequisites. Rollback = Netlify 'Publish deploy' of the previous build; database changes are forward-only.

## Medyra invariants
- A successful build is not a healthy release.
- Never change the Netlify production branch or deploy production without written owner approval.
- Not Vercel.

## Validation
`npm run eng:smoke -- <url> --expect-env preview`

## Required evidence
Smoke JSON, CI run URL for the SHA, migration parity output.

## Prohibited
netlify deploy, vercel, editing Netlify settings, production migrations.

## Failure handling
Any failed check: mark the preview gate FAILED, open a maintenance task, do not promote.

## Output contract
Handoff JSON with preview-smoke and migration-compatibility gates.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
