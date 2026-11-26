# Session recovery

A brand-new Claude session (or runner) continues work from files, not from earlier conversations.

## Start of any session

```bash
npm run eng -- status     # pause, activation, active claims, budget
npm run eng -- report     # done, in progress, blocked, decisions, next eligible work
npm run eng -- recover    # releases expired leases (idempotent; counts a retry)
```

Then open `engineering/runs/<runId>.json` for each active task: `checkpoints` (last state and note), `nextAction`, `handoffs`, `gates`, and the task's `branch`/`commitSha` in `engineering/backlog.json`. In CI, state lives on the `engineering-state` branch; fetch it first (`git checkout origin/engineering-state -- engineering/`).

## Scenarios

| Situation | Recovery |
| --- | --- |
| Context compaction / new session | Read the run record; continue from `nextAction`. Follow the medyra-task-recovery skill. |
| Runner cancelled or crashed | The claim's lease expires (`claimTtlMinutes`, 90). `recover` returns the task to READY and counts a retry; after `maxRemediationAttempts` it becomes FAILED for a human. |
| Network failure mid-run | Re-run the cycle; claims and transitions are idempotent under the mutex; evidence for the same SHA is reused. |
| Invalid agent output | `handoff` refuses it with schema errors; re-prompt once; then FAILED with the errors. |
| Failed tests | Gate recorded FAILED; task back to IMPLEMENTING within the retry limit. |
| Merge conflict | Rebase in a fresh checkout; new SHA invalidates reviews and gates; re-run them. |
| Two runners racing | CI `concurrency: medyra-autonomy` serializes runs; `push-state.sh` never force-pushes, so a stale writer fails instead of overwriting. Locally `engineering/.mutex` serializes writers. |
| Budget exhausted | `preflight` stops new runs; nothing else to do until the period resets or the owner changes limits. |
| Missing credentials | Task marked BLOCKED with the missing item; the orchestrator selects unrelated work. |
| Failed preview | preview-smoke FAILED; maintenance task; no promotion. |

Never: force-push, delete run records, reset retry counts, or edit `engineering/backlog.json` by hand.
