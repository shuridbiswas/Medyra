# 00 · Master discovery report: Medyra autonomous-engineering readiness

Audit date 2026-11-25 · repo `https://github.com/shuridbiswas/Medyra.git` · branch `dev` @ `008e754` (2026-11-18) · discovery only (no code, schema, package, config, deploy or git changes; only this folder was created).

This file is self-contained. Detail tables live in `01`–`14`; everything an architect needs to design the system is summarised here. Status words: **Verified** (tests + documented live check) · **Unverified** (tests only) · **Partial** · **Placeholder** · **Planned** · **Unknown**.

---

## 1. Product

- **Medyra** (formerly Medoras): professional and social network exclusively for healthcare and social-services students, graduates, professionals, educators, researchers, mentors and (later) employers. Tagline "Connect. Learn. Grow. Belong." Long-term startup, not a demo.
- Principles (approved, `CLAUDE.md`): trust first; privacy by design (anonymous options, coarse location, de-identified cases only); **honest limits stated in the UI** (not medical care, not therapy, no AI moderation claims, no verification claims without a real process); success inspires rather than competes.
- Market: Quebec/Montréal first (implied by seed data and student verification). UI English only; FR exists only for student verification. Launch region, minors policy, business model: **undecided**.
- Maturity: **pre-launch alpha**. ~30k lines TS, 15 SQL migrations, 67 tables, 59 public RPCs, 55 pages + 6 route handlers, 1,145 tests. One **dev** Supabase project with 100 fictional members. No production DB, no real users, legal pages are drafts. Business model unknown.
- Requirements live in `CLAUDE.md` (canonical), `README.md`, `PRODUCTION_READINESS.md`, `TESTING.md`, `docs/verification/*`. They arrive as pasted "PHASE N" prompts in chat. No issue tracker, PRDs or ADRs.

## 2. Architecture and stack

Single Next.js app (not a monorepo):
```
src/app (routes) · src/features/<module>/{schemas,queries,actions,components,content,*.test} · src/lib/{auth,supabase,email,monitoring,pinecone,rate-limit,cache}
supabase/migrations (15 SQL) · supabase/tests (13 PGlite suites + helpers.ts) · scripts/seed (dev data tools) · docs/verification
```
- **Frontend:** Next.js 16.4.6 App Router (Cache Components, partial prefetching, Server Actions, `proxy.ts` instead of middleware), React 19.3, TypeScript strict, Tailwind 4 with maroon tokens, shadcn (Base UI), lucide, zod 4. No client state library. No i18n framework. No automated a11y tests.
- **Backend:** Server Actions only (each: `requireMember()` → zod → `checkRateLimit` → supabase-js/RPC). 6 route handlers (`/api/health`, `/api/sentry-test`, `/auth/callback`, `POST /settings/privacy/export`, `/api/verification/student/return`, SheerID webhook).
- **Auth:** Supabase Auth email/password (`@supabase/ssr`); app-level emailed 2FA code (HMAC cookies bound to session id); admin = `staff_roles` row + confirmed 2FA. **Only the publishable key**; no service-role key anywhere; trusted machine writes use a hashed `VERIFICATION_WRITER_KEY`.
- **Authorization:** RLS on every table, column grants, `security definer` RPCs in `public` that check `auth.uid()`/`private.is_admin()` and write append-only audit rows; `private` schema helpers re-granted explicitly after `revoke execute on all functions in schema private` (repeated in each migration).
- **Database:** Supabase Postgres (dev only), plain SQL migrations applied via Management API (`npm run db:migrate`, needs a personal access token) and recorded in `supabase_migrations.schema_migrations`; never edit applied files. Hand-written types `src/lib/supabase/database.types.ts`. Storage buckets `avatars`, `covers` (public), `student-verification-evidence` (private). Realtime publication for `messages`.
- **Optional, fail-soft integrations (all OFF/unconfigured):** Upstash (rate limit/cache; DB hard limits always on), Resend (email), Sentry (`scrubEvent`), Pinecone (code exists, never called), ProductBridge (links), SheerID (adapter + simulator; no contract), university OIDC SSO (simulator only), AI/OCR document analyzer (interface only), AV scanning (gate only).
- **Infra:** Netlify (`netlify.toml`, Node 22, OpenNext adapter) builds on git push; site `medyraapp.netlify.app` labelled production but pointing at the **dev** DB. **No CI**, no `.github/`, no scheduled jobs, no monitoring, no CSP, no custom domain.
- **Git:** all 30 app commits on `dev`, pushed directly. `origin/main` has **unrelated history** (Initial commit + README). `DEPLOYMENT.md` assumes main = production with PR previews (never used). Netlify's real branch config: Unknown.

## 3. Features (57 identified: 37 complete, 20 incomplete)

Complete and **verified** on dev (9): welcome page, auth (email/password), onboarding, session routing/proxy, profiles, home feed (posts/likes/comments/categories/pagination), member directory, connections/follows, saved items.

Complete but **unverified live** (28): legal/info pages (drafts), 2FA email code (**unconfigured, so off**), re-auth/session controls, blocking, muting, notifications, reporting (9 target types), admin moderation (**closed until 2FA configured**), suspension/appeals, profile privacy, data export, deletion requests, consent, retention purge function, communities (public/private, roles, requests, bans, announcements, audit log, community posts), forums (Q/A/replies, helpful votes, accepted answers, topics, full-text search, follows), anonymous posting (`forum_identity` isolation), educational second-opinion framing, messaging (direct/group, requests, read state, search, Realtime + 15 s polling fallback), mentorship (listings, availability, requests, capacity, pause/complete, private feedback), student verification (manual reviewer workflow), verified student badge, institutional email challenge, external provider layer (simulator), university SSO + document analysis (simulator; migration `20261109000001` reportedly not applied), settings, feedback links.

**Partial** (7): scheduled maintenance (functions exist, unscheduled), app rate limiting (Upstash off), error reporting (no DSN), semantic search (Pinecone unused), health endpoint (verified once Oct 31), dev seed tooling (orphan-cleanup path unexercised), French localisation (verification only).
**Placeholder** (1): `/careers`. **Stale UI:** home right rail `UPCOMING_FEATURES` still advertises Communities and Mentorship as upcoming.
**Planned** (12): careers/jobs, employer/org profiles, professional/employer verification, articles/research, stories, events/nearby communities, peer-support space with human + AI-assisted moderation, AI moderation, post media, mentions, email/push notifications, per-field privacy/username change.
No TODO/FIXME markers in source.

## 4. Roadmap, blockers, backlog

- Done in order: P1 welcome → P2 auth → P3 profiles → P4 feed → P4b network → P4A security/safety/privacy/admin → "P6" communities/forums → "P7" messaging/mentorship → student verification → seed tooling → provider/SSO layer (HEAD).
- **Conflict:** `CLAUDE.md` roadmap still says Phase 6 = careers/articles/stories, Phase 7 = events/peer support; shipped work reused those numbers. Next documented roadmap item: careers/employer profiles. No current phase declared.
- **Approved blockers** (`PRODUCTION_READINESS.md`): revoke exposed Supabase PAT (a `SUPABASE_ACCESS_TOKEN` is still in `.env.local`); apply/verify pending migrations (dev had 12/12 on 2026-11-09; 3 newer ones unknown/not applied); Resend + `TWO_FACTOR_SECRET`; separate production Supabase project; legal review (Law 25, French, minors), privacy officer and contact; moderation staffing and crisis resources; schedule retention/deletion/expiry jobs; monitoring; CSP; backups/PITR; invite-only decision; trigram search indexes; tester limits; pen test; `forum_identity` disclosure/retention; message retention and minors; verification PIA, AV, AI vendor DPA, institution agreements, SheerID contract.
- **Audit-identified:** no CI; `main`/`dev` split; no live browser review of Phase 6/7/verification; stale docs; 5 moderate npm advisories.
- Backlog priorities (Approved vs Recommended in `04` §6): P0 token, CI, branch model, migration parity · P1 email/2FA, E2E review, CSP, scheduled jobs, monitoring, doc fixes · P2 production project, backups, search indexes, comment-removal UI, type generation, audit fixes, French UI decision · P3 careers and later roadmap.

## 5. Claude Code environment

- Desktop app (Windows 11 Enterprise), Git Bash + PowerShell 5.1, Node 24.22 locally (Netlify uses 22). **`claude` CLI, `gh`, `netlify`, global `supabase` not installed.** Claude Code version Unknown. Repo sits in OneDrive (sync risk for worktrees). Docker and Python installed but unused.
- Project config: `CLAUDE.md` (canonical); `AGENTS.md` (Next.js rule, probably not loaded per docs because CLAUDE.md exists); `.claude/launch.json` (dev server for browser preview); `.claude/skills/` 16 skills (11 symlinked to committed `.agents/skills/`, pinned in `skills-lock.json`). **No** `.claude/settings*.json`, agents, commands, rules, hooks, agent-memory, `.mcp.json`, GitHub workflows. **`.claude/` is git-ignored.**
- User config: `~/.claude/settings.json` = 7 enabled plugins + 5 marketplaces only (no permissions, hooks, model, sandbox). `~/.claude/skills`: find-skills + 4 video skills. No user agents/commands/rules. Plugin SessionStart hooks from superpowers and ponytail. No auto-memory for this project.
- Permissions: none configured; **sandboxing unsupported on native Windows** (WSL2 required). Nothing blocks agents from reading `.env.local`.
- Documented capabilities (official docs, 2026-11-25): subagents with `tools/model/permissionMode/skills/mcpServers/hooks/memory/isolation: worktree`, nesting depth 3, project memory `.claude/agent-memory/<name>/`; agent teams experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, interactive only); headless `claude -p` with `--output-format json`, `--max-turns`, `--max-budget-usd` (client-side estimate), `--permission-mode`, `--allowedTools`, `--bare`; Agent SDK `@anthropic-ai/claude-agent-sdk` / `claude-agent-sdk` (API key); worktrees `claude -w`, `.worktreeinclude`; GitHub Actions `anthropics/claude-code-action@v1` (API key or `CLAUDE_CODE_OAUTH_TOKEN`); cloud sessions and cloud routines (research preview, ≥1 h interval) run with the laptop closed on Pro/Max/Team/Enterprise; `/loop`/CronCreate only while a session is open; desktop scheduled tasks need the PC on; no documented budget flag for routines.

## 6. Agents, skills, plugins, MCP

- **Project agents: 0.** Available generic agents: built-ins (general-purpose, Explore, Plan, claude-code-guide, statusline-setup, fork, web-fetch) and plugin agents (backend-development ×8, full-stack-orchestration ×4, javascript-typescript ×2, apify). Duplicates: 2 security auditors, 2 test automators, 2 performance engineers. None knows Medyra invariants.
- **Skills:** 16 project (relevant: supabase, supabase-postgres-best-practices, vercel-react-best-practices, composition, web-design-guidelines, writing-guidelines; irrelevant: deploy-to-vercel, vercel-cli-with-tokens, vercel-optimize (host is Netlify), react-native, brag, 4 video), 5 user, plus plugin skills (superpowers: brainstorming, writing/executing plans, subagent-driven development, parallel agents, TDD, systematic debugging, verification, code review, git worktrees, finishing branches; ponytail: minimal-change, review, audit, debt; ui-ux-pro-max design set; javascript-typescript patterns; backend patterns; watch) and bundled Claude Code skills (code-review, security-review, simplify, init, run, loop, schedule, update-config, fewer-permission-prompts, claude-api). Missing: Medyra-specific migration, RLS/anonymity review, Netlify release, E2E, legal-copy guard, dev-DB safety skills.
- **Plugins (7):** watch, full-stack-orchestration, javascript-typescript, backend-development, superpowers, ui-ux-pro-max, ponytail. Account/app-level also exposes humanizer, apify, travel-planner, Anthropic document skills.
- **MCP: no project `.mcp.json`.** App/account servers: built-in browser (preview via `.claude/launch.json`), Chrome, computer-use, desktop session/PR/settings tools (`ccd_*`), scheduled-tasks, terminal, visualize, mcp-registry, Google Drive, Perplexity, docs connector, Apify (failed to load).
- Capability check: GitHub repo = git only (no `gh`/GitHub MCP), issues no, PRs partial (app can monitor, cannot create without `gh`), browser yes, framework docs yes (`node_modules/next/dist/docs/`), DB inspection partial (PAT scripts), migrations partial (PAT), hosting/deploy management no, error/infra monitoring no, project management no, notifications app-only, web research yes.

## 7. Current workflow

Owner pastes a phase prompt into one long desktop session → agent writes migration, PGlite tests, feature code, pages, tests, docs → runs `npm run lint && npm run typecheck && npm test && npm run build` → commits to `dev` when told "commit", pushes when told "push" → Netlify auto-builds → migrations applied later by hand with the PAT. No branches, PRs, CI, independent review or E2E. Context survives via `CLAUDE.md` and session compaction. Bottlenecks: human-initiated sessions, no backlog, no review, code shipped before migrations, hot shared files (`database.types.ts`, `rate-limit.ts`, `proxy.ts`, `notifications/format.ts`, `submit_report`/`moderate_report` re-created per migration, `private` grant list, `h.reset()`).

## 8. Testing and quality (run 2026-11-25, local)

| Command | Result |
| --- | --- |
| `npm run lint` | Pass (0 problems) |
| `npm run typecheck` | Pass |
| `npm test` (`vitest run`) | **Pass: 71 files, 1,145 tests, 58 s** |
| `npm audit --omit=dev` | 5 moderate (Sentry bundler-plugin chain; minimatch GHSA-g3hv-75wg-m249) |
| `npm run build` | Not run in this audit (last passes recorded in history) |

Layers: Vitest unit/action tests with recording Supabase double (`src/test/db-mock.ts`), Testing Library component tests, **PGlite DB tests running every migration** with stub auth/storage (`supabase/tests/helpers.ts`: `createHarness`, `asUser`, `reset` with users alice/bob/carol/dave/admin), guard tests (`src/lib/api-protection.test.ts`, `src/proxy.test.ts`), seed tests. Live dev checks: `npm run seed:verify` (62 checks), `npm run db:audit`. **Missing:** E2E/browser automation, coverage, formatter, pre-commit hooks, CI, a11y and performance tests. New tables must be added to `h.reset()` and `database.types.ts` by hand.

## 9. Security and permission boundaries

Strong application security model (RLS + definer RPCs + audit, no service-role key, zod everywhere, DB-enforced limits, scrubbed logging, security headers minus CSP, anonymity isolation tested by a leakage sweep). Risks for autonomy: **owner-level `SUPABASE_ACCESS_TOKEN` in `.env.local`**; `VERIFICATION_SECRET` and seed passwords on disk; possibly a real kept account in dev data (`SEED_KEEP_EMAILS`); push = deploy; destructive scripts (`db:reset:dev`, `seed:wipe`) runnable by any agent with Bash; no sandbox on Windows; no deny rules. Recommended boundaries: deny secret paths; scoped dev-only token in CI; agents write migrations but only CI applies them to dev and only humans approve production; feature branches/worktrees with PR gates; human sign-off for auth/RLS/`private`/anonymity/verification/legal-copy changes; no new vendors, paid services or dependencies without approval.

## 10. Infrastructure and deployment

Local dev → hosted dev Supabase; Netlify preview/branch deploys described; no staging; "production" Netlify site uses dev DB; no production project or domain. Build `npm run build` on Node 22. Env var names: see `10` §3 (no values recorded). Rollback = Netlify "Publish deploy"; DB forward-only. Smoke test = manual `curl` checklist + `/api/health`. Safe to automate: CI gates, previews, preview smoke tests, dev migrations via scoped CI token, docs. Human-approved: production promotion, production migrations, DNS/domain, secrets, accounts, paid services.

## 11. Autonomy readiness

Automation maturity **Level 1/5** (agent-assisted, human-triggered). Cannot run with the PC off today. Missing: task queue, locks, retries, CI, budget/concurrency controls, emergency stop, observability, product cron jobs. Best path given existing GitHub + Netlify: GitHub Actions with `claude-code-action` (scheduled + PR + issue triggers) plus CI, optionally cloud routines; Agent SDK runner only if a custom orchestrator is needed (needs API key and hosting). Cost exposure: model tokens × agents, Actions and Netlify build minutes, cloud routine usage, future monitoring services.

## 12. Recommended agent organisation (recommendation)

Orchestrator (permanent) · Product & roadmap steward (weekly) · Full-stack feature engineer ×1-3 (on demand; matches feature-module layout) · Database & RLS engineer (mandatory for migrations) · QA incl. browser/E2E (per PR) · Security & privacy reviewer (per sensitive PR + weekly) · Code reviewer (per PR; pick one of the three review tools) · DevOps/release (Netlify, CI, migration ordering) · Documentation steward · Maintenance & incident engineer (daily). Not separate: UX (fold into feature engineer with brand rules), performance, integration, compliance (human lawyer). Workflow designs for feature dev, bug fix, review, tests, regression, security audit, migrations, dependencies, docs, previews, production release, incidents, debt, roadmap, session recovery are in `12` §4, with readiness and approval points.

## 13. Gap analysis (top items; full table in `13`)

Critical: G1 owner-level DB token reachable by agents · G2 no CI gate · G3 no safe branch/release model · G4 no permission boundaries/sandbox. High: G5 no persistent backlog/locks · G6 no unattended execution · G7 no independent review · G8 migrations decoupled from deploys · G9 no E2E · G10 no observability · G11 no project-specific agents/skills · G12 no budget/concurrency/kill switch. Medium: hot shared files, stale docs, unknown DB parity, no dependency flow, no `gh`/GitHub MCP, no Netlify control, unscheduled product jobs, OneDrive location, `.claude/` git-ignored. Low: irrelevant skills loaded, no coverage/formatter, small product debt.

## 14. Owner decisions needed (full list in `14`)

Token revocation · autonomy level per action · branch model (`main` as production?) · budget caps · where agents run (PC vs cloud vs Actions) · frequency · notification channel · approved services and tokens (GitHub, Netlify, Sentry, Upstash, Resend, Playwright) · model per role · next roadmap item vs launch blockers · launch region/French UI · minors · invite-only · business model · professional verification/SheerID · `forum_identity` disclosure and retention · moderation staffing · retention periods · legal review timing · production infra/backups/domain · auto-merge tolerance · human-only paths · dependency/plugin installation policy · removing irrelevant skills · versioning `.claude/` · Playwright and coverage · security sign-off owner.

## 15. Key paths

`CLAUDE.md` · `README.md` · `PRODUCTION_READINESS.md` · `DEPLOYMENT.md` · `TESTING.md` · `OBSERVABILITY.md` · `ARCHITECTURE.md` · `DATABASE_AUDIT.md` · `docs/verification/` · `src/proxy.ts` · `src/lib/auth/session.ts` · `src/lib/rate-limit.ts` · `src/lib/supabase/database.types.ts` · `src/lib/api-protection.test.ts` · `src/features/` · `supabase/migrations/` · `supabase/tests/helpers.ts` · `scripts/seed/` · `netlify.toml` · `next.config.ts` · `vitest.config.mts` · `.claude/launch.json` · `.agents/skills/` · `skills-lock.json` · `.env.example`.
