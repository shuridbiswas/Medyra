# Usage governor

Keeps Medyra's autonomous agents inside a share of the founder's Claude subscription: at most **25 % of the weekly allowance** (paced through the week) and **10 % of each five-hour allowance**, leaving about 75 % and 90 % for personal use. It supersedes the USD budget in `COST_POLICY.md` as the authority for autonomous execution. No paid usage, no API billing fallback.

Status: **implemented and tested with synthetic telemetry; not activated.** Unattended execution stays off until the activation checklist below is complete.

## What Claude Code actually exposes (verified 2026-11-26)

| Capability | Finding | Source |
| --- | --- | --- |
| Five-hour and weekly usage % | `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` (0–100), **account-wide** | Status line docs; present in Claude Code 2.1.330 on this machine |
| Reset times | `rate_limits.*.resets_at`, Unix epoch seconds | Status line docs |
| Availability | Only for Pro/Max/Ultra subscribers, only after the first API response in a session | Status line docs |
| When it refreshes | After each assistant message (and a few other triggers), debounced 300 ms | Status line docs |
| Model-specific limits | Not in the status line. Claude Code has an internal, explicitly experimental usage structure with `seven_day_opus/sonnet`; not used | Binary inspection |
| Status line in headless `claude -p` | **Not documented; unverified** (probe stopped at sign-in, see below) | Probe |
| Subscription headless execution | Bundled CLI reported **"Not logged in"**: headless runs cannot use the subscription on this machine yet | Probe (one refused request, no usage) |
| API key inherited | No: `apiKeySource: none`; no API key, auth token, Bedrock/Vertex/Foundry variables, no `apiKeyHelper` | Probe, `usage:doctor` |
| Headless usage events | `--output-format stream-json` has a `rate_limit_event`; its shape is internal, so not used | Binary inspection |
| Cloud scheduling on the subscription | Not used: GitHub runners have no status line telemetry, so the governor refuses there | Design |

Context-window size, token counts and `total_cost_usd` are **not** subscription usage and are never used as such.

## How it works

```
status line (any interactive Claude Code session)          Windows Task Scheduler, every 15 min
  └─ usage/statusline-capture.mjs ──► ~/.medyra/usage-snapshot.json      └─ npm run usage:tick  (no AI)
                                                     │                              │
                         engineering/governor.json ──┼──► admission controller ◄────┘
                engineering/.local/usage-ledger.json ┘     (lib/governor.ts)
                                                              │ admitted
                                                              ▼
                     usage/cli.ts run: claim/resume task ─► one bounded headless slice (claude -p,
                     subscription only, --max-turns 30, 30 min) ─► record, checkpoint, wait for fresh telemetry
```

- **Telemetry adapter:** `scripts/engineering/usage/statusline-capture.mjs` is a status line command. It writes only the two documented windows to `~/.medyra/usage-snapshot.json` (outside the repository). Several sessions may report out of order, so within one window it keeps the highest reading.
- **Admission controller** (`scripts/engineering/lib/governor.ts`, `admit`). It checks the following in this order of authority, records every failure, and admits only when none fail:
  1. emergency stop
  2. paid usage: API keys or provider variables, or extra usage not confirmed off by the owner
  3. authorization
  4. telemetry present, ≤ 15 min old, taken after the last slice settled, and its window not already past reset
  5. weekly budget
  6. weekly pacing
  7. shared-account protection
  8. five-hour budget
  9. model policy
  10. one AI request at a time
  11. task approved
- **Every AI path uses it:**
  - `npm run eng -- cycle --mode manual|scheduled`
  - the runner, before claiming and again before starting a slice, under the state lock
  - the GitHub workflow (`usage:admit`)
- **Weekly pacing:**
  - The allowance so far is `25 % × day / 7`, where day 1–7 is counted from the real weekly `resets_at` minus 7 days.
  - Unused allowance carries forward within the week only.
  - A five-hour reset never reopens an exhausted week.
- **Five-hour safeguard:**
  - Warning at 7 %.
  - No new task at 8 %.
  - No slice when usage plus the slice estimate would exceed 9 %.
  - 10 % is the ceiling.
  - Every reading is treated as 0.5 points higher, because it may be rounded.
- **Slice estimate:** 2 % of the five-hour allowance and 0.5 % of the week until slices have been observed. After that it is the largest observed slice × 1.25, never lower than the configured estimate.
- **Accounting modes:**
  - **A, strict account protection (default):** all account usage counts against the agents, your own included. Medyra pauses whenever you use Claude heavily. This is the intended trade-off.
  - **B, estimated attribution:** the agents are charged for the increase across each slice, including any personal use during it, plus account-wide back-off at 75 % weekly and 60 % five-hour. This mode only takes effect when you set `estimatedAttributionAuthorizedByOwner: true`. It is an estimate, never exact.
- **Ledger:**
  - Stored in `engineering/.local/usage-ledger.json`, git-ignored because it holds personal figures. It records slices, before and after readings, attribution and confidence, pauses, resumes, anomalies and the last decision.
  - Writes are atomic and made under the engineering mutex.
  - Each slice is settled exactly once.
  - A corrupted ledger makes the governor refuse to run (fail closed); it is never silently reset.
- **Scheduler:** `usage:tick` is deterministic and never calls Claude. It does the following:
  1. Settles slices and closes vanished ones.
  2. Decides and records a pause or resume, only when the state changes.
  3. Holds the active task's claim until the next eligible time, so a pause never spends a retry.
  4. Launches the runner if admitted and `control.autonomy.scheduleEnabled` is true.

  The next eligible time is computed from the real reset times. It only permits re-checking, because fresh telemetry is still required.
- **Checkpoint and resume:**
  - Each slice tells the orchestrator to checkpoint and commit after every completed step.
  - The runner records a checkpoint when a slice ends.
  - The next slice resumes the same Claude session (`--resume`) and the same run, using the recovery skill. It does not redo completed phases or reviews that are still valid.
- **Bypass prevention:**
  - Config literals enforce your policy (25 / 10 ceilings, billing flags, no carry-over, fail-closed), so loosening them fails validation.
  - The slice environment drops API keys, provider switches, `ANTHROPIC_BASE_URL` and owner mode.
  - The owner patch below forbids agents `claude -p`, the runner, the scheduler, resume and configure, and makes `governor.json` owner-only.

## Commands (none uses Claude except `usage:run`)

| Command | Purpose |
| --- | --- |
| `npm run usage:status` | State, account and agent usage, pacing, resets, next eligible time, active slice, task, checkpoint, pause reasons, paid-usage status |
| `npm run usage:report` | Usage section (also included in `npm run eng -- report`; hidden in GitHub Actions) |
| `npm run usage:pause -- --reason "…"` / `usage:resume` | Owner pause; resume clears only that pause |
| `npm run usage:configure [-- --set key=value]` | Show or change `governor.json` within the ceilings |
| `npm run usage:dry-run` | Full admission decision, no side effects |
| `npm run usage:admit` | Exit code only (CI-safe, prints codes, never figures) |
| `npm run usage:doctor [-- --probe]` | Setup checks; `--probe` spends one tiny Haiku request to test headless telemetry |
| `npm run usage:tick` | Scheduler step |
| `npm run usage:run -- --execute` | One admitted slice (needs `MEDYRA_CLAUDE_BIN`) |
| `npm run agents:status` | Task and agent state from the orchestrator |

### Example (synthetic telemetry, day 4)

```
Autonomous execution:   PAUSED
Accounting mode:        strict-account-protection
Five-hour (account):    4.00%   resets 2026-11-26 17:00 UTC
Weekly (account):       9.00%   resets 2026-11-30 00:00 UTC
Five-hour (agents):     4.50% of 10% (warn 7, wind-down 8, stop 9)
Weekly (agents):        9.50% of 25%
Weekly pacing:          day 4, allowance so far 14.29%, remaining 4.79%
Slice estimate:         2.00% five-hour, 0.50% weekly
Telemetry:              5 min old; attribution no slices observed yet
Next eligible:          needs the owner
Current task:           none
Pause reasons:          TASK: no approved task is eligible
Additional paid usage:  prohibited (API fallback off; extra usage confirmed off by owner 2026-11-24)
```

## Setup (owner)

1. **Owner patch.** From your own terminal, not through Claude, run `node scripts/engineering/usage/apply-owner-patch.mjs`. It makes these changes, all of which only tighten rules:
   - makes `governor.json` owner-only
   - hides the ledger and snapshot from agents
   - forbids agents `claude -p`, the runner, the scheduler, resume and configure
   - routes the database engineer to Sonnet by default

   Review the result with `git diff`, then commit.
2. **Status line capture.** Add the capture to your **user** settings (`~/.claude/settings.json`), so every Claude Code session you open refreshes the telemetry. The path is absolute to this repository:
   ```json
   { "statusLine": { "type": "command", "command": "node \"C:/Users/SXB79/OneDrive - Acuity Brands, Inc/Documents/Medoras/scripts/engineering/usage/statusline-capture.mjs\"" } }
   ```
   Open the Claude Code CLI, send one message, then run `npm run usage:doctor`. "usage snapshot present" should now pass. The desktop app's Code tab may not run status lines; the CLI does.
3. **Extra usage off.** Check claude.ai → Settings → Usage, and make sure extra usage or overage is off. Then record the date with `npm run usage:configure -- --set billing.extraUsageDisabledConfirmedAt=2026-11-26T00:00:00Z`.
4. **Headless sign-in.**
   - Install the Claude Code CLI, or set `MEDYRA_CLAUDE_BIN` to the desktop app's bundled `claude.exe`. That path changes with each update.
   - Run `claude` once and `/login` with your subscription account. Never set `ANTHROPIC_API_KEY`.
   - Then run `npm run usage:doctor -- --probe`. It makes one small Haiku request and reports whether headless slices refresh telemetry.

## Activation

The governor has to be proven before anything runs unattended. Do these in order:
1. Run `npm run usage:doctor`. Every check must pass, including "execution authorized", which needs `control.autonomy.executionEnabled: true` (an owner-only file).
2. The probe must answer **YES** (headless refreshes telemetry). If it answers NO, slices still run, but each one waits until you next use Claude Code interactively. Unattended operation then stalls safely, and that is the correct, conservative outcome.
3. Approve exactly one task (`engineering/approvals.json`). Run `npm run usage:dry-run`, then `npm run usage:run -- --execute` once while watching, then run `npm run usage:status` and `git log`.
4. Set `control.autonomy.scheduleEnabled: true`. Register the scheduler in Windows Task Scheduler: every 15 minutes, start in the repository folder, run `npm run usage:tick`, and tick "Run only when user is logged on". Subscription execution needs this machine on and signed in. Nothing runs while it is off.

## Pause and recovery

- **Stop now:** `npm run usage:pause -- --reason "…"`, or `"paused": true` in `control.json`, or `MEDYRA_AUTONOMY_PAUSED=true`. Disable the scheduled task to stop ticks entirely. A slice already running finishes within its 30-minute limit and leaves a checkpoint.
- **Resume:** `npm run usage:resume`. The governor still waits for fresh telemetry and available allowance.
- **Crash or reboot:** an unfinished slice is closed as interrupted when its lease passes. The task keeps its claim through governor pauses and is recovered by `npm run eng -- recover` only if its lease truly expired.
- **Corrupted ledger:** the governor refuses to run. Inspect `engineering/.local/usage-ledger.json`, move it aside to start fresh, and run `usage:status`.

## Known limitations

- Figures are account-wide, delayed and possibly rounded, so attribution is an estimate. Strict mode avoids relying on attribution by counting everything.
- No documented per-model limits exist. The model policy (Opus only for security-sensitive work) is a rule, not a measurement. Subagents inside a slice use their own configured models.
- A slice cannot be stopped mid-way on usage. It is bounded by turns and time, and the slice estimate leaves room below the 10 % ceiling.
- Whether headless runs refresh telemetry is unverified until the CLI is signed in (`usage:doctor -- --probe`).
- Extra-usage status cannot be read by any supported means. It relies on your recorded check.
- GitHub Actions has no telemetry, so the autonomous workflow is always refused. That is the intended behaviour.
