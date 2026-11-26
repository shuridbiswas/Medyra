# Quality gates

Every result is recorded per commit SHA as PASSED, FAILED, NOT_APPLICABLE, NOT_EXECUTED or BLOCKED (`npm run eng -- gate ...`). Unexecuted mandatory gates block integration; NOT_APPLICABLE is not allowed for mandatory gates; evidence for an older SHA does not count. Nobody removes tests or weakens assertions to pass.

| # | Gate | Mandatory | Command / mechanism | Where it runs | Status today |
| --- | --- | --- | --- | --- | --- |
| 1 | lint | yes | `npm run lint` | ci.yml | implemented |
| 2 | typecheck | yes | `npm run typecheck` | ci.yml | implemented |
| 3 | unit | yes | `npm test` (Vitest) | ci.yml | implemented |
| 4 | pglite | yes | `npm test` includes `supabase/tests` (focused: `npx vitest run supabase/tests`) | ci.yml, dev-migration.yml | implemented |
| 5 | build | yes | `npm run build` on Node 22 with placeholder public env | ci.yml | implemented |
| 6 | acceptance | per task | tests named in the brief | agent + CI | per task |
| 7 | regression | per task | full `npm test` before integration | ci.yml | implemented |
| 8 | browser | per task | Playwright (`tests/e2e/PLAN.md`) | — | **blocked: dependency approval (QA-001)** |
| 9 | accessibility | per task | axe via Playwright | — | **blocked (QA-005)** |
| 10 | dependency-scan | per task | `npm audit --omit=dev --audit-level=high` | ci.yml (fails on high/critical), maintenance.yml (report) | implemented; 5 moderate advisories known (SEC-005) |
| 11 | secret-scan | yes | `npm run eng:secrets` | ci.yml | implemented |
| 12 | code-review | yes | medyra-code-reviewer verdict on the SHA | engine | implemented |
| 13 | security-review | when sensitive | medyra-security-reviewer verdict on the SHA + owner approval | engine | implemented |
| 14 | migration-compatibility | migrations | `npm run eng:migrations` (lock, ordering, grants, definer checks, destructive markers) + PGlite + parity | ci.yml, dev-migration.yml | implemented (hosted parity needs SEC-001) |
| 15 | docs-consistency | doc tasks | documentation steward review | engine (recorded gate) | manual review |
| 16 | preview-smoke | deployed changes | `npm run eng:smoke -- <url> --expect-env preview` | preview-validation.yml | implemented |

## Coverage

No coverage tool is installed. A baseline needs `@vitest/coverage-v8` (dependency approval, ENG-005). Until then: every changed behaviour needs a test that fails without the change.

## Baseline (measured)

- 2026-11-25 audit: lint pass, typecheck pass, 1,145 tests in 71 files, 5 moderate production advisories.
- 2026-11-26 after this work: see `docs/engineering/TRIAL_REPORT.md` for the commands, counts and the production build result.
