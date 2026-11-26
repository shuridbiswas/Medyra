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
| Usage governor | `scripts/engineering/{lib/governor.ts,usage/}`, `engineering/governor.json`; `npm run usage:<command>`; `USAGE_GOVERNOR.md` |
| Tests | `scripts/engineering/engine.test.ts` (failure injection, hook, gates), `scripts/engineering/governor.test.ts` (usage governor, synthetic telemetry) |
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
npm run usage:status             # subscription usage, pacing, next eligible time (no AI)
```

**Usage authority.** The usage governor (`USAGE_GOVERNOR.md`) admits every AI run: at most 25 % of the weekly subscription allowance (paced by day) and 10 % of each five-hour allowance, subscription only, failing closed without fresh telemetry. It supersedes the USD limits in `control.json` and `COST_POLICY.md`.

## Activation checklist (founder)

Recurring or unattended execution stays off until every item is done (task ENG-006).

1. [ ] Rotate the Supabase personal access token in `.env.local`; create a dev-only scoped token (SEC-001).
2. [ ] Push the bootstrap branch and open a PR to `dev`; confirm `ci.yml` runs green (ENG-003).
3. [ ] Decide the branch model and apply branch protection with required CI and code-owner review (OPS-001, OPS-004; `SETUP_GUIDE.md`).
4. [ ] Add `.github/CODEOWNERS` from `SETUP_GUIDE.md` (agents are blocked from writing it).
5. [ ] Confirm Netlify production branch and which database each context uses (OPS-002).
6. [ ] Choose the agent's GitHub credential: GitHub App or fine-grained token (OPS-003). No API key: API billing is prohibited.
7. [ ] Usage governor setup (`USAGE_GOVERNOR.md` § Setup): run the owner patch, add the status line capture, record that claude.ai extra usage is off, and sign in the headless CLI with your subscription; `npm run usage:doctor` all PASS, and `-- --probe` reports whether headless slices refresh telemetry.
8. [ ] Set `executionEnabled: true` in `control.json` (and the repository variables `MEDYRA_AUTONOMY_PAUSED=false`, `MEDYRA_AUTONOMY_ENABLED=true` if you also want the GitHub workflow, which the governor refuses until it has telemetry).
9. [ ] Run `npm run usage:dry-run`, then one watched slice `npm run usage:run -- --execute`, and review the branch and evidence.
10. [ ] Test the pause: `npm run usage:pause` and `MEDYRA_AUTONOMY_PAUSED=true` must each stop the next slice (`EMERGENCY_STOP.md`).
11. [ ] Only then set `scheduleEnabled: true` and register `npm run usage:tick` every 15 minutes in Windows Task Scheduler.

## Proposed operating rhythm (after activation)

A deterministic tick every 15 minutes; a bounded slice whenever the usage governor admits one (pacing spreads about 3.6 % of the weekly allowance per day) · every PR deterministic CI · every relevant PR QA and code review, plus security review when sensitive · weekly roadmap sync and dependency review. All bounded by the usage governor and `control.json`.
