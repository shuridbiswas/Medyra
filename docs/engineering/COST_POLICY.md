# Cost policy

> **Superseded for autonomous execution (2026-11-26):** the subscription usage governor (`USAGE_GOVERNOR.md`) is now the authority: 25 % of the weekly allowance (paced), 10 % of each five-hour allowance, subscription only, no API billing and no extra usage. The USD limits below remain in `control.json` as an inert secondary check; API keys are refused, so no USD spend should occur.

Recurring execution is **disabled**. The numbers below are proposed safety limits from the founder's instruction, recorded in `engineering/control.json`; they are not authorization to spend money.

| Limit | Proposed |
| --- | --- |
| Simultaneous implementation tasks | 1 |
| Remediation attempts per failed task | 2 |
| Tasks per scheduled cycle | 1 |
| Minutes per cycle | 45 (`timeout-minutes` in the workflow) |
| Estimated API spend per run | 5 USD (`--max-budget-usd`) |
| Per day | 10 USD |
| Per month | 100 USD |

## How it is enforced

- `preflight` refuses a new run unless `min(day remaining, month remaining) ≥ per-run limit`, using `engineering/usage.json`.
- The execute job passes `--max-budget-usd` to Claude Code. **This is a client-side estimate, not a guaranteed provider-side cap.**
- After each run the ledger records the per-run cap as a conservative `estimated` entry, because the action's exact cost output is not parsed yet. Billed amounts, when entered by the owner, are recorded as `billed`. Reports label which is which.
- For a hard ceiling, use provider-side controls: Anthropic Console workspace spend limits for API keys, or plan limits for subscription OAuth tokens. These must be set by the owner.
- Missing or unreadable usage data stops execution (the ledger file must validate).

## Where spend comes from

Model tokens (more agents per task cost more; reviewers run only when needed), GitHub Actions minutes, Netlify build minutes (every pushed branch builds), and future services (Sentry, Upstash, Resend, Playwright browsers in CI). Deterministic scripts replace model calls for selection, validation, gates and reports.

## Model routing (`control.json` → `models`)

Orchestrator sonnet (opus for complex planning), product steward sonnet, feature engineer sonnet, database engineer opus, QA sonnet, security reviewer opus, code reviewer sonnet, devops sonnet, documentation haiku, maintenance sonnet. Aliases are the documented `sonnet` / `opus` / `haiku`.
