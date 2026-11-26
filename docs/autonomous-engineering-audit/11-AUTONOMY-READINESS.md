# 11 · Autonomous and continuous operation readiness

Classification: **Configured** (available and set up) · **Available, not configured** · **Needs authorization** (account, token or approval) · **Paid** (needs a paid plan or service) · **Unsupported** · **Unknown**. Doc claims cite the official pages listed in `05` (checked 2026-11-25).

## 1. Capability matrix

| Mechanism | Status | Notes |
| --- | --- | --- |
| Interactive desktop sessions (current practice) | Configured | Needs the PC on and a human to start each session |
| Desktop scheduled tasks | Available, not configured | Run on the local machine; PC must be on (docs) |
| Session `/loop`, CronCreate | Available, not configured | Only while a session is open and idle; expire after 30 days |
| Claude Code cloud sessions | Unknown → Paid | Plan-dependent (Pro/Max/Team/Enterprise); continue with laptop closed |
| Cloud routines (scheduled, API, GitHub triggers) | Unknown → Paid, research preview | Min 1 h interval; run on Anthropic cloud; no documented budget flag |
| Headless `claude -p` | Available, not configured | CLI must be installed; `--max-turns`, `--max-budget-usd` (estimate) |
| Claude Agent SDK | Available, not configured; needs API key | For a custom orchestrator/runner |
| GitHub Actions + `claude-code-action` | Available, not configured; needs authorization | Needs `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` secret, workflows, and write access; runs with PC off; GitHub minutes may cost |
| Webhooks (routine API trigger, GitHub events) | Available, not configured | — |
| External orchestration / persistent runner (server, VM, container) | Not configured; Paid | Docker installed locally but unused |
| Agent teams | Available (experimental), not enabled | Interactive only; not for headless |
| Git worktree isolation | Available, not configured | OneDrive location is a risk for many worktrees |
| Task queue persistence | **Missing** | No backlog file, issue tracker or queue |
| Execution locks | **Missing** | Nothing prevents two agents taking one task or touching the same hot files |
| Retries / failure recovery | **Missing** | No CI to re-run; no retry policy |
| Checkpointing | Partial | `/rewind` covers file edits only; DB/deploy actions are not reversible; git commits are the real checkpoints |
| Session recovery | Partial | `--resume`/`--continue`, compaction summaries, `CLAUDE.md`; no handoff file |
| Budget controls | Not configured | Client-side estimates only; org/Console limits Unknown |
| Concurrency controls | Not configured | — |
| Emergency stop | **Missing** | Only manual: stop sessions, disable workflows, revoke tokens, `MFA_ENFORCEMENT=off` is an app-level switch, not an agent switch |
| Product background jobs | **Missing** | Retention, credential expiry, evidence deletion are not scheduled |

## 2. Can work continue with the owner's PC off?

**Not today.** Everything depends on the desktop app on this PC. It becomes possible with any of: (a) GitHub Actions + `claude-code-action` (needs token secret and workflows), (b) cloud routines/sessions (plan-dependent), or (c) an Agent SDK runner on a server (API key + hosting). Option (a) fits best with the existing GitHub + Netlify setup and gives CI at the same time.

## 3. Readiness score (audit judgement)

| Dimension | Level |
| --- | --- |
| Code base testability | High (1,145 fast, deterministic tests; PGlite DB tests; guard tests) |
| Conventions documented for agents | High (`CLAUDE.md`) |
| Isolation and safety rails | Low (no permission rules, no sandbox on Windows, PAT in `.env.local`) |
| Orchestration and persistence | None |
| CI / quality gate | None |
| Deployment safety | Low (push = deploy; migrations decoupled; `main` unrelated) |
| Observability | None configured |
| **Overall automation maturity** | **Level 1 of 5: agent-assisted, human-triggered** |

## 4. Cost exposure

Model tokens (multiple agents multiply spend; teams roughly proportional to team size), GitHub Actions minutes, Netlify build minutes (every push builds), cloud routines (plan usage), future Sentry/Upstash/Resend/Pinecone tiers, Playwright browsers in CI, a server for a persistent runner. No current spend controls are configured.
