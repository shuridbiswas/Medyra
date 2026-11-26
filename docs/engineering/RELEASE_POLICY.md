# Release policy, branch remediation and migration ordering

## Current facts (verified 2026-11-26)

- All application history is on `dev` (HEAD `008e754` at audit time). `origin/main` has unrelated history (an initial commit and a README); `git merge-base origin/main origin/dev` is empty.
- `https://medyraapp.netlify.app` serves the current build: `npm run eng:smoke` passed all 15 checks with `environment: production` (health, redirects, `/messages` protected, security headers). Per `PRODUCTION_READINESS.md` it uses the **development** Supabase project. Treat it as a non-production environment.
- Netlify's configured production branch is unknown (needs dashboard access).
- No production Supabase project exists.

## Intended branch model (recommendation until D-02 is decided)

`agent/<task>-<run>` or `feat/<task>` branches → PR → `dev` (integration, previews) → PR → `main` (production). Branch protection on both; CI and code-owner review required; no force pushes or deletions.

## Branch remediation options (owner chooses; nothing is done automatically)

| Option | Steps | Trade-off |
| --- | --- | --- |
| A (recommended) | Archive old main: `git push origin origin/main:refs/heads/archive/main-initial` · in GitHub settings temporarily allow the change, then point `main` at `dev`'s commit with a PR from a branch created from `dev` using GitHub's "change default branch" / admin update, or recreate `main` from `dev` after deleting it **only after the archive exists** · protect `main` | Clean history; requires one admin action |
| B | Merge with `--allow-unrelated-histories` on a branch, resolve the README conflict, PR into `main` | Keeps both histories; README conflict to resolve |
| C | Keep `dev` as the production branch in Netlify and retire `main` | No admin rewrite; less conventional |

Agents never force-push, delete branches, change the default branch or Netlify settings.

## Migration-aware release order

1. Migrations pass PGlite and `npm run eng:migrations` in CI.
2. Security review of the migration; compatibility note says whether the currently deployed app works with the new schema.
3. Owner approval (`migrate-dev`), then `dev-migration.yml` mode `apply` (environment reviewer), then parity mode shows no pending files.
4. Only then merge or deploy application code that depends on the migration.
5. Preview smoke on the deployed commit; record evidence.

Prefer additive, backward-compatible migrations (new columns nullable, new tables first, code switch later, cleanup in a later migration). Rollback is forward-only: write a new migration that restores behaviour; Netlify rolls back code by publishing the previous deploy.

## Production release prerequisites (all required; currently none satisfied)

Separate production Supabase project · production environment variables · auth configured (email confirmation on, Resend SMTP) · email delivery and `TWO_FACTOR_SECRET` · backups and a tested restore · migration parity for the release commit · moderation operations staffed · legal and privacy decisions · monitoring and uptime alerts · owner approval through `production-release.yml` (currently disabled by design).
