# Engineering changelog

## 2026-11-26 — Autonomous engineering system (bootstrap)

- Added ten `medyra-*` subagents, seventeen `medyra-*` skills, project settings with deny rules and a fail-closed PreToolUse guard hook; `.gitignore` now versions only this configuration under `.claude/`.
- Added the deterministic orchestrator (`npm run eng -- …`), task backlog (39 tasks), owner-only control, approvals and policy files, spend ledger and run records.
- Added gates: secret scan, applied-migration lock (15 files baselined), HTTP smoke test.
- Added workflows: `ci` (deterministic), `autonomous-development` (manual, gated), `maintenance` (read-only), `preview-validation`, `dev-migration` (protected environment), `production-release` (disabled).
- Ran the controlled trial on FEAT-001 (stale right-rail copy); see `TRIAL_REPORT.md`.
- Nothing pushed, deployed or activated.
