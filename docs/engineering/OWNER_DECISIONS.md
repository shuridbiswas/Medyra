# Owner decisions and authorizations

One consolidated list. Agents add questions here once; they do not repeat them. Record answers in this file (and, where a file controls behaviour, in `engineering/approvals.json` or `engineering/control.json`).

## Needed to activate the engineering system

| Id | Decision | Default until decided | Blocks |
| --- | --- | --- | --- |
| D-01 | Rotate the Supabase personal access token in `.env.local` and create a dev-only scoped token for `dev-migration.yml` | Hosted migrations impossible; agents never see any token | SEC-001, DB-001 |
| D-02 | Branch model: make `main` the production branch (options in RELEASE_POLICY.md) | `dev` stays the only real branch; no production releases | OPS-001 |
| D-03 | Push the bootstrap branch and enable GitHub Actions | No CI evidence | ENG-003 |
| D-04 | Agent GitHub credential: GitHub App (recommended) or fine-grained token; make GitHub Issues canonical | Local backlog stays canonical | OPS-003 |
| D-05 | Branch protection and CODEOWNERS (text in SETUP_GUIDE.md) | Nothing stops direct pushes | OPS-004 |
| D-06 | Claude credential for CI (`ANTHROPIC_API_KEY` with Console spend limit, or `CLAUDE_CODE_OAUTH_TOKEN`) and budget (proposed 5 / 10 / 100 USD per run / day / month) | No AI execution in CI | ENG-006 |
| D-07 | Dependencies: `@playwright/test`, `@axe-core/playwright`, `@vitest/coverage-v8` | Browser, a11y and coverage gates NOT_EXECUTED | QA-001, QA-005, ENG-005 |
| D-08 | Synthetic test environment for E2E (separate Supabase test project or dedicated synthetic accounts on dev) | No E2E | QA-001, QA-003, QA-004 |
| D-09 | Autonomy level: auto-integration to `dev` after CI + reviews? hosted dev migrations? | Both off; owner merges | ENG-006 |
| D-10 | Production Supabase project, plan (backups/PITR), domain | No production release possible | OPS-007, OPS-008 |
| D-11 | Full French UI and launch region | English UI; FR only in verification | ENG-004 |
| D-12 | Netlify: confirm production branch and that the production-labelled site uses the dev database; decide whether to relabel it | Treated as non-production | OPS-002 |

## Product and legal (unchanged from the audit, `docs/autonomous-engineering-audit/14-PRODUCT-OWNER-DECISIONS.md`)

Minors policy · invite-only launch · business model · professional verification method and SheerID contract · `forum_identity` disclosure and retention · moderation staffing and crisis resources · retention periods (messages, mentorships, evidence, audit logs) · legal review timing, privacy officer, privacy mailbox · pen test budget.

## Recorded answers

| Date | Decision | Answer | Reference |
| --- | --- | --- | --- |
| 2026-11-25 | Controlled trial task | Correct the stale `UPCOMING_FEATURES` copy (FEAT-001); no push or deploy | Founder instruction §30 Phase H; `engineering/approvals.json` |
| 2026-11-25 | Proposed limits | 1 implementation, 2 remediation attempts, 1 task per cycle, 45 min, 5/10/100 USD (proposed, not authorization to spend) | Founder instruction §23; recorded in `engineering/control.json` with execution disabled |
