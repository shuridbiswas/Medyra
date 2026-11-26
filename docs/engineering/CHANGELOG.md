# Engineering changelog

## 2026-11-26 — Usage governor

- Added the subscription usage governor (`USAGE_GOVERNOR.md`): weekly 25 % paced by day, five-hour 10 % with 7/8/9 % thresholds, strict account protection by default, subscription only, fail closed without fresh telemetry. Supersedes the USD budget as the execution authority.
- Telemetry from Claude Code's documented status line `rate_limits` fields (verified in 2.1.330); `npm run usage:*` commands; admission enforced in `eng cycle`, the slice runner and the GitHub workflow (API key input removed).
- 35 synthetic tests (`scripts/engineering/governor.test.ts`). Database engineer defaults to Sonnet. Owner-only tightening in `scripts/engineering/usage/apply-owner-patch.mjs` (not yet applied).
- Headless CLI is not signed in on the founder's machine; whether headless slices refresh telemetry is unverified. Not activated.

## 2026-11-26 — Autonomous engineering system (bootstrap)

- Added ten `medyra-*` subagents, seventeen `medyra-*` skills, project settings with deny rules and a fail-closed PreToolUse guard hook; `.gitignore` now versions only this configuration under `.claude/`.
- Added the deterministic orchestrator (`npm run eng -- …`), task backlog (39 tasks), owner-only control, approvals and policy files, spend ledger and run records.
- Added gates: secret scan, applied-migration lock (15 files baselined), HTTP smoke test.
- Added workflows: `ci` (deterministic), `autonomous-development` (manual, gated), `maintenance` (read-only), `preview-validation`, `dev-migration` (protected environment), `production-release` (disabled).
- Ran the controlled trial on FEAT-001 (stale right-rail copy); see `TRIAL_REPORT.md`.
- Nothing pushed, deployed or activated.
