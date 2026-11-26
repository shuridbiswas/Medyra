# 10 · Infrastructure and deployment

## 1. Environments

| Environment | What exists | Evidence |
| --- | --- | --- |
| Local development | `npm run dev` (`.claude/launch.json` config `medyra-dev`, port 3000) against the hosted dev Supabase project via `.env.local` | `.claude/launch.json`, `README.md` |
| Dev database | Supabase project `medyra-dev` (ref in `DATABASE_AUDIT.md`), email confirmation **off**, seeded with 100 fictional members | `CLAUDE.md`, `DATABASE_AUDIT.md`, `TEST_DATA_REPORT.md` |
| Preview | Netlify deploy previews / branch deploys described; previews must use the dev project | `DEPLOYMENT.md` §1, §4 |
| Staging | **None** | — |
| Production | `https://medyraapp.netlify.app` returned `environment: production` with Supabase configured on 2026-10-31 (pre-Phase 4A build). It points at the **dev** database. No custom domain. No production Supabase project. | `PRODUCTION_READINESS.md` §2 |

Branch to environment mapping: `DEPLOYMENT.md` says production branch = `main`, `dev` = branch deploy. But `origin/main` contains only an unrelated "Initial commit" + README, so the production site must be building from another branch (likely `dev`) or an old manual configuration. **Actual Netlify settings: Unknown** (no Netlify CLI/token locally; dashboard not accessible).

## 2. Build and deploy

| Item | Value |
| --- | --- |
| Provider | Netlify, OpenNext adapter auto-detected (`netlify.toml`); no static export |
| Build command | `npm run build` (Node 22, `NPM_FLAGS=--no-audit --no-fund`) |
| Trigger | Git push (Netlify GitHub integration); no CI gate |
| Deploy contexts | `NEXT_PUBLIC_APP_ENV` = production / preview set per context in `netlify.toml` |
| Headers | `/api/health` no-store; security headers from `next.config.ts` |
| GitHub Actions | **None** (`.github/` absent) |
| Branch protection / required approvals | Unknown (GitHub not queried; `gh` not installed). Practice: direct pushes to `dev`. |
| Release procedure | Documented only (`DEPLOYMENT.md` §6): create prod Supabase project → apply migrations → env vars → merge to `main` → checklist → owner's written go-ahead for domain/DNS |
| Rollback | Netlify "Publish deploy" of a previous build (`DEPLOYMENT.md` §7); DB rollbacks not documented (forward-only migrations) |
| Migration deployment | Manual: `npm run db:migrate` (`scripts/seed/migrate.ts`, Management API with the PAT, records in `supabase_migrations.schema_migrations`) or SQL editor. Not tied to deploys, so code can ship before its migration (this has happened: Phase 6/7 were pushed before migrations were applied). |
| Smoke tests | Manual checklist (`DEPLOYMENT.md` §5, `PRODUCTION_READINESS.md` §2) using `curl`; `GET /api/health` returns booleans for configured services |
| Notifications | None (no Slack/email deploy alerts) |
| Monitoring | Planned (`OBSERVABILITY.md`): Sentry alerts, external uptime monitor on `/api/health` and `/welcome`, Supabase alerts |

## 3. Environment variables (names only, from `.env.example`)

Public: `NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_SENTRY_DSN, NEXT_PUBLIC_PRODUCTBRIDGE_ORG_ID, NEXT_PUBLIC_DEMO_DATA_BANNER`
Server: `RESEND_API_KEY, EMAIL_FROM, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PINECONE_API_KEY, PINECONE_INDEX, PINECONE_EMBEDDING_MODEL, SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, SENTRY_TEST_TOKEN, MFA_ENFORCEMENT, TWO_FACTOR_SECRET, PRIVACY_CONTACT_EMAIL, VERIFICATION_SECRET, EVIDENCE_AV_REQUIRED, VERIFICATION_ENV, VERIFICATION_LIVE_PROVIDERS_ENABLED, SHEERID_ENABLED, SHEERID_PROGRAM_ID, SHEERID_ACCESS_TOKEN, SHEERID_WEBHOOK_SECRET, VERIFICATION_WRITER_KEY, STUDENT_SSO_CLIENT_SECRET`
Seed tooling: `SEED_ALLOWED_PROJECT_REF, SEED_KEEP_EMAILS, SEED_PROTECTED_PROJECT_REFS`
Present locally in `.env.local` (names): `NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_ACCESS_TOKEN, VERIFICATION_SECRET, SEED_ALLOWED_PROJECT_REF, SEED_KEEP_EMAILS` (`SUPABASE_ACCESS_TOKEN` is not listed in `.env.example`).
Netlify values: Unknown.

## 4. Route handlers (HTTP surface)

| Route | Protection (from `src/lib/api-protection.test.ts`) |
| --- | --- |
| `GET /api/health` | Public, booleans only |
| `GET /api/sentry-test` | 404 unless `SENTRY_TEST_TOKEN` header matches |
| `GET /auth/callback` | Supabase code exchange, safe redirect |
| `POST /settings/privacy/export` | Member + recent auth, no-store |
| `GET /api/verification/student/return` | Signed-in member who started the SSO attempt |
| `POST /api/verification/providers/sheerid/webhook` | Off unless enabled; HMAC + writer key |

## 5. What could become autonomous

| Step | Autonomy recommendation |
| --- | --- |
| Lint/type/test/build on every push/PR | Autonomous (needs CI) |
| Preview deploys of feature branches | Autonomous (Netlify already does it) |
| Smoke test of previews (`/api/health`, redirects, Playwright) | Autonomous |
| Applying migrations to dev | Autonomous behind CI with a scoped token, after PGlite tests; reversible only by new migrations |
| Merging to the integration branch | Autonomous after CI + independent review agent, if the owner accepts (decision) |
| Production promotion, DNS, domain | Human approval (documented rule) |
| Production migrations | Human approval |
| Creating accounts, secrets, paid services | Human only |
