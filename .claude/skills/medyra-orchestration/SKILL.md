---
name: medyra-orchestration
description: "Run one bounded Medyra engineering cycle through the deterministic orchestrator: preflight, recover, claim, brief, delegate, record evidence, transition, stop. Use when coordinating any backlog task."
---

# medyra-orchestration

## Purpose and triggers
Run one bounded Medyra engineering cycle through the deterministic orchestrator: preflight, recover, claim, brief, delegate, record evidence, transition, stop. Use when coordinating any backlog task.

**Agents:** medyra-orchestrator

**Required inputs:** Mode (dry-run, manual, scheduled); the repository at a clean commit; engineering/*.json.

## Workflow
1. `npm run eng -- preflight --mode <mode>`; stop on any reason (pause, activation, budget).
2. `npm run eng -- recover` to release expired leases (idempotent).
3. `npm run eng -- cycle --mode <mode>`: claims at most one eligible task and writes `engineering/runs/<runId>.brief.md`. In dry-run nothing is written.
4. Create the run's branch from `baseSha`; `npm run eng -- checkpoint --run <id> --note "plan"` after planning.
5. Delegate to the agents the brief lists; after each, record the handoff (`handoff --run <id> --file <json>`), the new commit (`commit --task --sha --branch`) and each executed gate (`gate --run --gate --result --sha --detail`).
6. Move state only with `transition`; the engine refuses moves that lack approvals, reviews or evidence.
7. Run code review and QA (and security review when required) on the exact SHA; record with `review`.
8. Stop after `maxTasksPerCycle` tasks, `maxCycleMinutes`, budget exhaustion, pause, or no eligible work.

## Usage governor (subscription allowance)
- Every real run is admitted by the usage governor (`npm run usage:dry-run` shows why not). You work inside one bounded slice: checkpoint and commit after each completed step so the slice can end at any turn without losing work.
- Activate only the roles the task needs. Reuse recorded evidence: never re-run a review or gate that already holds for the unchanged commit. Prefer scripts (tests, lint, build, status) over model reasoning for anything deterministic.
- Never launch another Claude session, `claude -p`, cloud task or external AI service, and never change governor or usage files (`engineering/governor.json`, `engineering/.local/`).

## Medyra invariants
- Deterministic code decides eligibility, claims, transitions, budget and gates; models never override it.
- The orchestrator never reviews or approves its own implementation.
- One active implementation at a time unless control.json raises the limit; never two tasks on serialized paths.
- Approved requirements and agent proposals stay distinct; only engineering/approvals.json (owner) authorizes execution.

## Validation
`npm run eng -- validate`, `npm run eng -- status`, `npm run eng -- next`

## Required evidence
Run record `engineering/runs/<runId>.json` with checkpoints, handoffs, gates and reviews for the final SHA.

## Prohibited
Editing engineering/backlog.json by hand; editing control/approvals/policy; merging without the required approval; starting a new cycle from inside a cycle.

## Failure handling
On a refusal from the engine, record a checkpoint with the message and either transition to BLOCKED (with a blocker) or FAILED; then select unrelated eligible work. After maxRemediationAttempts failures the task stays FAILED for a human.

## Output contract
A run record plus a handoff JSON block (HandoffSchema) from the orchestrator summarizing the cycle.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
