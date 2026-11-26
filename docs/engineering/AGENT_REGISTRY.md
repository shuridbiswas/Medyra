# Agent registry

All definitions live in `.claude/agents/` (versioned). Frontmatter fields used are those documented for Claude Code subagents (`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`). No `memory` is configured: durable memory is `engineering/`, not per-agent memory directories, so unattended runners need nothing machine-local. No agent relies on experimental Agent Teams.

| Agent | Role | Model (alias) | Mode | Turns | Tools (denied) | Skills |
| --- | --- | --- | --- | --- | --- | --- |
| medyra-orchestrator | CTO / coordinator; runs one bounded cycle via the engine | sonnet (opus for complex planning via control.json) | default | 60 | Read, Grep, Glob, Bash, Agent, Edit, Write (WebFetch, WebSearch) | orchestration, task-recovery, quality-gates |
| medyra-product-steward | Stories, acceptance criteria, roadmap, decision list | sonnet | default | 30 | Read, Grep, Glob, Edit, Write (Bash, Web*, Agent) | documentation, honest-limits |
| medyra-feature-engineer | Full-stack feature modules | sonnet | acceptEdits | 80 | Read, Grep, Glob, Edit, Write, Bash (WebSearch, Agent) | feature-development, design-system, honest-limits, localisation, quality-gates |
| medyra-database-engineer | Migrations, RLS, grants, RPCs, types, PGlite | opus | acceptEdits | 80 | Read, Grep, Glob, Edit, Write, Bash (WebSearch, Agent) | db-migration, rls-security, anonymity-review, quality-gates |
| medyra-qa-engineer | Independent acceptance, tests, smoke/browser | sonnet | acceptEdits | 50 | Read, Grep, Glob, Bash, Edit, Write (WebSearch, Agent) | browser-testing, quality-gates, anonymity-review |
| medyra-security-reviewer | Independent security/privacy review, PASS/BLOCK | opus | plan (read-only) | 40 | Read, Grep, Glob, Bash (Edit, Write, NotebookEdit, Web*, Agent) | rls-security, anonymity-review, privacy-review, verification, honest-limits |
| medyra-code-reviewer | Independent code review of one exact SHA | sonnet | plan (read-only) | 30 | Read, Grep, Glob, Bash (Edit, Write, NotebookEdit, Web*, Agent) | quality-gates, design-system, honest-limits |
| medyra-devops-engineer | CI, Netlify validation, release evidence | sonnet | acceptEdits | 50 | Read, Grep, Glob, Edit, Write, Bash (WebSearch, Agent) | netlify-release, quality-gates, incident-recovery |
| medyra-documentation-steward | Docs, changelog, evidence-backed numbers | haiku | acceptEdits | 25 | Read, Grep, Glob, Edit, Write (Bash, Web*, Agent) | documentation, honest-limits |
| medyra-maintenance-engineer | CI failures, advisories, regressions, debt | sonnet | acceptEdits | 60 | Read, Grep, Glob, Edit, Write, Bash (WebSearch, Agent) | incident-recovery, quality-gates, task-recovery |

## Invocation and isolation

- The orchestrator is the only agent with the `Agent` tool; specialists cannot spawn further agents (bounded recursion).
- Implementers work on the run's branch. Interactive parallel work on this Windows/OneDrive checkout should use `claude -w <name>` worktrees outside OneDrive or the cloud runner; unattended work runs on GitHub-hosted Linux runners.
- Independence: reviews are recorded by role against an exact SHA; the engine refuses reviews from non-review roles, ignores reviews of older commits, and requires code + QA (+ security when sensitive) before `READY_TO_MERGE`. An agent review is never a GitHub human approval.

## Handoff contract

Every agent ends with a JSON block matching `HandoffSchema` (`scripts/engineering/lib/model.ts`): run id, task id, role, input/output SHA, files modified, decisions, tests executed, per-gate evidence with PASSED/FAILED/NOT_APPLICABLE/NOT_EXECUTED/BLOCKED, review findings (severity, file, line, finding, remediation), unresolved issues, next action, status and verdict. `npm run eng -- handoff --run <id> --file <json>` validates and stores it; invalid output is refused.

## Generic plugin agents (not used by the system)

`backend-development:*`, `full-stack-orchestration:*`, `javascript-typescript:*` remain installed for the founder's interactive use. The medyra-* agents replace them for engineering work to avoid duplicated reviewers and irrelevant capabilities (GraphQL, Temporal, event sourcing).
