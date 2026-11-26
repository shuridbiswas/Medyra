---
name: medyra-task-recovery
description: "Resume Medyra engineering work after context compaction, a crashed or cancelled runner, network failure, invalid agent output, merge conflicts, stale claims or budget exhaustion, using only durable records. Use at the start of any session that continues earlier work."
---

# medyra-task-recovery

## Purpose and triggers
Resume Medyra engineering work after context compaction, a crashed or cancelled runner, network failure, invalid agent output, merge conflicts, stale claims or budget exhaustion, using only durable records. Use at the start of any session that continues earlier work.

**Agents:** medyra-orchestrator, medyra-maintenance-engineer

**Required inputs:** engineering/backlog.json, engineering/runs/*.json, the git branch named in the run record.

## Workflow
1. `npm run eng -- status` and `npm run eng -- report` to see active claims and blockers.
2. For each active task, open its run record: read the last checkpoint, `nextAction`, last commit SHA and recorded gates.
3. If the lease expired, `npm run eng -- recover` returns it to READY (retry counted). If still leased by this run, continue from `nextAction`.
4. Check out the run branch; confirm HEAD equals the task's `commitSha`. If not, record a checkpoint: evidence for older SHAs is stale and must be re-run.
5. Re-run only the gates that are missing or stale for the current SHA (evidence for the same SHA is reused).
6. Merge conflicts: rebase the task branch on the current base in a fresh checkout, re-run every gate, invalidate reviews (new SHA).
7. Invalid agent output: re-prompt once with the validation errors; on a second failure record the task FAILED with the schema errors.

## Medyra invariants
- Never rely on chat history; the run record is the source of truth.
- Recovery is idempotent: running it twice changes nothing the second time.

## Validation
`npm run eng -- validate`; `git rev-parse HEAD` against the task's commitSha.

## Required evidence
A checkpoint note naming what was recovered and which gates were re-run.

## Prohibited
Force-pushing to recover; deleting run records; resetting retry counts.

## Failure handling
If state and git disagree in a way you cannot explain, transition to BLOCKED with a precise blocker and stop.

## Output contract
Checkpoint entries and a handoff JSON block with status PARTIAL or COMPLETE.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
