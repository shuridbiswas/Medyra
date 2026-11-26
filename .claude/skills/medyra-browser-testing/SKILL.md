---
name: medyra-browser-testing
description: "Plan and run Medyra browser and smoke tests with synthetic data: HTTP smoke checks now, Playwright journeys once approved, the Claude in-app browser for interactive checks. Use for QA of UI changes and preview validation."
---

# medyra-browser-testing

## Purpose and triggers
Plan and run Medyra browser and smoke tests with synthetic data: HTTP smoke checks now, Playwright journeys once approved, the Claude in-app browser for interactive checks. Use for QA of UI changes and preview validation.

**Agents:** medyra-qa-engineer

**Required inputs:** Brief and acceptance criteria; a local dev server or a preview URL; synthetic accounts only.

## Workflow
1. Deployed site: `npm run eng:smoke -- <url> --expect-env <preview|production>` (read-only GETs).
2. Locally: `npm run dev` (port 3000, see .claude/launch.json); in Claude Desktop use the built-in browser pane, never the founder's Chrome sessions.
3. Journeys and priorities: tests/e2e/PLAN.md. Until Playwright is approved (task QA-001), record browser gates as NOT_EXECUTED, not PASSED.
4. Check desktop, tablet and mobile widths, keyboard navigation, focus, labels and error messages for the changed screens.
5. Traces, screenshots and videos must not contain real member data; use synthetic accounts and disable video on authenticated flows.

## Medyra invariants
- Never use the retained real dev account or production.
- Never sign in with real credentials.

## Validation
`npm run eng:smoke -- <url>`; component tests `npx vitest run <paths>`.

## Required evidence
Smoke JSON output or test results for the exact commit and URL.

## Prohibited
Installing Playwright browsers or packages without approval.

## Failure handling
A failed smoke check blocks preview validation; report the failing check and response code.

## Output contract
Handoff JSON with browser/preview-smoke gate results.

Canonical rules: `CLAUDE.md`; system: `docs/engineering/AUTONOMOUS_ENGINEERING.md`.
