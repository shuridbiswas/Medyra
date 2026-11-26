# Skills and plugin registry

Approved capabilities for the autonomous system. "CI" means available on a fresh GitHub runner from the repository alone; the CI runner never depends on machine-local plugins.

## Project skills (versioned in `.claude/skills/medyra-*`, available in Desktop and CI)

Source: this repository. Version: the commit that contains them. Security review: written in-house; contain no scripts or network calls. All 17 loaded successfully by Claude Code on 2026-11-26 (the runtime listed them after creation).

| Skill | Purpose | Assigned agents |
| --- | --- | --- |
| medyra-orchestration | Run one bounded cycle through the engine | orchestrator |
| medyra-task-recovery | Resume from durable records | orchestrator, maintenance |
| medyra-feature-development | House pattern for feature modules | feature, maintenance |
| medyra-db-migration | Safe migrations, grants, types, harness, recovery plan | database |
| medyra-rls-security | RLS, grants, definer RPC review | database, security |
| medyra-anonymity-review | forum_identity disclosure paths | security, database, QA |
| medyra-verification | Verification states and evidence protection | security, feature, database |
| medyra-privacy-review | Privacy by design, counsel questions | security |
| medyra-honest-limits | Claims match implemented capability | all copy-writing and reviewing agents |
| medyra-browser-testing | Smoke now, Playwright later, synthetic data | QA |
| medyra-design-system | Brand and accessibility rules | feature, code reviewer |
| medyra-localisation | EN/FR where implemented | feature, docs |
| medyra-netlify-release | Deploy validation, never production | devops, QA |
| medyra-incident-recovery | Safe investigation and remediation | maintenance, devops |
| medyra-seed-safety | Dev-data scripts are human-only | all |
| medyra-documentation | One source per fact, evidence-backed numbers | docs, product |
| medyra-quality-gates | Gates, commands, evidence rules | all |

## Third-party skills referenced (read as files, not loaded into agents)

| Skill | Source / pin | Use | Desktop | CI |
| --- | --- | --- | --- | --- |
| supabase-postgres-best-practices | supabase/agent-skills, hash in `skills-lock.json`, committed under `.agents/skills/` | Deep references cited by medyra-db-migration | yes | yes (committed files) |
| supabase | supabase/agent-skills (same) | Security checklist background | yes | yes (files) |
| web-design-guidelines, vercel-react-best-practices, vercel-composition-patterns, writing-guidelines | vercel-labs/agent-skills (hashes in `skills-lock.json`) | Optional reading for design, React and prose; their Vercel deployment parts do not apply | yes | yes (files) |

`.claude/skills/<third-party>` entries are local symlinks into `.agents/skills/` and stay git-ignored; agents reference the committed `.agents/skills/` files by path, which works on Windows and Linux.

## Primary mechanisms (one each)

| Need | Primary | Not used for the system (duplicates) |
| --- | --- | --- |
| Code review | `medyra-code-reviewer` (+ medyra-quality-gates) | bundled `code-review`, `superpowers:requesting-code-review`, `ponytail-review` |
| Security review | `medyra-security-reviewer` (+ rls/anonymity/privacy/verification skills) | bundled `security-review`, plugin `*:security-auditor` agents |
| Test automation | Vitest + PGlite (existing) via `medyra-qa-engineer`; Playwright pending QA-001 | plugin `*:test-automator` agents |

## Founder's installed plugins (inspected 2026-11-26, not uninstalled, not loaded by the system)

| Plugin | Version (commit) | Decision |
| --- | --- | --- |
| superpowers@claude-plugins-official | 7.0.2 (22f0b463e7a5) | Process ideas adopted into medyra-orchestration (plans, worktrees, TDD, verification); not a runtime dependency |
| ponytail@ponytail | 5.3.3 (96608e078b2d) | Founder's interactive style; not loaded in CI |
| javascript-typescript@claude-code-workflows | 1.2.3 (0874a27b17a2) | Not needed |
| backend-development@claude-code-workflows | 1.3.2 (0874a27b17a2) | Excluded (GraphQL, Temporal, event sourcing irrelevant) |
| full-stack-orchestration@claude-code-workflows | 1.3.1 (0874a27b17a2) | Excluded (duplicate reviewers) |
| ui-ux-pro-max@ui-ux-pro-max-skill | 2.15.0 (28b3b8dee8c9) | Not loaded; medyra-design-system holds Medyra's own rules |
| watch@claude-video | 0.2.0 (83da59fa78c3) | Excluded |

Excluded from the unattended environment: Vercel deployment/token skills, React Native, GraphQL, Temporal, event sourcing, Apify, travel, video/HyperFrames/brag, Google Drive, personal browser sessions (Claude in Chrome), computer use. The CI runner has none of them because they are not in the repository. No new plugin, skill or MCP server was installed.

## Installation

Nothing to install: project skills and agents load from the checkout. If GitHub Issues become canonical, a GitHub App or token is configured as a secret, not as a plugin.
