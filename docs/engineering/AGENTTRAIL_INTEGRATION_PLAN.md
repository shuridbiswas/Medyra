# Agenttrail integration plan

Status: **proposal, not installed.** This plan covers Agenttrail (MIT, v0.4.1) as Medyra's local, read-only engineering dashboard. Evidence levels match `OPEN_SOURCE_FRAMEWORK_EVALUATION.md`:
- **[src]**: read in source code.
- **[doc]**: README or docs only.
- **[unverified]**: could not be confirmed.

## 1. Compatibility assessment

| Question | Finding |
| --- | --- |
| Model calls, account, cloud | None [doc]; outbound requests go only to other local boards [src summary] |
| Claude Code sessions | Reads `~/.claude/projects` transcripts (`CLAUDE_CONFIG_DIR` honoured), but only files touched in the last 2 h, at most their last 2 MiB [doc]. This machine's Code tab sessions write to `C:\Users\SXB79\.claude\projects\C--Users-SXB79-OneDrive---…-Medoras\`, so the desktop app is observable in principle. How Agenttrail encodes project paths is [unverified] |
| Medyra's 10 agents | Subagent runs appear through transcripts and `SubagentStop` events. Whether a run is labelled with its `medyra-*` agent type is [unverified]. `by:` in PLAN.md can name the assigned agent |
| Scope | One daemon per repository. A session counts only if its `cwd` is inside the repository or one of its worktrees [doc] |
| Network | Binds `127.0.0.1`, ports 5330–5344 (`AGENTTRAIL_PORT` pins one) [src summary]; no telemetry, no CDN [doc] |
| Storage | `~/.agenttrail/<sha1(repo)[0:12]>.json`, mode 0600 in a 0700 directory. Runs are archived after 2 h of silence; at most 30 saved cycles [src summary] |
| Extension point for custom panels | None. `GET /panel` is a read-only summary; `POST /hook` ingests agent events only [doc] |
| Native Windows | "Windows has not been tested" [doc]. Paths are normalised to `/` [src]. No Windows autostart; it prints a hint instead [src summary] |
| Maturity | v0.4.1; last commit Nov 6, 2026; about 1.1k stars [doc] |

**Verdict:** suitable as a local observability layer. It cannot and must not enforce anything.

## 2. Proposed Medyra component map

The map is generated from repository evidence: `src/features/*`, `src/app/*`, `supabase/migrations` (15), CLAUDE.md phases and `docs/engineering/ROADMAP.md` epics. Planned modules have no code and are never shown as implemented.

| Component id | Title | Status (evidence) | `files:` | `needs:` |
| --- | --- | --- | --- | --- |
| `public-site` | Public website | Implemented (Phase 1; `src/app/{welcome,about,contact}`) | `src/features/landing/**`, `src/app/welcome/**`, `src/app/about/**` | |
| `auth` | Authentication | Implemented (Phase 2/4A; two-step code) | `src/features/auth/**`, `src/features/security/**`, `src/lib/auth/**`, `src/proxy.ts` | `database` |
| `onboarding` | Onboarding | Implemented (Phase 2) | `src/features/onboarding/**` | `auth` |
| `profiles` | Profiles | Implemented (Phase 3) | `src/features/profile/**`, `src/app/profile/**` | `auth`, `database` |
| `feed` | Home feed | Implemented (Phase 4) | `src/features/feed/**`, `src/features/home/**`, `src/app/post/**` | `profiles` |
| `network` | Connections and networking | Implemented (Phase 4b) | `src/features/network/**`, `src/features/saved/**` | `profiles` |
| `notifications` | Notifications | Implemented (Phase 4b) | `src/features/notifications/**` | `network` |
| `communities` | Communities | Implemented (Phase 6) | `src/features/communities/**`, `src/app/communities/**` | `feed` |
| `forums` | Forums | Implemented (Phase 6; anonymity) | `src/features/forums/**`, `src/app/forums/**` | `communities` |
| `messaging` | Messaging | Implemented (Phase 7) | `src/features/messaging/**`, `src/app/messages/**` | `network` |
| `mentorship` | Mentorship | Implemented (Phase 7) | `src/features/mentorship/**`, `src/app/mentorship/**` | `messaging` |
| `verify-student` | Student verification | Implemented; external providers off by default | `src/features/student-verification/**`, `src/features/verification/**` | `profiles` |
| `verify-pro` | Professional verification | **Planned** (EPIC-VERIFY-PRO) | | `verify-student` |
| `careers` | Careers and employers | **Planned** (EPIC-CAREERS; `/careers` is an informational page) | `src/app/careers/**` | `profiles` |
| `knowledge` | Articles and research | **Planned** (EPIC-KNOWLEDGE) | | |
| `stories` | Stories | **Planned** (roadmap) | | |
| `events` | Events and local communities | **Planned** (EPIC-LOCAL) | | |
| `support` | Peer support | **Planned** (EPIC-SUPPORT) | | `safety` |
| `admin` | Administration | Implemented (Phase 4A) | `src/features/admin/**`, `src/app/admin/**` | `safety` |
| `safety` | Privacy and safety | Implemented (Phase 4A; legal pages are drafts) | `src/features/{safety,privacy,feedback}/**`, `src/app/{privacy,terms,community-guidelines}/**` | `database` |
| `database` | Supabase database | Implemented (15 migrations, locked) | `supabase/migrations/**`, `src/lib/supabase/**` | |
| `rls` | RLS and authorization | Implemented (PGlite policy suites) | `supabase/tests/**` | `database` |
| `tests` | Automated testing | Implemented (Vitest, about 1,200 tests) | `src/**/*.test.*`, `supabase/tests/**` | |
| `browser-tests` | Browser testing | **Blocked**: Playwright awaits approval (QA-001) | `tests/e2e/**` | |
| `cicd` | CI/CD | In progress: workflows written, first CI run on PR #1 | `.github/workflows/**` | |
| `netlify` | Netlify deployment | Implemented (production serves Phase 7) | `netlify.toml` | `cicd` |
| `eng-orchestration` | Engineering orchestration | Implemented, not activated | `scripts/engineering/*.ts`, `scripts/engineering/lib/**`, `engineering/**`, `.claude/**` | |
| `usage-governor` | Subscription usage governor | Implemented, not activated (synthetic tests only) | `scripts/engineering/usage/**`, `scripts/engineering/lib/governor.ts`, `engineering/governor.json` | `eng-orchestration` |
| `docs` | Documentation | Ongoing | `docs/**`, `*.md` | |
| `maintenance` | Monitoring and maintenance | Partially implemented (health endpoint, Sentry optional; maintenance workflow read-only) | `src/lib/monitoring/**`, `src/app/api/health/**` | `cicd` |

## 3. PLAN.md strategy

- **Canonical sources stay where they are.** The task queue is `engineering/backlog.json` (later GitHub Issues). Epics live in `ROADMAP.md`. PLAN.md is a generated projection that is never edited by hand and never read back by the engine.
- **Generator** (proposed task ENG-008, not yet filed in the backlog): `scripts/engineering/plan-md.ts`.
  - Deterministic, no AI, unit-tested.
  - Runs after each `eng` state change and from `usage:tick`.
  - Writes `PLAN.md` at the repository root, git-ignored, because it carries live governor state.
  - Agenttrail only reads it. A dashboard edit has no effect on Medyra because the next generation overwrites it.
- **Using only Agenttrail's documented syntax:**
  - Components: `## Title {#id}`
  - Tasks: `- [ |~|x|!] text {#id}`
  - Fields: `needs:`, `files:`, `by:`, `horizon:` (`roadmap | backlog | now | agent`), `url:` (http/https only)

### Projecting Medyra's 16 states onto Agenttrail's 4 markers

| Medyra state | Marker | Annotation in the task text |
| --- | --- | --- |
| PROPOSED | `[ ]` + `horizon: backlog` | "(proposed, not approved)" |
| READY | `[ ]` + `horizon: now` | "(approved, waiting)" |
| CLAIMED, PLANNING, IMPLEMENTING, TESTING, REVIEWING, CHANGES_REQUESTED | `[~]` | the state name, plus `by: <agent>` |
| AWAITING_APPROVAL, READY_TO_MERGE | `[!]` | "(awaiting owner approval)" |
| INTEGRATED, PREVIEW_VALIDATED | `[~]` | "(awaiting validation)" |
| DONE | `[x]` | "(verified: gates at <sha>)" |
| BLOCKED, FAILED | `[!]` | the blocker text |
| CANCELLED | omitted | |
| Planned epic with no task | `[ ]` + `horizon: roadmap` | "(planned)" |
| Shipped before the engineering system | `[x]` | "(implemented before the engineering system; not re-verified)" |

Only `DONE`, which requires recorded gates and independent reviews for the exact commit, is labelled verified. An agent's own completion claim never sets `[x]`.

### Illustrative excerpt (generated format, not live data)

```markdown
## Home feed {#feed}
needs: [profiles]
files: [src/features/feed/**, src/features/home/**, src/app/post/**]
- [x] Feed, likes, comments (implemented before the engineering system; not re-verified) {#feed-phase4}
- [!] FEAT-001 Correct stale 'Coming to Medyra' rail copy (awaiting owner approval) {#feat-001}
  by: medyra-feature-engineer
- [ ] FEAT-017 Remove unsupported verified-employers claim (proposed, not approved) {#feat-017}
  horizon: backlog

## Subscription usage governor {#usage-governor}
needs: [eng-orchestration]
files: [scripts/engineering/usage/**, scripts/engineering/lib/governor.ts, engineering/governor.json]
- [!] Governor: PAUSED, TELEMETRY; next check 15:15 UTC; extra usage confirmed off; emergency stop off {#gov-status}
```

## 4. Backlog synchronisation

- **One direction only:** backlog, ROADMAP and governor feed PLAN.md. Nothing flows back. Agenttrail cannot authorize tasks, change priority or complete work.
- **No token use:** PLAN.md is regenerated by the deterministic scripts (`eng` commands and `usage:tick`), never by an agent turn.
- **Ids:** stable and lowercase (`feat-001`), as Agenttrail requires. Component ids are those in section 2.
- **After OPS-003** (GitHub Issues becomes canonical): the generator reads the issue state that the engine already mirrors. The format is unchanged.

## 5. Usage governor visualisation

Agenttrail has no panel or metric plugin [doc], so:
- **In the dashboard:** one generated status task `{#gov-status}` under `usage-governor`. It shows the state (RUNNING / ELIGIBLE / PAUSED), refusal codes, the next eligible time, extra-usage status and emergency stop. It shows **no percentages**, so personal usage figures never reach a file Agenttrail renders or a screen recording might capture.
- **Full figures:** `npm run usage:status` / `usage:report` in a terminal. These show weekly 25 %, five-hour 10 %, agent and account usage, pacing allowance, remaining allocation, resets, active agent and task, pause reason, paid-usage and emergency-stop status. That is all the information requested, computed deterministically.
- **No fork.** A local static status page is optional later. It would be written by `usage:tick` to `engineering/.local/status.html` and opened from disk. Agenttrail's `url:` accepts http(s) only, so it cannot link a `file://` page.
- **The governor remains the only enforcement point.**

## 6. Local dashboard configuration

- Run `agenttrail --no-open` (no subcommand) from the repository folder, with `AGENTTRAIL_PORT=5330` so the port is predictable.
- Loopback only. Never use port forwarding, tunnels or `0.0.0.0`.
- **Do not run `agenttrail init`.** It would write PLAN.md (ours is generated), append to `CLAUDE.md` and `AGENTS.md`, append `.agenttrail/` to `.gitignore`, and merge hooks into `.claude/settings.local.json`. Make the equivalent reviewed edits by hand if they are wanted: add `PLAN.md` to `.gitignore`. `.agenttrail/` is not needed, because its storage lives in the home directory.

## 7. Hook strategy

- **Phase 1: no hooks.** The transcript adapter already gives live session, tool and file activity for local sessions.
- **Phase 2 (optional, owner-approved):** add Agenttrail's relay (`node <agenttrail>/bin/agenttrail.mjs hook`) to `.claude/settings.local.json`, which is git-ignored and currently holds permissions only. Use the events Agenttrail lists: PreToolUse, PostToolUse, PostToolUseFailure, Stop, SessionStart, SubagentStop.
- **Medyra's existing hooks are untouched:**
  - The guard hook stays in `.claude/settings.json` (owner-only); Claude Code runs hooks from every settings file.
  - The relay only POSTs to loopback with a 400 ms timeout and fails silently [src], so it cannot block tools or start AI requests.
  - The guard runs regardless.
- **Never place Agenttrail hooks in user-level settings.** That would collect every project's activity.

## 8. Privacy safeguards

- **What becomes visible locally:**
  - The start of commands and prompts, search terms, files written and commit subjects.
  - The guard hook already blocks reads of `.env*`, seed output, credentials and verification evidence, so their values should not appear in tool output. Command text that names a secret path can still show, but not values.
- **Shared screens and recordings:** do not record or screen-share the dashboard during work on verification, safety or member data. Run cards can show file names and search terms.
- **Cross-project scope:** the board shows only sessions inside this repository [doc]. The founder's other projects stay out unless a board is started there.
- **Evidence:** fabricated events are possible, because ingest is unauthenticated on loopback. The dashboard is therefore never evidence of work. Run records, CI and reviews are.
- **No member data:** development uses `[DEV TEST DATA]` seed accounts only; production data never reaches the agents' machine.

## 9. Windows and WSL2

- **Native Windows (recommended for the pilot):** this is where Claude Code and the desktop app already write transcripts. Risks:
  - Agenttrail is untested on Windows.
  - Recursive `fs.watch` over a OneDrive folder may be noisy during sync and on `.next/` builds. Measure CPU during the pilot.
  - Opening a browser uses `start` [src summary].
  - No autostart: use Task Scheduler "At log on", running `agenttrail up` in the repository folder.
- **WSL2:**
  - Transcripts live on the Windows side. You would need `CLAUDE_CONFIG_DIR=/mnt/c/Users/SXB79/.claude`.
  - Recursive watching across `/mnt/c` does not receive Linux file events reliably, so live file tracking would degrade.
  - Use WSL2 only if Medyra later runs inside WSL2 from a Linux-side clone.
- **OneDrive:** do not move the repository without the founder's decision; the setup guide already recommends a clone outside OneDrive for heavy work.

## 10. Remote runner visibility

- GitHub Actions runs leave no local transcripts, so Agenttrail cannot see them live.
- The ingest endpoint is loopback-only. Do not expose it.
- Remote visibility comes from the engineering-state branch: after `git fetch`, the generator projects remote task states into PLAN.md. That gives task-level, not live, visibility. The usage governor currently refuses CI execution anyway (no telemetry).

## 11. Startup (after approval)

1. `npx agenttrail@0.4.1 --no-open` in the repository folder, or a pinned global install. The first run registers the repository; `up` only restarts boards already registered. Without `--no-open`, a first run with no PLAN.md asks to set up the plan convention and defaults to yes (that is `init`): answer `n`.
2. Open `http://127.0.0.1:5330`.
3. Optionally add a logon task in Task Scheduler.

## 12. Rollback and removal

1. Stop the daemon (`Ctrl+C`, or end the scheduled task) and delete the logon task.
2. Remove any Agenttrail hook entries from `.claude/settings.local.json`.
3. Delete `~/.agenttrail/` (its local activity history).
4. Delete the generated `PLAN.md`, and its `.gitignore` line if wanted.
5. If installed globally, `npm uninstall -g agenttrail`, run by the owner.

Medyra's orchestrator, governor and gates do not depend on Agenttrail, so removing it changes nothing else.
