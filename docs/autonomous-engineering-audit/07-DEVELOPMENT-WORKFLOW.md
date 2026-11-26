# 07 · Current development workflow

Reconstructed from git history, repository docs and the Claude Code session transcripts that produced the recent phases. Where a step relies on session observation rather than files, it is marked *(observed in sessions)*.

## 1. How work happens today

| Step | Current practice | Automated? |
| --- | --- | --- |
| Feature requests | The owner pastes a long "MEDYRA \| PHASE N" prompt into a Claude Code session (desktop app, Code tab) *(observed in sessions)*. Earlier phase prompts are not stored in the repo. | No |
| Requirements storage | Summarised by the agent into `CLAUDE.md` per phase, plus README sections and `docs/verification/*`. No issue tracker. | Partly (agent writes docs) |
| Task selection | Owner chooses the next phase; within a session the agent plans with the app's task list (`update_plan`) | No |
| Planning | In-session; no written plan files or ADRs (except `ARCHITECTURE.md`) | No |
| Branches | None created: all work committed directly to `dev` | — |
| Implementation | One Claude Code session writes migration → PGlite tests → feature code → pages → tests → docs | Agent-driven, human-initiated |
| Code review | None independent. The implementing agent self-reviews; occasional user questions. No PRs. | No |
| Tests | Agent runs `npm run lint`, `typecheck`, `test`, `build` locally before finishing (rule in `CLAUDE.md`) | Manual trigger |
| Bug fixing | Found by tests or the owner; fixed in the same session | No |
| Merging | `git commit` on `dev` when the owner says "commit"; `git push origin dev` when they say "push" | No |
| Documentation | Agent updates `CLAUDE.md`, README, TESTING.md, PRODUCTION_READINESS.md, phase docs | Agent-driven |
| Deployment | Push to GitHub → Netlify builds automatically; migrations applied separately and manually (often later) | Partly |
| Validation of completed features | PGlite + unit tests; occasional live checks on dev via scripts (`seed:verify`, `db:audit`) and the in-app browser; no E2E | Partly |
| Session resumption | Claude Code conversation summaries/compaction and `CLAUDE.md` carry context; no persistent task file or memory directory for this project | No |
| Claude Code usage | Desktop app Code tab on Windows; single long sessions; plugins (superpowers, ponytail, workflows) loaded; built-in browser used for previews; occasional linked side sessions exist (4 idle linked sessions listed by the app) | — |

## 2. Already automated

- Netlify build on push.
- Database triggers for notifications, audit logs, rate limits (product-level automation).
- Guard tests that encode architecture rules (route registry, session gates, admin gates).
- Dev data lifecycle scripts (`seed:*`, `db:*`) with safety locks (`SEED_ALLOWED_PROJECT_REF`, `SEED_PROTECTED_PROJECT_REFS`).
- Agent-maintained documentation per phase.

## 3. Manual steps that block autonomy

1. Starting every piece of work requires the owner to open a session and paste requirements.
2. No backlog file: the agent cannot pick the next task.
3. Commit and push wait for explicit owner words.
4. Migrations reach the dev database only when someone runs them (with a personal token).
5. No CI: correctness depends on the last local run.
6. No independent reviewer; security-sensitive SQL is reviewed only by its author.
7. Live/browser verification is ad hoc.
8. New tables must be added by hand to `h.reset()` in `supabase/tests/helpers.ts` and to `src/lib/supabase/database.types.ts`.
9. Report/doc sprawl: readiness addenda and per-phase notes are appended manually and drift (README test count, roadmap numbering, stale "upcoming" copy).

## 4. Recurring bottlenecks (observed)

- Very long single sessions with context compaction; facts re-derived after compaction.
- Code shipped before migrations applied (Phase 6/7 pushed while migrations pending), so the live site can show errors on new pages.
- Shared files touched by every phase (`database.types.ts`, `rate-limit.ts`, `proxy.ts` prefix list, `notifications/format.ts`, `submit_report`/`moderate_report` re-created in each migration). These are merge-conflict hot spots for parallel agents.
- Re-creating `public.submit_report` / `public.moderate_report` and re-granting the whole `private` helper list in every migration is a repeated, error-prone pattern.
