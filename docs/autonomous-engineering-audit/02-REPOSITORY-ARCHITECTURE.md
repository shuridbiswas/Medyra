# 02 · Repository and architecture

## 1. Repository facts (2026-11-25)

| Item | Value |
| --- | --- |
| Remote | `https://github.com/shuridbiswas/Medyra.git` |
| Current branch | `dev` |
| HEAD | `008e7543835d3afb67f8dc6592b8922c2d40170b` "Add university SSO provisional affiliation and document-program analysis" (2026-11-18) |
| Local vs `origin/dev` | In sync (0 ahead, 0 behind) |
| `main` | **Unrelated history**: `origin/main` has only `22abf9d Initial commit` and `c837a71 Update README.md`; `git merge-base origin/main origin/dev` returns nothing. All 30 app commits are on `dev` only. |
| Branching in practice | Single long-lived `dev` branch, direct commits, no PRs, no feature branches, no tags. `DEPLOYMENT.md` describes `main` = production and PR previews, which has never been used. |
| Working tree | `M skills-lock.json` (skill tooling), `?? brag-output/` (a launch-video artifact). Both are not app code and were left untouched. |
| Structure | Single Next.js application (not a monorepo) |
| Size | ~30.3k lines of non-test TS/TSX in `src`; 7.4k lines of SQL in 15 migrations; 71 test files |

## 2. Directory tree (generated and vendored folders omitted)

```
Medoras/                              (repo name on disk; product = Medyra)
├─ .agents/skills/                    agent skills installed by the `skills` CLI (vercel, supabase, writing…)
├─ .claude/                           (git-ignored) launch.json + project skills (see 05/06)
├─ docs/
│  ├─ verification/                   15 student-verification / provider / SSO docs
│  └─ autonomous-engineering-audit/   this audit
├─ public/                            static assets
├─ scripts/seed/                      dev-only seed, wipe, reset, audit, migrate, login tools (+ seed.test.ts)
├─ src/
│  ├─ app/                            App Router routes (55 pages, 6 route handlers)
│  ├─ components/{ui,layout,forms,brand}/ + member-avatar, relative-time, verification-chip
│  ├─ features/<name>/                22 feature modules (schemas, queries, actions, components, tests)
│  ├─ lib/{auth,supabase,email,monitoring,pinecone}/ + rate-limit, cache, redis, services, legal, site
│  ├─ test/{mocks,db-mock}.ts         shared test doubles
│  ├─ proxy.ts                        Next 16 proxy (session refresh + redirects)
│  └─ instrumentation*.ts             Sentry bootstrap
├─ supabase/
│  ├─ migrations/                     15 SQL migrations (2026-10-28 … 2026-11-09)
│  ├─ tests/                          13 PGlite policy test files + helpers.ts
│  ├─ templates/                      auth email templates
│  └─ config.toml                     local CLI config (hand-written, "not yet run")
├─ CLAUDE.md, AGENTS.md, README.md, ARCHITECTURE.md, DEPLOYMENT.md, …  (see 01 §6)
├─ netlify.toml, next.config.ts, tsconfig.json, eslint.config.mjs, vitest.config.mts, vitest.setup.ts
├─ components.json (shadcn), .nvmrc (22), .env.example, skills-lock.json
└─ brag-output/ (untracked)
```

Feature modules (`src/features/`): `admin, auth, communities, feed, feedback, forums, home, landing, mentorship, messaging, network, notifications, onboarding, pages, privacy, profile, safety, saved, security, settings, student-verification, verification`.

Entry points: `src/app/layout.tsx` (root), `src/app/page.tsx` (member home), `src/proxy.ts` (edge-of-request), `src/instrumentation.ts` / `instrumentation-client.ts` (Sentry), route handlers listed in `10`.

Generated / tooling files present: `.next/` (build cache), `tsconfig.tsbuildinfo`, `next-env.d.ts` (git-ignored), `node_modules/`.

## 3. Technology stack (installed versions from `package.json`)

### Frontend
| Tech | Version | Purpose | Status |
| --- | --- | --- | --- |
| Next.js (App Router, Turbopack, `cacheComponents`, `partialPrefetching`) | 16.4.6 | Framework, SSR + Server Components + Server Actions | Implemented, verified by build/tests; live preview checked once (Oct 31) |
| React / React DOM | 19.3.0 | UI | Verified |
| TypeScript | ^5 (strict) | Language | Verified (`tsc --noEmit`) |
| Tailwind CSS | ^4 (+ `@tailwindcss/turbopack`, `tw-animate-css`) | Styling, tokens in `globals.css` | Verified |
| shadcn/ui (base-nova, Base UI `@base-ui/react` ^1.9) | CLI ^4.23 (dev) | Primitives in `src/components/ui` | Implemented |
| lucide-react | ^1.63 | Icons | Implemented |
| class-variance-authority, `cn` ^0.5 | — | Variants; `src/lib/utils.ts` re-exports `cn` from the `cn` package | Implemented |
| State management | none (server data + local `useState`/`useTransition`) | — | By design |
| Forms | native `<form>` + server actions; controlled fields where failures must keep text | — | Implemented |
| Validation | zod ^4.6.7 (all server actions) | Implemented, tested |
| i18n | none (EN); FR only for student verification | Partial |
| Accessibility | semantic landmarks, labels, focus rings, `motion-reduce` | Implemented; no automated a11y test (no axe) |
| Animation | tw-animate-css only | Minimal |
| Browser support | not specified; modern evergreen implied | Unknown |

### Backend / server
| Tech | Purpose | Status |
| --- | --- | --- |
| Next.js Server Actions (`src/features/*/actions.ts`) | All writes | Implemented, unit-tested with recording mocks |
| Route handlers | `/api/health`, `/api/sentry-test`, `/auth/callback`, `/settings/privacy/export`, `/api/verification/student/return`, `/api/verification/providers/sheerid/webhook` | Implemented; registry test `src/lib/api-protection.test.ts` |
| Supabase Auth (`@supabase/ssr` ^0.12.7, `@supabase/supabase-js` ^2.118) | Email/password auth, cookie sessions | Implemented, verified live on dev (Phase 2-4) |
| App-level 2FA (email codes, HMAC cookies) | `src/lib/auth/{mfa,two-factor,session}.ts` | Implemented, unit-tested; **not configured** anywhere (needs `TWO_FACTOR_SECRET` + Resend) |
| Authorization | PostgreSQL RLS + `security definer` RPCs in `public`, helpers in `private` schema | Implemented, PGlite-tested |
| Rate limiting | `@upstash/ratelimit` ^2.2 + `@upstash/redis` ^1.40, fail-open (`src/lib/rate-limit.ts`) + hard DB limits | App layer configured but unused (no Upstash env); DB limits active |
| Cache | `src/lib/cache.ts` (Redis, public aggregates only; used by `features/home/queries.ts`) | Configured but inactive without Redis |
| Email | Resend ^6.35 (`src/lib/email/send.ts`: `sendToMember`, `sendToAddress`) | Configured but unused (no key) |
| Search | Postgres `ilike` (members), full-text `tsvector` (forums) | Implemented |
| Semantic search | Pinecone ^9.1 (`src/lib/pinecone/*`, `searchProfileIds`) | **Configured but unused**: no page calls `searchProfileIds` |
| Error tracking | Sentry `@sentry/nextjs` ^11.10, `scrubEvent` | Configured but unused (no DSN) |
| Feedback | ProductBridge links only (`src/features/feedback/config.ts`, `/feedback`) | Configured, off without org id |
| JWT / OIDC | `jose` 6.2.17 (university SSO ID-token validation) | Implemented against simulator only |
| Background jobs / queues | none. `private.run_retention_purge()`, `expire_student_credentials`, `due_evidence_deletions` exist but **nothing schedules them** | Planned |
| AI integrations | none (document analyzer interface exists, no provider) | Planned |
| External verification | SheerID adapter (`src/features/verification/providers/sheerid.ts`), simulator, OIDC SSO | Implemented, not connected (no contract/credentials) |

### Database
| Item | Finding |
| --- | --- |
| Provider / engine | Supabase-hosted PostgreSQL; one **dev** project (`medyra-dev`, ref recorded in `DATABASE_AUDIT.md`) |
| Query library | `supabase-js` PostgREST client; hand-written types `src/lib/supabase/database.types.ts` (no codegen) |
| ORM | none |
| Migration framework | Plain SQL files in `supabase/migrations/`, applied via Supabase Management API / `npm run db:migrate` (`scripts/seed/migrate.ts`), recorded in `supabase_migrations.schema_migrations`. Never edit applied files. |
| Schema size | 67 tables, 59 public RPC functions, many `private` helper functions and triggers; every `public` table has RLS (per `DATABASE_AUDIT.md`) |
| Storage | Buckets `avatars`, `covers` (public), `student-verification-evidence` (private) |
| Live parity | `DATABASE_AUDIT.md` (2026-11-09): 12 of 12 repo migrations applied. Repo now has **15**; `20261107000001`, `20261108000001`, `20261109000001` application status is **Unknown** (README asks for `db:migrate`; `MONTREAL_STUDENT_SSO_ARCHITECTURE.md` says `20261109000001` is **not applied**). |
| Backups | Unknown (plan-dependent; blocker 10) |
| Dev/prod separation | **No production project exists.** Netlify production context reportedly used the dev project (`PRODUCTION_READINESS.md` §2). |
| Testing | PGlite (`@electric-sql/pglite` ^0.5.12) runs every migration in memory with `auth`/`storage` stubs (`supabase/tests/helpers.ts`) |

### Infrastructure
| Item | Finding | Status |
| --- | --- | --- |
| Hosting | Netlify (`netlify.toml`, OpenNext adapter auto-detected), Node 22 | Implemented; site `medyraapp.netlify.app` observed live Oct 31 |
| CDN | Netlify edge | Implied |
| DNS / domain | `DNS_SETUP.md` runbook; no custom domain attached | Planned |
| CI/CD | **None in repo** (no `.github/`). Netlify builds on push. | Missing |
| Monitoring / uptime | `OBSERVABILITY.md` plan only | Planned |
| Analytics | none | — |
| Secrets | `.env.local` (git-ignored), Netlify env vars; `.env.example` lists names | Implemented |
| Containers | none (Docker is installed locally but unused by the project) | — |
| Scheduled jobs | none | Missing |

## 4. Application architecture

```
Browser ─► Netlify (Next.js 16) ─► proxy.ts (session refresh, redirects, private-prefix list)
                                 ├─► Server Components (queries via createClient(), member's own JWT)
                                 └─► Server Actions (requireMember → zod → checkRateLimit → supabase-js / rpc)
                                                         │
                                                         ▼
                                Supabase: Auth · PostgREST · Storage · Realtime(messages)
                                Postgres: RLS policies + security-definer RPCs + triggers (notifications, audit, limits)
Optional, fail-soft: Upstash (rate limit/cache) · Resend (email) · Sentry · Pinecone · ProductBridge · SheerID · university OIDC
```

Key rules (from `CLAUDE.md`, observed in code):
- Only the **publishable** Supabase key is used; no service-role key anywhere (`src/lib/supabase/{client,server,proxy,anon}.ts`). Trusted machine writes use `VERIFICATION_WRITER_KEY` hashed in `verification_writer_keys`.
- Every server action starts with a session gate (`requireMember`/`requireUser`/`requireAdmin`); guard test enforces it.
- Content is never cached per member; notifications never carry text; anonymous authors exist only in `forum_identity`.

## 5. Technical debt and stale items (observed)

| Item | Evidence |
| --- | --- |
| `npm audit` | 5 moderate advisories in production dependencies (Sentry bundler-plugin chain under `@sentry/nextjs`/`@sentry/node`, `minimatch` GHSA-g3hv-75wg-m249), observed 2026-11-25 |
| Hand-maintained DB types drift risk | `src/lib/supabase/database.types.ts` written by hand; no `supabase gen types` |
| Stale "upcoming" copy | `src/features/home/content.ts` `UPCOMING_FEATURES` still advertises Communities and Mentorship matching as planned; rendered in `right-sidebar.tsx:254` |
| Stale placeholder content | `FUTURE_MODULES.communities/mentorship` unused now (only `careers` uses `ModulePage`) |
| Unused integrations | Pinecone `searchProfileIds` never called |
| Roadmap numbering conflict | `CLAUDE.md` roadmap vs "Current scope" |
| `main` branch unrelated | see §1 |
| Comment-removal RPC without UI | `community_remove_comment` (CLAUDE.md notes it) |
| Approximate unread counts | `src/features/messaging/queries.ts` |
| Append-only junk rows in dev | `TEST_DATA_REPORT.md` "Known issues" |
| `supabase/config.toml` never run | header comment |
| No TODO/FIXME markers | `grep` found none in `src`, `scripts`, `supabase` |
