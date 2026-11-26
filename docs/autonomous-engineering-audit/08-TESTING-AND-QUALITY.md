# 08 · Testing and quality

## 1. Executed in this audit (read-only, local, no network side effects except `npm audit` registry lookups)

| Command | Started (local, UTC-5) | Result |
| --- | --- | --- |
| `npm run lint` (`eslint`) | 2026-11-25T20:19:01 | **Pass**, 0 problems |
| `npm run typecheck` (`tsc --noEmit`) | 2026-11-25T20:19:27 | **Pass**, no output |
| `npm test` (`vitest run`) | 2026-11-25T20:19:37 | **Pass**: 71 files, **1,145 tests**, 58.2 s |
| `npm audit --omit=dev` | 2026-11-25T20:20:39 | **5 moderate** (Sentry bundler-plugin chain under `@sentry/nextjs`/`@sentry/node`; `minimatch` GHSA-g3hv-75wg-m249) |
| `npm run build` | **Not run** in this audit (writes `.next/`; last recorded passes in commit history). Considered safe but skipped to keep the audit side-effect free. | Unknown at HEAD |

Raw output saved outside the repo in the session scratchpad (`validation.txt`); not committed.

## 2. Test infrastructure

| Layer | Tooling | Location | Notes |
| --- | --- | --- | --- |
| Unit / action tests | Vitest 5 (`vitest.config.mts`, jsdom env, `maxWorkers: 4`, hook timeout 90 s) | `src/**/*.test.{ts,tsx}` | Server actions tested with recording Supabase double `src/test/db-mock.ts` and shared mocks `src/test/mocks.ts` |
| Component tests | @testing-library/react 16, user-event 14, jest-dom 7 | `src/**/components/*.test.tsx` | Includes accessibility-ish queries by role/label; no axe |
| Database / RLS tests | PGlite 0.5 runs **all migrations in memory** with stub `auth`/`storage` schemas | `supabase/tests/*.test.ts` (13 files) + `helpers.ts` (`createHarness`, `asUser`, `reset`) | Real SQL, policies, triggers, RPCs; harness users alice/bob/carol/dave/admin |
| Seed tool tests | Vitest | `scripts/seed/seed.test.ts` | Plan validation, safety locks |
| Guard tests | Vitest | `src/lib/api-protection.test.ts` (every route handler registered with its protection; admin pages call `requireAdmin`; non-auth actions call a session gate), `src/proxy.test.ts` | Architecture fitness functions |
| E2E / browser | **None** (no Playwright/Cypress). Manual procedures in `TESTING.md` §0-16 | — | `DATA_VALIDATION_REPORT.md`: "Playwright was not used" |
| API tests | Route handlers unit-tested (health, export, webhook, SSO return) | `src/app/**`, `src/features/verification/**` | No HTTP-level tests against a running server |
| Live data checks | `npm run seed:verify` (62 checks on the live dev DB), `npm run db:audit` | `scripts/seed/` | Require `.env.local` + dev DB access |
| Performance | none | — | — |
| Accessibility | none automated | — | Requirement in `CLAUDE.md`; manual only |
| Security tests | Authorization covered heavily in PGlite (cross-user writes, anonymity leakage sweep, blocked members, admin-only RPCs); no DAST/pen test | `supabase/tests/*` | Pen test is blocker B14 |
| Coverage | **No coverage tool or threshold** configured | — | — |

Test file inventory: 71 files (13 DB, 57 in `src`, 1 in `scripts`). Database suites: `audit-log-deletion, communities-forums, feed, messaging-mentorship, network, provider-journey, provider-verification, rls, safety, security-privacy, student-sso, student-verification` (+ `helpers.ts`).

Focused commands documented in repo:
```bash
npx vitest run supabase/tests/student-verification.test.ts
npx vitest run src/features/student-verification
npx vitest run supabase/tests/provider-verification.test.ts supabase/tests/provider-journey.test.ts src/features/verification
npx vitest run supabase/tests/student-sso.test.ts src/features/verification
npm run seed:verify        # live dev DB, needs .env.local
```

## 3. Quality gates

| Gate | State |
| --- | --- |
| ESLint | `eslint.config.mjs` = `eslint-config-next` core-web-vitals + typescript; ignores `.agents/**`, `.claude/**` |
| Type checking | `tsc --noEmit`, strict |
| Formatting | **No Prettier / formatter config** |
| Pre-commit hooks | **None** (no husky, lint-staged, `.git/hooks` custom) |
| CI checks | **None** (no `.github/workflows`) |
| Required checks / branch protection | Unknown (not queried); effectively none since work is pushed straight to `dev` |
| Build validation | Manual `npm run build` per `CLAUDE.md` "Before finishing work" |
| Test reporting | Console only |
| Definition of done (documented) | `CLAUDE.md`: run lint, typecheck, test, build before finishing |

## 4. Observations for autonomy

- The suite is fast enough for per-change gating (~1 min) and deterministic (no network; PGlite in-process). Vitest notes ~17 s could be saved with `isolate: false`.
- DB tests require every new table to be added to `h.reset()` (`supabase/tests/helpers.ts`), a recurring manual step.
- Without E2E tests, UI regressions in Phase 6/7 and verification flows are caught only by component tests and manual review.
- Without CI, "green" is whatever the last agent ran locally; an autonomous system needs CI as the source of truth.
