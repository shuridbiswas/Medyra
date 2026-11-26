# Medyra autonomous engineering system

Status (2026-11-26): **built and validated locally; not activated.** Unattended execution is off (`engineering/control.json`), no workflow has run on GitHub yet, and no credentials for agents exist. The activation checklist below lists exactly what the founder must do.

## How it works

```
founder ──approvals.json / control.json (owner-only)──┐
                                                       ▼
 backlog.json ─► orchestrator.ts (deterministic) ─► claim + brief ─► medyra-orchestrator (Claude)
                  │  pause · budget · eligibility           │  delegates to specialists
                  │  claims/leases · transitions            ▼
                  │  review + gate evidence per SHA   feature / database / devops / maintenance engineer
                  │                                         │
                  └◄── handoffs, gates, reviews ◄── QA · code reviewer · security reviewer (independent)
                                                            │
                                    branch + PR ─► ci.yml (no AI) ─► owner approval ─► dev
```

- **Deterministic authority.** `scripts/engineering/orchestrator.ts` and `lib/engine.ts` decide what may run, who holds a task, which state changes are legal, whether reviews and gates cover the exact commit, and whether budget and pause allow work. Models only plan, implement and review.
- **Durable state.** `engineering/backlog.json` (tasks), `engineering/runs/<runId>.json` (checkpoints, handoffs, gate and review evidence), `engineering/usage.json` (spend ledger). In CI the state is pushed to the `engineering-state` branch after every claim and run (`scripts/engineering/push-state.sh`), so a new runner or a new Claude session resumes from records, never from chat history.
- **Owner-only control.** `engineering/approvals.json` (what may execute, integrate, migrate, change security), `engineering/control.json` (pause, activation flags, limits, models), `engineering/policy.json` (protected paths, forbidden commands, mandatory gates). The guard hook and CODEOWNERS keep agents out of them.
- **Isolation.** One implementation task at a time; serialized paths (migrations, shared types, PGlite harness, rate limits, proxy, notification formatting, safety RPCs, CI, deploy config, engine) are never touched by two active tasks. Agents work on `agent/<task>-<id>` branches; unattended runs execute on GitHub's Linux runners, not in the OneDrive folder.

## Components

| Piece | Location |
| --- | --- |
| Agents (10) | `.claude/agents/medyra-*.md`, registry `AGENT_REGISTRY.md` |
| Skills (17) | `.claude/skills/medyra-*/SKILL.md`, registry `SKILLS_REGISTRY.md` |
| Settings, deny rules, guard hook | `.claude/settings.json`, `.claude/hooks/pre-tool-guard.mjs`, `PERMISSION_POLICY.md` |
| Engine and CLI | `scripts/engineering/{orchestrator.ts,lib/}`; `npm run eng -- <command>` |
| Gates | `npm run eng:secrets`, `npm run eng:migrations` (+ `engineering/migrations.lock.json`), `npm run eng:smoke`, `QUALITY_GATES.md` |
| Workflows | `.github/workflows/{ci,autonomous-development,maintenance,preview-validation,dev-migration,production-release}.yml` |
| Tests | `scripts/engineering/engine.test.ts` (failure injection, hook, gates) |
| Browser plan | `tests/e2e/PLAN.md` (Playwright pending approval) |

## Sources of truth

| Information | Canonical home |
| --- | --- |
| Product and engineering rules | `CLAUDE.md` |
| Epics and roadmap status | `docs/engineering/ROADMAP.md` |
| Task state | `engineering/backlog.json` (until migrated to GitHub Issues, task OPS-003) |
| Run evidence | `engineering/runs/*.json`, CI run summaries |
| Owner authorizations | `engineering/approvals.json`, `engineering/control.json`, `docs/engineering/OWNER_DECISIONS.md` |
| Release blockers | `PRODUCTION_READINESS.md` |
| Consequential technical decisions | `docs/engineering/adr/` |
| Operations | `INCIDENT_RUNBOOK.md`, `EMERGENCY_STOP.md`, `SESSION_RECOVERY.md`, `RELEASE_POLICY.md` |

## Operating commands

```bash
npm run eng -- status            # pause, activation, counts, budget
npm run eng -- report            # daily-style report (Markdown)
npm run eng -- next              # what would run next and why others cannot
npm run eng -- cycle             # dry run: plans, changes nothing
npm run eng -- validate          # schema-check every state file and run record
```

## Activation checklist (founder)

Recurring or unattended execution stays off until every item is done (task ENG-006).

1. [ ] Rotate the Supabase personal access token in `.env.local`; create a dev-only scoped token (SEC-001).
2. [ ] Push the bootstrap branch and open a PR to `dev`; confirm `ci.yml` runs green (ENG-003).
3. [ ] Decide the branch model and apply branch protection with required CI and code-owner review (OPS-001, OPS-004; `SETUP_GUIDE.md`).
4. [ ] Add `.github/CODEOWNERS` from `SETUP_GUIDE.md` (agents are blocked from writing it).
5. [ ] Confirm Netlify production branch and which database each context uses (OPS-002).
6. [ ] Choose the agent credential: GitHub App or fine-grained token (OPS-003). Add `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` to the `autonomy` environment with yourself as required reviewer.
7. [ ] Approve the budget in `engineering/control.json` (proposed 5/10/100 USD per run/day/month) and set provider-side limits in the Anthropic Console if using an API key.
8. [ ] Set repository variables `MEDYRA_AUTONOMY_PAUSED=false`, `MEDYRA_AUTONOMY_ENABLED=true`; set `executionEnabled: true` in `control.json`.
9. [ ] Run `autonomous-development` with `mode=dry-run`, then `mode=manual` once, and review the PR and evidence.
10. [ ] Test the pause: set `MEDYRA_AUTONOMY_PAUSED=true` and confirm the next run stops (`EMERGENCY_STOP.md`).
11. [ ] Only then uncomment the schedule and set `scheduleEnabled: true`.

## Proposed operating rhythm (after activation)

Every 6 h one backlog cycle · every PR deterministic CI · every relevant PR QA and code review, plus security review when sensitive · daily maintenance report · weekly roadmap sync and dependency review. All bounded by `control.json` limits.
