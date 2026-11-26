# 12 · Recommended agent organisation (recommendations only)

Derived from this project's actual architecture: one Next.js app, SQL-heavy security model (RLS + definer RPCs), PGlite tests, no CI, Netlify auto-deploys, strict honest-limits and anonymity invariants. The roster is deliberately small; roles that would only re-run the same checks are merged. None of these agents exists today (see `06`).

## 1. Roster

| Agent | Permanent / on demand | Why Medyra needs it | Reuses |
| --- | --- | --- | --- |
| **Orchestrator** | Permanent (scheduled) | Picks backlog items, writes the task brief, assigns work to worktrees, enforces gates, records state | `superpowers:writing-plans`, `dispatching-parallel-agents`, `using-git-worktrees`; app `start_session` / headless runner |
| **Product & roadmap steward** | On demand (weekly) | Keeps `CLAUDE.md` roadmap/backlog coherent (today it conflicts), turns owner prompts into stories with acceptance criteria, flags decisions for the owner | `writing-guidelines` |
| **Full-stack feature engineer** (1-3 parallel instances) | On demand | Implements features end to end following the house pattern (migration → PGlite test → schemas/queries/actions → components → pages → docs). Splitting frontend/backend would fight the feature-module layout | `vercel-react-best-practices`, `javascript-typescript` agents |
| **Database & RLS engineer** | On demand, mandatory for any `supabase/migrations/*` change | Owns migrations, `private` grant re-list, definer RPCs, `h.reset()` and types upkeep, migration application to dev | `supabase`, `supabase-postgres-best-practices` |
| **QA engineer** (incl. browser testing) | Per PR | Writes/updates Vitest + PGlite tests, adds Playwright E2E (missing), runs preview smoke tests with the built-in browser | `test-automator`, `superpowers:test-driven-development`, Claude_Browser |
| **Security & privacy reviewer** | Per PR touching auth, RLS, `private`, verification, anonymity, uploads, legal copy; weekly sweep | Independent review of the most failure-sensitive code; checks invariants in `CLAUDE.md` (no service-role key, no identity leaks, honest-limits statements) | `security-review`, `security-auditor` (one only), `supabase` checklist |
| **Code reviewer** | Per PR | Correctness, simplicity, house conventions; separate from the author | bundled `code-review` or `ponytail-review` (pick one) |
| **DevOps / release engineer** | On demand + scheduled checks | CI workflows, Netlify preview checks, migration-before-deploy ordering, `/api/health` checks, dependency updates, rollback runbook | `deployment-engineer` (Netlify, not Vercel) |
| **Documentation steward** | Per merged PR (light) | Keeps README, TESTING.md, PRODUCTION_READINESS.md, feature docs and test counts current | `writing-guidelines`, `humanizer` |
| **Maintenance & incident engineer** | Scheduled (daily) + on alert | Triage failures (CI, Sentry once enabled, uptime), dependency/audit fixes, technical-debt items | `superpowers:systematic-debugging` |

Not recommended as separate agents now: UX/UI specialist (fold into feature engineer with `web-design-guidelines` + brand rules), performance engineer (on-demand task type, little load yet), integration specialist (vendor work is blocked on contracts), compliance specialist (needs a human lawyer; security reviewer flags legal-copy changes for human review).

## 2. Per-agent contract

| Agent | Inputs | Outputs | Tools / permissions | Depends on |
| --- | --- | --- | --- | --- |
| Orchestrator | Backlog file, CI status, owner decisions | Task briefs, assignments, status log | Read repo, create branches/worktrees, start sessions; **no** merge to protected branches without gate; no secrets | All |
| Product steward | Owner prompts, `CLAUDE.md`, backlog | Stories, acceptance criteria, decision requests | Edit docs only | Owner |
| Feature engineer | Brief + acceptance criteria | Branch with code, tests, docs | Edit `src/**`, `supabase/**` (migrations new files only), run local tests; no network secrets, no `.env.local` | DB engineer, QA, reviewers |
| DB & RLS engineer | Schema needs | New migration, PGlite tests, `database.types.ts`, `helpers.ts` reset list | Edit `supabase/**`, types; apply to **dev** only via CI job with scoped token | Security reviewer |
| QA | Branch | Tests, E2E specs, preview report | Run tests, browser on previews; no prod | Feature/DB |
| Security reviewer | Diff + invariants list | Pass/block report with findings | Read-only | — |
| Code reviewer | Diff | Review comments, pass/block | Read-only | — |
| DevOps | CI/deploy events | Workflows, smoke results, release notes | Edit `.github/`, `netlify.toml` (with review); trigger previews; **no** production promote | Owner for prod |
| Docs steward | Merged diffs | Doc updates | Edit `*.md` (not legal pages without human) | — |
| Maintenance | Alerts, audit, debt list | Fix branches, triage notes | Same as feature engineer | Reviewers |

## 3. Cadence

Per PR: code reviewer, QA, security reviewer (conditional), docs steward. Daily: maintenance (CI health, `npm audit`, stale branches), orchestrator backlog pass. Weekly: product steward roadmap sync, security sweep of RLS/`private` grants, dependency update batch. On demand: feature/DB engineers, DevOps for releases.

## 4. Autonomous workflow recommendations

Readiness: **R** ready now · **N** needs gaps closed (see `13`) · **B** blocked on owner decision.

| Workflow | Trigger | Agents | Inputs → outputs | Quality gates | Failure / retry | Human approval | Readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Feature development | Backlog item marked ready | Orchestrator → feature engineer (+DB engineer) → QA → code + security review → docs | Story + acceptance criteria → PR with code, tests, docs | lint, typecheck, test, build; PGlite tests for SQL; review pass; preview smoke | Retry once after fix; then park with notes | Merge to integration (decision); prod release | N (G2-G5, G7) |
| Bug fixing | CI failure, alert, bug report | Maintenance → reviewer | Repro → failing test → fix PR | Same + regression test | 2 attempts then escalate | Same as feature | N |
| Code review | PR opened/updated | Code reviewer (+ security reviewer when paths match) | Diff → verdict + comments | Invariants checklist from `CLAUDE.md` | Re-review on push | None for review itself | N (G7, G17) |
| Test generation | New code without tests; weekly | QA | Coverage gaps → tests | Tests must fail before fix where applicable | — | None | R (locally) |
| Regression testing | Every PR + nightly | CI | Branch → results | Full suite + E2E (when added) | Auto re-run flaky once | None | N (G2, G9) |
| Security audit | Paths: `supabase/migrations`, `src/lib/auth`, `src/proxy.ts`, verification, forums identity; weekly sweep | Security reviewer | Diff / whole schema → findings | No new definer function without `auth.uid()`/admin check; `private` re-grant list; no identity joins; no secrets | Block merge | Human sign-off on auth/RLS changes | N |
| Database migrations | Migration file merged | DB engineer → DevOps | Migration → applied to dev → parity report | PGlite tests; never edit applied files; types + `h.reset()` updated | Forward fix only | Production: always | N (G1, G8) |
| Dependency updates | Weekly | Maintenance | Outdated/audit → update PR | Full gates | Revert PR | Major versions | N (G16) |
| Documentation updates | PR merged | Docs steward | Diff → doc edits | Writing guidelines; legal pages excluded | — | Legal/policy text | R |
| Staging (preview) deployments | PR | Netlify (automatic) + QA smoke | Preview URL → smoke report | `/api/health`, redirects, E2E | Rebuild once | None | R (previews) / N (smoke) |
| Production releases | Owner request | DevOps | Release notes, migration plan → promotion | All gates + prod migration plan + checklist `DEPLOYMENT.md` §5 | Netlify rollback | **Always** | B (G3, no prod project) |
| Monitoring and incident investigation | Sentry/uptime alert | Maintenance | Alert → triage note, fix PR | — | Escalate after 1 h | Prod actions | N (G10) |
| Technical-debt management | Weekly | Maintenance + orchestrator | Debt list (`04` §5) → small PRs | Full gates | — | None | R |
| Roadmap progression | Weekly / backlog empty | Product steward | Roadmap → next stories + decision requests | Owner decisions recorded | — | New features need owner approval | B (`14`) |
| Session recovery | Agent crash / context loss | Orchestrator | Task state file + branch → resumed work | Task state persisted after each step | Resume from last commit | None | N (G5) |
