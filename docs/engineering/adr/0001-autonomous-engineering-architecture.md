# ADR 0001: Autonomous engineering architecture

Status: accepted (bootstrap), 2026-11-26. Activation pending owner decisions.

## Context

Medyra was developed by a single human-prompted Claude Desktop session on Windows, with no CI, no task queue, a personal access token in `.env.local`, and `dev`/`main` histories unrelated. The founder asked for a persistent, self-correcting, multi-agent system that keeps humans for consequential decisions.

## Decision

1. **Deterministic engine in TypeScript** (`scripts/engineering/`), run with Node's type stripping (no new dependency), owns eligibility, claims with leases, state transitions, budget, pause, and review/gate evidence per commit. Models implement and review; they do not enforce.
2. **File-based durable state** (`engineering/*.json`), validated with zod, written atomically under a mutex; in CI persisted to an `engineering-state` branch. GitHub Issues become canonical later (OPS-003) via a one-way migration so there is never more than one queue.
3. **Ten project subagents and seventeen project skills**, versioned in `.claude/`, loaded explicitly; no dependency on the founder's plugins or on experimental Agent Teams.
4. **GitHub Actions as the single unattended scheduler**, with the official `anthropics/claude-code-action` pinned by SHA; deterministic CI separate from AI workflows; all privileged jobs behind protected environments and repository-variable kill switches.
5. **Layered permissions:** environment isolation first, then GitHub permissions, Claude Code deny rules, a fail-closed PreToolUse guard hook reading one policy file, and engine refusals.
6. **Dependency-free gates now** (secret scan, migration lock, HTTP smoke); Playwright, axe and coverage wait for dependency approval.

## Consequences

- Works with today's stack and machine; nothing runs unattended until the owner completes the activation checklist.
- One implementation at a time is slow but safe; concurrency can rise to two after the trial (ENG-007).
- String-matching hook rules can be bypassed by creative commands; the real boundary is that unattended runners hold no secrets.
- Spend limits are estimates unless provider-side limits are configured.

## Alternatives considered

Claude Agent SDK runner on a server (more control, needs hosting and an API key; possible later); cloud routines as scheduler (plan-dependent, research preview, no budget flag; would compete with Actions, so not used); GitHub Issues as the queue from day one (blocked: no GitHub credential for agents).
