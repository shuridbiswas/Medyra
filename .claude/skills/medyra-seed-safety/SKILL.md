---
name: medyra-seed-safety
description: "Rules for Medyra development data: the seed, wipe, reset and migrate scripts touch a hosted database with a privileged token and are human-only. Use whenever a task mentions seed data, test accounts or the dev database."
---

# medyra-seed-safety

## Purpose and triggers
Rules for Medyra development data: the seed, wipe, reset and migrate scripts touch a hosted database with a privileged token and are human-only. Use whenever a task mentions seed data, test accounts or the dev database.

**Agents:** all medyra-* agents

**Required inputs:** SEEDING.md, TEST_ACCOUNTS.md (read only).

## Workflow
1. Agents never run npm run seed:*, db:migrate, db:reset:*, db:audit/backup (they read .env.local and use the personal access token).
2. Unit and PGlite tests need no hosted database and no credentials; prefer them.
3. If hosted dev data is needed, write a task for the owner with the exact command and why.
4. Never use the retained real account in the dev database or any real person's data in tests, screenshots or fixtures.
5. Synthetic fixtures live in tests, are clearly fictional and contain no real institutions' private data.

## Medyra invariants
- SEED_ALLOWED_PROJECT_REF lock; never production.

## Validation
The guard hook denies these commands; CI has no dev credentials outside dev-migration.yml.

## Required evidence
N/A (policy skill).

## Prohibited
Running the scripts, reading scripts/.seed-output/ or .env.local.

## Failure handling
If a task cannot proceed without hosted data, mark it BLOCKED with the owner command.

## Output contract
A blocker or owner request, never a script run.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
