# Incident runbook

No monitoring service is configured yet (Sentry DSN, uptime monitor, Upstash: all unset). Signals available today: CI failures, `maintenance.yml` reports, `npm run eng:smoke`, `npm audit`, migration parity, stale task claims. Do not invent monitoring data.

## Signal sources (current → planned)

| Signal | Today | After OPS-006 |
| --- | --- | --- |
| CI failure | ci.yml run status | same, plus maintenance task creation |
| Site health | manual `npm run eng:smoke -- https://medyraapp.netlify.app` or preview-validation.yml | external uptime monitor on `/api/health` and `/welcome` |
| Application errors | none | Sentry (scrubbed: no cookies, bodies, emails, content) |
| Dependency advisories | `npm audit --omit=dev` (maintenance.yml) | same |
| Migration parity | dev-migration.yml mode `parity` (needs SEC-001) | scheduled parity |
| Stale claims | `npm run eng -- recover` / `status` | maintenance.yml |

## Procedure (medyra-incident-recovery skill)

1. Deduplicate against open tasks; update instead of duplicating.
2. Severity: **critical** (security or data exposure, site down, anonymity or evidence leak), **high** (core journey broken), **medium**, **low**.
3. Evidence: error codes, failing test names, SHAs, smoke output. Never member data, content, secrets or evidence files.
4. Reproduce. If it cannot be reproduced, record and stop.
5. Regression test first, root-cause fix on an isolated branch, full gates, independent reviews, remediation PR.
6. Escalate to the founder only for critical severity, a required authorization, budget exhaustion or a repeated failure (two failed attempts). One notification per unchanged blocker.

## Never automatic

Production infrastructure changes, production data changes, credential rotation, Netlify settings, rollbacks of the database. A Netlify code rollback ("Publish deploy" of the previous build) is a human action.

## Backups and recovery (OPS-008, pending)

Confirm the Supabase plan's backups/PITR and rehearse a restore before production. Until then dev data is reproducible from `scripts/seed/` by the owner only.
