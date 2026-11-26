# 06 · Agents, skills, plugins and MCP integrations

Inventory sources: `.claude/`, `.agents/`, `skills-lock.json`, `~/.claude/settings.json` (enabled plugins and marketplaces, values summarised), `~/.claude/plugins/installed_plugins.json`, `~/.claude/skills/`, and the capability list the Claude desktop app exposed to this session (2026-11-25). Nothing was installed or enabled.

## 1. Project-level agents

**None.** There is no `.claude/agents/` directory and no project agent definition. `.claude/` is git-ignored (`.gitignore` line `.claude/`), so any project Claude configuration is machine-local and not versioned.

## 2. Agent types available to sessions (from installed plugins and built-ins)

| Agent | Source | Role | Tools | Model | Relevance |
| --- | --- | --- | --- | --- | --- |
| general-purpose, Explore (read-only), Plan (read-only), claude-code-guide, statusline-setup, fork | Built into Claude Code | Research, search, planning, docs Q&A, forked context | Varies (Explore/Plan cannot edit) | Inherit | High (Explore/Plan for discovery) |
| web-fetch | Desktop app | Fetch public pages | WebFetch | — | Medium |
| backend-development:{backend-architect, graphql-architect, performance-engineer, security-auditor, tdd-orchestrator, test-automator, event-sourcing-architect, temporal-python-pro} | Plugin `backend-development@claude-code-workflows` (wshobson/agents) | Generic backend roles | All tools | Plugin-defined (not inspected) | security-auditor, test-automator, performance-engineer relevant; graphql, event-sourcing, temporal-python not relevant (no GraphQL, no event sourcing, no Python) |
| full-stack-orchestration:{deployment-engineer, performance-engineer, security-auditor, test-automator} | Plugin `full-stack-orchestration@claude-code-workflows` | Generic full-stack roles | All tools | — | Overlaps backend-development (two security-auditors, two test-automators, two performance-engineers) |
| javascript-typescript:{javascript-pro, typescript-pro} | Plugin `javascript-typescript@claude-code-workflows` | Language specialists | All tools | — | Medium |
| apify:apify | Plugin (account-level) | Web scraping | Bash, mcp__apify | — | Low |

None of these is project-specific: none knows Medyra's RLS conventions, `private` schema grant rule, anonymity invariants, PGlite harness or honest-limits copy rules. They have no memory configuration and no persistent assignments.

## 3. Skills inventory

### 3a. Project skills (`.claude/skills/`, 16; 11 are symlinks into `.agents/skills/`, which **is** committed; versions pinned by hash in `skills-lock.json`)

| Skill | Source repo | Purpose | Relevance to Medyra |
| --- | --- | --- | --- |
| supabase | supabase/agent-skills | Supabase products, CLI, MCP, RLS security checklist | **High** |
| supabase-postgres-best-practices | supabase/agent-skills | Postgres schema, RLS, indexes, performance | **High** |
| vercel-react-best-practices | vercel-labs/agent-skills | React/Next performance | High (Next.js 16) |
| vercel-composition-patterns | vercel-labs/agent-skills | React composition | Medium |
| vercel-react-view-transitions | vercel-labs/agent-skills | View transitions | Low |
| web-design-guidelines | vercel-labs/agent-skills | UI guideline review | Medium (a11y/design review) |
| writing-guidelines | vercel-labs/agent-skills | Prose review | Medium (docs, honest copy) |
| deploy-to-vercel, vercel-cli-with-tokens, vercel-optimize | vercel-labs/agent-skills | Vercel deployment/cost | **Not relevant** (host is Netlify); risk of wrong-platform actions |
| vercel-react-native-skills | vercel-labs/agent-skills | React Native | Not relevant |
| brag | latent-spaces/brag | Launch video from the site | Low (produced `brag-output/`) |
| hyperframes, hyperframes-cli, hyperframes-registry, media-use | heygen-com/hyperframes | Video creation | Not relevant to engineering |

### 3b. User skills (`~/.claude/skills/`): `find-skills`, `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`.

### 3c. Plugin skills (enabled in `~/.claude/settings.json`)

| Plugin (marketplace) | Skills / commands | Relevance |
| --- | --- | --- |
| superpowers (claude-plugins-official) | brainstorming, writing-plans, executing-plans, subagent-driven-development, dispatching-parallel-agents, test-driven-development, systematic-debugging, verification-before-completion, requesting/receiving-code-review, using-git-worktrees, finishing-a-development-branch, writing-skills, diagnosing-superpowers; SessionStart hook injecting "using-superpowers" | **High**: ready-made process skills for planning, parallel agents, worktrees, TDD, review |
| ponytail (ponytail) | ponytail (lite/full/ultra), ponytail-audit, ponytail-review, ponytail-debt, ponytail-gain, ponytail-help; SessionStart hook; statusline script | Medium (minimal-change discipline, review/audit) |
| backend-development (claude-code-workflows) | feature-development, api-design-principles, architecture-patterns, cqrs, event-store, microservices, projection, saga, temporal, workflow-orchestration | Low-medium (mostly irrelevant patterns) |
| full-stack-orchestration | full-stack-feature | Medium |
| javascript-typescript | javascript-testing-patterns, modern-javascript-patterns, nodejs-backend-patterns, typescript-advanced-types, typescript-scaffold | Medium |
| ui-ux-pro-max (ui-ux-pro-max-skill) | ui-ux-pro-max, design, design-system, brand, ui-styling, slides, banner-design | Medium (design work; must respect Medyra brand rules) |
| watch (claude-video) | watch (video understanding) | Low |

Also visible to sessions but **not** in `~/.claude/settings.json` (account- or app-level): `humanizer`, `apify` (5 skills), `travel-planner`, Anthropic built-ins (`docs`, `docx`, `pdf`, `pptx`, `xlsx`, `deep-research`, `google-workspace`, `skill-creator`, `consolidate-memory`, `morning`, …), and bundled Claude Code skills (`code-review`, `simplify`, `security-review`, `init`, `run`, `loop`, `schedule`, `fewer-permission-prompts`, `update-config`, `claude-api`, `plugin-authoring`, artifact skills, `dataviz`).

### 3d. Overlaps and gaps

- Overlap: three code-review paths (bundled `code-review`, `superpowers:requesting-code-review`, `ponytail-review`); two security auditors; two test automators; two performance engineers.
- Irrelevant but active: Vercel deployment skills (wrong host), video skills, React Native, GraphQL/event-sourcing/Temporal agents.
- **Missing project-specific skills** (recommended, not installed): Medyra migration authoring (private-schema re-grant, `h.reset()`, types update, PGlite test); RLS/anonymity invariant review; Netlify deploy + smoke check; honest-limits/legal copy guard; seed/dev-DB safety; Playwright E2E for Medyra flows; release checklist from `PRODUCTION_READINESS.md`.

## 4. Plugins and marketplaces

Installed and enabled (7): `watch@claude-video`, `full-stack-orchestration@claude-code-workflows`, `javascript-typescript@claude-code-workflows`, `backend-development@claude-code-workflows`, `superpowers@claude-plugins-official`, `ui-ux-pro-max@ui-ux-pro-max-skill`, `ponytail@ponytail`.
Marketplaces (5): `claude-plugins-official` (anthropics), `claude-video` (bradautomates), `claude-code-workflows` (wshobson/agents), `ui-ux-pro-max-skill` (nextlevelbuilder), `ponytail` (DietrichGebert). Plugin versions: not recorded in the files inspected (Unknown).

## 5. Hooks and commands

- Project: none (`.claude/settings.json` absent).
- User: none in `~/.claude/settings.json`; plugin-provided **SessionStart** hooks from superpowers and ponytail (observed injecting context at session start).
- Custom commands: none in `.claude/commands` or `~/.claude/commands`.

## 6. MCP and external integrations

**No `.mcp.json` in the project.** All MCP servers available to sessions come from the Claude desktop app or the user's account:

| Server | Purpose | Read/write | Relevance | Concern |
| --- | --- | --- | --- | --- |
| Claude_Browser (built-in browser pane) | Browser automation, dev-server preview (`preview_start` reads `.claude/launch.json`) | Read + interact | **High** for UI verification | Uses the user's in-app sign-ins |
| claude-in-chrome | Drives the user's real Chrome | Read + interact | Medium | Real sessions/cookies |
| computer-use | Desktop control | Full | Low | High blast radius |
| ccd_session / ccd_pr / ccd_settings / ccd_view / ccd_window / ccd_sidebar / ccd_host | Desktop app: start/hand off sessions, PR binding & CI monitoring, settings, layout | Write (app state) | **High** for orchestration (parallel sessions, PR monitoring) | App-only; not available headless |
| scheduled-tasks | Create/list/run scheduled tasks | Write | **High** for recurring work | Runs on the desktop app (machine must be on; verify) |
| terminal | Read/run in user's terminal tabs | Write | Medium | — |
| visualize | Inline widgets | — | Low | — |
| mcp-registry | Discover connectors | Read | Low | — |
| Docs connector, Google Drive, Perplexity | Docs, Drive files, web research | Read/write | Low-medium (research) | Account data |
| Apify | Scraping | — | Low | **Failed to load** this session |

Capability check:

| Capability | Available now? |
| --- | --- |
| GitHub repo management | Partial: `git` CLI with the user's credentials; **no `gh` CLI, no GitHub MCP** |
| GitHub issues | No |
| Pull requests | Partial: app's `ccd_pr` tools can bind/monitor a PR, but creating PRs needs `gh` or GitHub access (not installed) |
| Browser automation | Yes (built-in browser, Chrome) |
| Framework docs retrieval | Yes (Next.js docs bundled in `node_modules/next/dist/docs/`; web-fetch agent; claude-code-guide) |
| Database inspection | Partial: scripts using the PAT (`db:audit`); no Supabase MCP configured; `npx supabase` not installed globally (npx prints a notice) |
| Migration management | Partial: `npm run db:migrate` (PAT) |
| Hosting/deployment management | No (no Netlify CLI/MCP/token); deploys only via git push |
| Error monitoring | No (Sentry not configured) |
| Infrastructure monitoring | No |
| Project management | No |
| Automated notifications | App notifications/push only (`PushNotification` deferred tool); no Slack/email |
| Web research | Yes (web-fetch agent, Perplexity, docs) |
