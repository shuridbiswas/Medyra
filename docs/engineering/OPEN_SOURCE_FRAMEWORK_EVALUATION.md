# Open-source framework evaluation

Date: 2026-11-26. Assessment only: nothing was installed, initialized or activated.

**Method.** Each repository was read from GitHub: the repository page, README, releases and key source files fetched raw. Every claim below carries one of three evidence levels:
- **[src]**: read in source code.
- **[doc]**: README or docs only, not proven by code.
- **[unverified]**: could not be confirmed.

No install scripts were run. Medyra's own system was the baseline:
- the deterministic orchestrator (`scripts/engineering/orchestrator.ts`)
- the usage governor (`USAGE_GOVERNOR.md`)
- 10 `medyra-*` agents and 17 skills
- the guard hook, CI and quality gates

## Summary

| Candidate | Decision | One-line reason |
| --- | --- | --- |
| sleepless-agent | **Reference only** | Scrapes the interactive `claude /usage` screen; its daemon refuses to start without Slack tokens; auto-merges to main and runs `git push --all` |
| snarktank/ralph | **Reference only** | Hard-coded `--dangerously-skip-permissions`, which Medyra's settings disable; no limits other than an iteration count |
| ralph-orchestrator | **Defer** | Best loop design (a blocking `pre.iteration.start` hook could call `usage:admit`), but no Windows build and it would be a second orchestrator |
| **agenttrail** | **Selectively integrate (local, read-only pilot)** | Local daemon, no model calls, MIT; observes Claude Code transcripts and a PLAN.md we can generate from the backlog |
| claude-code-skills | **Defer (reference)** | 41 MIT skills, mostly overlapping; at most vendor one or two later (dependency upgrade, test-suite audit) |
| spec-kitty | **Reject for now** | Would compete with the canonical backlog; v4 is still in release candidates with breaking renames |
| hippo-memory | **Reject** | Writes 9 hooks into user-level settings; its `sleep` command uses an API key; about 480 MB model; duplicates existing records |
| icm | **Defer** | Local and Windows-capable, but 32 MCP tools cost context on every turn, and extraction spends subscription usage |
| ai-maestro | **Reject** | WSL2 + tmux only; dashboard and script access has no login; another control plane |
| compozy | **Reject** | Another control plane; account sign-in required; auto-approval loops |
| argos | **Defer** | Cloud upload of screenshots (free up to 5,000 a month); use Playwright's built-in local screenshots first, once Playwright is approved |
| skill-factory | **Reject** | Generator only; already covered by `skill-creator` and `superpowers:writing-skills` |
| awesome-agent finds | **No adoption** | Claude-Code-Usage-Monitor uses the same status line fields as our governor; its `--api` mode is an undocumented OAuth endpoint (prohibited); ccusage only estimates |

**Net:** the orchestrator, governor and gates stay custom. Agenttrail is the only proposed addition, as a local read-only dashboard. No new orchestration, memory, task or control-plane system.

## Repository assessments

### sleepless-agent (context-machine-lab), MIT
- **Maintenance:** 842 stars. Latest tag v0.1.2 (Oct 2025); last commit Mar 29, 2026 [doc]. The README file tree is stale (it names files that no longer exist).
- **How it reads usage** [src: `monitoring/pro_plan_usage.py`]:
  - `ProPlanUsageChecker` runs `claude /usage`, the configured `usage_command`.
  - It regex-parses the terminal screen for `NN%` and "Resets 2:59am (TZ)".
  - It uses a PTY on Unix. `_supports_pty` is False on Windows, so it falls back to pipes with a 5 s timeout. Whether that works against the interactive screen is [unverified].
  - It reads no credential files [src, for the files read].
  - This scrapes an interactive UI, not a documented telemetry interface, so it breaks whenever the screen text changes.
- **How it executes Claude** [src: `core/executor.py`]:
  - Through the Claude Agent SDK, `query()`, in three phases: planner, worker, evaluator.
  - The worker gets Read, Write, Edit, unrestricted Bash, Glob, Grep and TodoWrite, with `permission_mode="acceptEdits"`.
  - The default model is pinned to an old Sonnet.
  - It authenticates through `claude login`.
- **Is that officially supported?** The Agent SDK documentation directs developers to API-key authentication for SDK-built agents. Using a claude.ai login for third-party agents is not documented as supported (check the current Agent SDK overview). Medyra's runner instead uses the documented `claude -p` CLI under your own login.
- **Thresholds** [src: `config.yaml`, `scheduling/scheduler.py`]:
  - Day 20 %, night 80 % (01:00–09:00). The README's 95/96 is stale. **Must not be adopted.**
  - There is no weekly pacing.
  - A separate `BudgetManager` has a hard-coded $10/day cost budget [src: `daemon.py`].
- **Pause and resume** [src]:
  - It sets `usage_pause_until = reset + 1 min`, or now + 5 min if no reset time could be parsed.
  - The daemon sleeps up to 300 s and re-runs `claude /usage`, cached for 60 s.
  - A failed usage check means no dispatch (fails closed). That part is good.
- **State and Git** [src: `storage/git.py`]:
  - State is SQLite via SQLAlchemy, plus `live_status.json`.
  - Workspaces are per-task directories, not a sandbox.
  - Git is off by default. When on, it commits to a task branch, runs `merge --no-ff` into main and `git push --all origin`.
  - I found no `gh pr create`, so the README's pull-request claim is not supported by code.
- **Slack** [src]: the README says Slack is optional, but `SleeplessAgent.__init__` raises an error when Slack tokens are missing.
- **Fit:** cannot meet 25 % weekly / 10 % five-hour pacing without rewriting its scheduler. Its merge and push behaviour violates Medyra's release policy.
- **Patterns worth keeping:**
  - Pause until reset plus a margin: already in `nextEligibleAt`.
  - Cache the usage reading.
  - Fail closed when the usage check fails.
  - Planner, worker and evaluator separation: already the orchestrator, engineer and reviewers.

### snarktank/ralph, MIT
- **Maintenance:** 22.3k stars. No releases; about 20 commits, the latest Feb 2026 [doc].
- **The loop** [src: `ralph.sh`]:
  - It runs `claude --dangerously-skip-permissions --print < CLAUDE.md`, with `MAX_ITERATIONS=10`, `sleep 2` and `|| true`.
  - State lives in `prd.json` (`passes` flags), `progress.txt` and git.
  - There are no hooks, roles, usage awareness or test enforcement.
- **Fit:**
  - Medyra sets `disableBypassPermissionsMode: "disable"`, so the loop's core command would be refused. That is correct, because skipping permissions would bypass the guard hook.
  - It is Bash only; native Windows would need Git Bash or WSL.
  - The good ideas (fresh context each iteration, progress kept on disk) are already how Medyra slices work, through run records, checkpoints and `--resume`.

### mikeyobrien/ralph-orchestrator, MIT
- **Maintenance:** active. v2.12.0 released 2026-11-13; about 559 commits [doc].
- **Runtime:** Rust, with an optional Node dashboard. Release binaries are macOS and Linux only; Windows is unverified and looks unlikely.
- **Bounds** [doc]:
  - 100 iterations, 4 h runtime and a 30 min idle timeout by default.
  - Git checkpoints every 5 iterations; state in a scratchpad.
  - No verified cost or usage cap.
- **Governor fit** [doc]:
  - `hooks.events.pre.iteration.start` with `on_error: block` could run `npm run usage:admit` before every iteration. That is the cleanest external gate of any loop evaluated.
  - The exit-code contract is [unverified].
- **Roles** [doc]: "hats" (planner, builder, reviewer, finalizer) and presets. These overlap Medyra's 10 agents.
- **Claude authentication** [doc]: `claude login` or `ANTHROPIC_API_KEY`. The exact headless arguments are [unverified].
- **Decision:** defer. Medyra's orchestrator already provides bounded slices, persistent run records, independent reviewers, approvals tied to an exact commit SHA, and governor admission. A second orchestrator would split authority. Revisit only if execution moves to a Linux or WSL2 runner and the founder wants loop features Medyra lacks.

### sodiumsun/agenttrail, MIT
Full detail is in `AGENTTRAIL_INTEGRATION_PLAN.md`. Key evidence:
- **Maintenance:** v0.4.1; last commit Nov 6, 2026 [doc].
- **PLAN.md parser** [src: `bin/agenttrail.mjs`]:
  - Components are `## Title {#id}`; tasks are `- [ |x|~|!] text {#id}`.
  - Fields: `needs`, `links`, `files`, `tech`, `by`, `from|horizon` (agent, roadmap, now, backlog), `kind`, `url`.
- **Ingest** [doc: `docs/INGEST.md`]:
  - `POST http://127.0.0.1:5330-5344/hook`, accepting Claude-style hook events.
  - No token: the only checks are a loopback origin and no foreign browser `Origin`.
- **What it reads** [doc]:
  - `~/.claude/projects` logs touched in the last 2 h, at most the last 2 MiB of each.
  - Shows the start of commands and search terms.
  - Watches the repository recursively and polls git read-only.
- **Network** [src summary]: binds 127.0.0.1; no telemetry and no CDN [doc].
- **Storage** [src summary]: `~/.agenttrail/<hash>.json` with mode 0600.
- **No model calls** [doc]. Windows is "not tested" [doc], and there is no Windows autostart [src summary].

### levnikolaevich/claude-code-skills, MIT
- **Size and activity:** 41 skills in 9 plugin suites; no releases; active [doc].
- **Overlap with what Medyra already has:**
  - Product discovery and architecture: Superpowers brainstorming and writing-plans, plus the product steward.
  - Implementation and review: Superpowers, Ponytail, `code-review`, and Medyra's reviewers.
  - QA: the QA agent and quality-gates skill.
  - Delivery: the netlify-release skill. `ln-62` publishes GitHub releases, `ln-63` runs remote deployments [doc]. Medyra forbids both for agents.
- **Genuine gaps (small):**
  - `ln-42 Dependency Upgrader`: structured dependency upgrades; Medyra's maintenance engineer has no dedicated skill.
  - `ln-55 Test Suite Auditor`: finds weak or missing tests.
- `ln-54` and `ln-56` (repository-wide auditors) are expensive in tokens. Do not schedule them.
- **Recommendation:** install no suites; plugin suites load many skill descriptions into every session. After owner review, consider vendoring `ln-42` and `ln-55` as read-only references inside `medyra-incident-recovery` / `medyra-quality-gates`, rather than installing the plugins.

### spec-kitty/spec-kitty, MIT
- **Releases:** stable is v3.2.7 (Sep 2026). v4.0.0 is still at release candidate 8 (Nov 2026), with breaking renames between candidates (`doctrine`→`charter`, `merge`→`consolidate`) [doc].
- **What it creates** [doc]: `kitty-specs/`, `.kittify/` and `.worktrees/`, with an event log (`status.events.jsonl`) and lanes (planned, in progress, for review, approved, done). The dashboard was removed in rc5.
- **Fit:** it is a full requirements-and-task system, so it would compete with `engineering/backlog.json` and the planned GitHub Issues migration. Its lanes and review gates duplicate the engine's 16 states and SHA-bound reviews. Windows is unverified.
- **Decision:** reject for now; it can serve as a reference for issue-matrix verdicts on acceptance criteria.
- **Agenttrail:** cannot read spec-kitty state; it would need its own PLAN.md projection.

### kitfunso/hippo-memory, MIT
- **Install footprint** [doc]: Node 22.16 or later; SQLite plus markdown; a local embedding model of about 480 MB.
- **What it changes** [doc]: writes 9 hooks to `~/.claude/settings.json` (user level, so it affects every project); adds an MCP server with 13 tools; schedules a daily job.
- **Data leaving the machine:** `hippo sleep` sends text to Anthropic when `ANTHROPIC_API_KEY` is set, which is API billing and prohibited. A third-party reranker is optional.
- **Fit:** Medyra already keeps durable knowledge in CLAUDE.md, the Claude memory directory, run records with checkpoints and handoffs, `SESSION_RECOVERY.md`, ADRs and the trial report. No measured gap justifies a second memory system or hooks on every prompt.
- **Decision:** reject.

### rtk-ai/icm, Apache-2.0
- **Install footprint** [doc]: a Rust binary that runs on Windows (`icm.exe`); one SQLite file with full-text and vector search; a local ONNX model.
- **Context and usage cost** [doc]: an MCP server with 32 tools, whose definitions consume context in every session. Automatic extraction calls an installed agent CLI, which spends subscription usage, unless the summarizer is set to `provider = "none"`.
- **Maturity:** self-described as beta.
- **Decision:** defer. Reconsider only if repeated mistakes show up across sessions in run records. Even then, keyword-only mode with extraction off and a small tool allow-list.

### 23blocks-OS/ai-maestro, MIT
- **Runtime** [doc]: Next.js on Node 24, plus tmux and pm2. Runs on WSL2 only. Releases come every day or two.
- **Control plane** [doc]: launches agents in tmux and steers them with `send-keys`.
- **Security** [doc, release v0.106.276]: dashboard and script requests have "no login and no token".
- **Optional services:** voice through OpenAI or ElevenLabs.
- **Decision:** reject. It would be a second control plane with weaker access control than Medyra's.

### compozy/compozy, MIT core (cloud part FSL)
- **Runtime** [doc]: a Go daemon with a web UI and Electron app; SQLite storage; starts agent CLIs over the Agent Client Protocol.
- **Account:** requires Google or GitHub sign-in at the gate.
- **Automation:** schedules, loops and auto-approved proposals with a daily cap.
- **Install:** the installer is macOS and Linux only.
- **Decision:** reject. Its approvals and schedules would compete with `approvals.json` and the governor, and the account requirement adds an external dependency.

### argos-ci/argos, MIT
- **Pricing** [doc]: the hosted service is free up to 5,000 screenshots a month for one user; Pro is $100/month. Screenshots are uploaded to Argos unless self-hosted. Self-hosting needs Docker, a database and RabbitMQ (requirements undocumented).
- **Fit:** visual regression has value once Playwright exists (QA-001). Start with Playwright's built-in `toHaveScreenshot` (local, free, no upload), using `[DEV TEST DATA]` seed accounts only. Consider Argos only for team review of diffs, with the founder's approval of the free tier and synthetic data only.

### alirezarezvani/claude-code-skill-factory, MIT
A prompt and template generator for skills, agents, commands and hooks, last updated Oct 2025 [doc]. It does not validate existing skills. Medyra's 17 skills are generated and listed in `SKILLS_REGISTRY.md`. Use the existing `skill-creator` / `superpowers:writing-skills` for any new skill. **Decision:** reject.

### awesome-agent (discovery)
- **Coverage:** only the first ~40k of its 275k characters were read verbatim; the rest is [unverified].
- **Claude-Code-Usage-Monitor** (MIT) [doc]:
  - Its `--statusline` mode reads the same official `rate_limits` fields as Medyra's capture script.
  - It falls back to token estimates against fixed plan presets.
  - Its `--api` mode is an "experimental Anthropic OAuth usage API". That is undocumented, so it is prohibited by the governor policy.
- **ccusage** [doc]: estimates from local transcripts only.
- **Result:** neither adds anything the governor lacks.
- **Context tools** (ast-index-search, lean-ctx): vendor savings claims only; [unverified]. No adoption without a measured problem.

## Compatibility and decision matrix

Scores run from 1 (poor) to 5 (good). "Overlap" scores high when the tool duplicates little of what Medyra already has.

| Candidate | Medyra fit | Autonomy | Usage efficiency | Governor fit | Observability | Security | Privacy | Maintainability | Low complexity | Low cost | Windows | Overlap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sleepless-agent | 1 | 3 | 2 | 1 | 2 | 1 | 3 | 2 | 2 | 4 | 2 | 2 |
| ralph | 2 | 3 | 2 | 1 | 1 | 1 | 4 | 3 | 5 | 5 | 1 | 3 |
| ralph-orchestrator | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 2 | 5 | 1 | 2 |
| **agenttrail** | 4 | n/a | 5 | 5 (read-only) | 5 | 4 | 3 | 3 | 4 | 5 | 2 (untested) | 5 |
| claude-code-skills | 3 | 2 | 3 | 5 | 1 | 3 | 4 | 3 | 4 | 5 | 4 | 2 |
| spec-kitty | 2 | 3 | 3 | 3 | 2 | 3 | 4 | 2 | 2 | 5 | 2 | 1 |
| hippo-memory | 2 | 1 | 2 | 2 | 1 | 2 | 3 | 3 | 2 | 4 | 4 | 2 |
| icm | 2 | 1 | 2 | 3 | 1 | 3 | 4 | 3 | 3 | 5 | 4 | 2 |
| ai-maestro | 1 | 4 | 2 | 1 | 4 | 1 | 2 | 2 | 1 | 4 | 1 | 1 |
| compozy | 1 | 4 | 2 | 1 | 4 | 3 | 3 | 3 | 2 | 3 | 2 | 1 |
| argos | 3 | 1 | 5 | 5 | 2 | 3 | 2 | 4 | 3 | 3 | 4 | 5 |
| skill-factory | 1 | 1 | 3 | 5 | 1 | 3 | 5 | 3 | 4 | 5 | 4 | 1 |

## Security findings

1. **Permission bypass:**
   - Both Ralph variants rely on, or likely use, a permission-skipping mode; Medyra disables that mode in `.claude/settings.json`.
   - sleepless-agent gives an SDK worker unrestricted Bash.
   - None may run inside this repository.
2. **Usage scraping:** sleepless-agent's `/usage` screen scraping and Usage-Monitor's experimental OAuth usage API are outside documented interfaces. Both are excluded by policy.
3. **Unauthenticated local endpoints:**
   - Agenttrail's ingest endpoint accepts any loopback caller. A local process, including an agent, could post fabricated events, so the dashboard is never evidence of work done.
   - ai-maestro's dashboard and script access has no login.
4. **User-level side effects:** hippo-memory writes user-level hooks, and Agenttrail's `init` writes CLAUDE.md, AGENTS.md, .gitignore and `.claude/settings.local.json`. Neither may run without review.
5. **Data leaving the machine:** hippo `sleep` (API key), icm extraction (agent CLI), Argos uploads, ai-maestro voice and gateways, compozy cloud and account. Nothing evaluated sends Medyra code off-machine if left at its defaults, except Argos and the memory extractors.

## Cost assessment

- **Agenttrail:** $0, and zero model calls.
- **Ralph tools, spec-kitty, skills:** $0 for the tools themselves, but every loop iteration or skill invocation consumes subscription usage.
- **Memory extractors** (icm, hippo `sleep`): consume usage or API billing.
- **Argos:** free up to 5,000 screenshots a month, then $100/month.
- **compozy:** cloud tier optional.
- **Recommended set:** no new recurring costs.

## Proposed architecture

| Concern | Owner | Notes |
| --- | --- | --- |
| Task queue | `engineering/backlog.json`, canonical until OPS-003 moves it to GitHub Issues in a one-way migration | Agenttrail's PLAN.md is a generated, read-only projection |
| Agent execution | Medyra orchestrator + `usage/cli.ts` runner (bounded `claude -p` slices) | Retained custom; no Ralph, compozy or ai-maestro |
| Usage enforcement | Usage governor (`lib/governor.ts`), the highest authority | Every slice, `cycle` and workflow passes `admit` |
| Observability | Agenttrail (local, 127.0.0.1, read-only) + `npm run usage:status` + `eng report` + GitHub Actions summaries | The dashboard never enforces anything or counts as evidence |
| Memory and recovery | CLAUDE.md, Claude memory, run records (checkpoints, handoffs, gates), `SESSION_RECOVERY.md` | No new memory system |
| Quality and security | Existing gates, independent reviewers, guard hook, CI; Playwright screenshots later | Unchanged and mandatory |
| Skills | Existing; possibly vendor `ln-42` and `ln-55` later | No plugin suites |

- **Pause and resume:** unchanged.
  1. The governor refuses a slice.
  2. `tick` records the pause and holds the task's claim until the next eligible time.
  3. Once fresh telemetry allows it, the next slice resumes the same run and session (`--resume`).
- **Recovery:** unchanged. Run records and the engine's `recover` handle crashed runners; governor pauses never spend retries.

## Dependencies and installation (if approved)

Agenttrail only. Either `npm install -g agenttrail` (global, outside this repository's `package.json`), or `npx agenttrail@0.4.1` pinned to an exact version. Node is already installed. Medyra's own code adds no dependency: the PLAN.md generator would be a script inside the repository.

## Integration sequence

1. The owner approves the Agenttrail pilot and the version pin. It counts as a dependency install under policy.
2. Add a deterministic `scripts/engineering/plan-md.ts`, which writes a git-ignored PLAN.md from the backlog, ROADMAP and governor state. Unit tests cover it. Engineering task ENG-008 (proposed).
3. Run Agenttrail natively on Windows without `init` and without hooks; observe for a week (CPU, OneDrive noise, accuracy).
4. Optionally add the Agenttrail hook relay to `.claude/settings.local.json` after reviewing it (read-only observation).
5. Re-evaluate ralph-orchestrator only if execution moves to Linux or WSL2. Re-evaluate Argos after Playwright (QA-001).

## Known limitations of this assessment

- Some sources were read only through a summary of a truncated page: parts of sleepless-agent's executor, the second half of Agenttrail's main file, Agenttrail's `bin/lib/*` (Claude log parsing, hooks), and the later README sections of hippo and ai-maestro. These are marked.
- Release years shown without a year on GitHub pages were inferred.
- Nothing was run, so the Windows behaviour of every tool is unverified.

## Owner approvals required

1. Agenttrail pilot (global npm install, exact version), native Windows.
2. A PLAN.md generator task and whether PLAN.md stays git-ignored (recommended, because it would show governor state).
3. Any Agenttrail hook in `.claude/settings.local.json`.
4. Any vendored third-party skill (`ln-42`, `ln-55`).
5. Later: Playwright (QA-001), then Argos free tier with synthetic data only.
