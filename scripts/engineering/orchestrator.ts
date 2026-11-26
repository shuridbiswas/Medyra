/**
 * Medyra engineering orchestrator (deterministic part).
 *
 *   node scripts/engineering/orchestrator.ts <command> [--flag value]
 *
 * Commands
 *   validate                       Validate every engineering/ file and run record
 *   status                         Task counts, active claims, budget, pause state
 *   next                           Show the task a cycle would pick, and why others are not eligible
 *   preflight --mode <m>           Pause, activation and budget checks (m: dry-run|manual|scheduled)
 *   cycle [--mode <m>]             One bounded cycle: preflight → recover → select → claim → brief.
 *                                  Defaults to dry-run (prints, changes nothing).
 *   claim --task <id> --owner <who>
 *   transition --task <id> --to <STATE> --run <runId> [--by <role>] [--note ...] [--blocker ...]
 *   commit --task <id> --sha <sha> --branch <name>
 *   review --task <id> --role <role> --verdict PASS|BLOCK --sha <sha> --summary <text>
 *   gate --run <runId> --gate <gate> --result <RESULT> --sha <sha> --detail <text>
 *   handoff --run <runId> --file <json>       Validate and append an agent handoff
 *   checkpoint --run <runId> --note <text>    Record progress for recovery
 *   evidence --task <id> --text <summary>     Record completion evidence
 *   recover                        Release expired claims (idempotent)
 *   report                         Markdown engineering report (stdout)
 *   usage --run <runId> --usd <n> --kind estimated|billed --source <text>
 *
 * Every mutation takes engineering/.mutex, re-reads state, applies one rule from lib/engine.ts and
 * writes atomically. Nothing here calls a model, the network, or a hosted database.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  budgetStatus,
  claim,
  eligibility,
  isSecuritySensitive,
  newRunId,
  pauseReason,
  preflight,
  recordCommit,
  recordReview,
  recoverStale,
  reviewGaps,
  RuleError,
  transition,
} from "./lib/engine.ts";
import { GATES, HandoffSchema, RESULT, ROLES, RunSchema, STATES, type Run, type State } from "./lib/model.ts";
import { engineeringPaths, loadRun, loadState, readJson, StoreError, withMutex, writeJsonAtomic } from "./lib/store.ts";
import { admit, expireSlices, settleSlices } from "./lib/governor.ts";
import { loadConfig, loadLedger, loadSnapshot, reportLines } from "./usage/state.ts";

const root = process.env.MEDYRA_ENGINEERING_ROOT ?? process.cwd();
const paths = engineeringPaths(root);
const now = () => new Date(process.env.MEDYRA_NOW ?? Date.now());

function args(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      const value = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
      flags[key] = value;
    }
  }
  return { command, flags };
}

const need = (flags: Record<string, string>, key: string) => {
  const v = flags[key];
  if (!v) throw new RuleError("MISSING_FLAG", `--${key} is required`);
  return v;
};

function git(...a: string[]): string {
  const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

const saveBacklog = (b: ReturnType<typeof loadState>["backlog"]) => writeJsonAtomic(paths.backlog, b);
const saveRun = (run: Run) => writeJsonAtomic(paths.run(run.runId), RunSchema.parse(run));

function requireRun(runId: string): Run {
  const run = loadRun(root, runId);
  if (!run) throw new RuleError("UNKNOWN_RUN", `no run record ${runId}`);
  return run;
}

function brief(taskId: string, run: Run): string {
  const { backlog } = loadState(root);
  const t = backlog.tasks.find((x) => x.id === taskId)!;
  return [
    `# Brief ${t.id}: ${t.title}`,
    "",
    `Run ${run.runId} · base ${run.baseSha} · branch ${run.branch} · risk ${t.risk}${t.securitySensitive ? " · SECURITY-SENSITIVE" : ""}`,
    "",
    t.description,
    "",
    "## Acceptance criteria",
    ...t.acceptanceCriteria.map((c) => `- ${c}`),
    "",
    `## Allowed file scope\n${t.fileScope.map((f) => `- \`${f}\``).join("\n")}`,
    "",
    `## Agents\n${t.requiredAgents.join(", ")}`,
    "",
    `## Required gates\n${t.requiredGates.join(", ")}`,
    "",
    "Follow the medyra-orchestration skill. Record every handoff with `orchestrator.ts handoff`. Do not touch files outside the scope.",
  ].join("\n");
}

/** Usage governor section for the report; never fails the report itself. */
function usageSection(s: ReturnType<typeof loadState>): string[] {
  // Workflow logs and step summaries may be public: never print the founder's usage figures there.
  if (process.env.GITHUB_ACTIONS === "true") return ["## Usage (subscription, estimated)", "- figures are shown only on the owner's machine (`npm run usage:report`)"];
  try {
    const config = loadConfig(root);
    const snap = loadSnapshot(root).snapshot;
    const ledger = settleSlices(config.usageGovernor, expireSlices(loadLedger(root), now()), snap, now());
    const d = admit({ config, ledger, snapshot: snap, control: s.control, env: process.env, now: now(), request: { kind: "continue", taskId: null, taskApproved: true, model: "sonnet", securitySensitive: false } });
    return reportLines(config, ledger, d, new Date(now().getTime() - 7 * 86_400_000));
  } catch (e) {
    return ["## Usage (subscription, estimated)", `- unavailable: ${(e as Error).message}`];
  }
}

async function main() {
  const { command, flags } = args(process.argv.slice(2));
  switch (command) {
    case "validate": {
      const s = loadState(root);
      let runs = 0;
      if (existsSync(paths.runs)) {
        for (const f of readdirSync(paths.runs).filter((x) => x.endsWith(".json"))) {
          readJson(path.join(paths.runs, f), RunSchema);
          runs++;
        }
      }
      console.log(`valid: ${s.backlog.tasks.length} tasks, ${s.approvals.approvals.length} approvals, ${runs} run records`);
      return;
    }
    case "status": {
      const s = loadState(root);
      const counts = Object.fromEntries(STATES.map((st) => [st, s.backlog.tasks.filter((t) => t.state === st).length]).filter(([, n]) => n));
      const b = budgetStatus(s.usage, s.control, now());
      console.log(JSON.stringify({ paused: s.control.paused, autonomy: s.control.autonomy, counts, budget: b }, null, 2));
      return;
    }
    case "next": {
      const s = loadState(root);
      const { eligible, ineligible } = eligibility(s.backlog, s.approvals, s.control, s.policy);
      console.log(JSON.stringify({ next: eligible[0]?.id ?? null, eligible: eligible.map((t) => t.id), ineligible }, null, 2));
      return;
    }
    case "preflight": {
      const s = loadState(root);
      const mode = (flags.mode ?? "dry-run") as "dry-run" | "manual" | "scheduled";
      const p = preflight({ control: s.control, usage: s.usage, env: process.env, now: now(), mode });
      console.log(JSON.stringify(p, null, 2));
      process.exitCode = p.ok ? 0 : 3;
      return;
    }
    case "cycle": {
      const mode = (flags.mode ?? "dry-run") as "dry-run" | "manual" | "scheduled";
      await withMutex(root, () => {
        const s = loadState(root);
        const p = preflight({ control: s.control, usage: s.usage, env: process.env, now: now(), mode });
        if (!p.ok) {
          console.log(JSON.stringify({ stopped: true, reasons: p.reasons }, null, 2));
          process.exitCode = 3;
          return;
        }
        const rec = recoverStale(s.backlog, s.control, now());
        const { eligible, ineligible } = eligibility(rec.backlog, s.approvals, s.control, s.policy);
        const task = eligible[0];
        if (!task) {
          console.log(JSON.stringify({ stopped: true, reasons: ["no eligible approved work"], recovered: rec.recovered, ineligible }, null, 2));
          if (mode !== "dry-run" && rec.recovered.length) saveBacklog(rec.backlog);
          return;
        }
        if (mode === "dry-run") {
          console.log(JSON.stringify({ dryRun: true, wouldClaim: task.id, recovered: rec.recovered, ineligible }, null, 2));
          return;
        }
        // Every real run starts AI work, so it must pass the usage governor's admission controller.
        const gov = admit({
          config: loadConfig(root),
          ledger: loadLedger(root),
          snapshot: loadSnapshot(root).snapshot,
          control: s.control,
          env: process.env,
          now: now(),
          request: { kind: "new-task", taskId: task.id, taskApproved: true, model: (s.control.models["medyra-orchestrator"] ?? "sonnet") as "sonnet", securitySensitive: isSecuritySensitive(task, s.policy) },
        });
        if (!gov.admitted) {
          console.log(JSON.stringify({ stopped: true, reasons: gov.failures.map((f) => `usage governor ${f.code}: ${f.detail}`), nextEligibleAt: gov.nextEligibleAt }, null, 2));
          process.exitCode = 3;
          return;
        }
        const runId = newRunId(now());
        const backlog = claim(rec.backlog, { taskId: task.id, runId, owner: flags.owner ?? "orchestrator", now: now(), approvals: s.approvals, control: s.control, policy: s.policy });
        const baseSha = git("rev-parse", "HEAD") || "0000000";
        const run: Run = {
          version: 1,
          runId,
          taskId: task.id,
          mode,
          startedAt: now().toISOString(),
          baseSha,
          branch: `agent/${task.id.toLowerCase()}-${runId.slice(-6)}`,
          checkpoints: [{ at: now().toISOString(), state: "CLAIMED", note: "claimed", sha: baseSha }],
          handoffs: [],
          gates: {},
          nextAction: "medyra-orchestrator: create branch, plan, assign agents",
          endedAt: null,
        };
        saveBacklog(backlog);
        saveRun(run);
        writeFileSync(path.join(paths.runs, `${runId}.brief.md`), brief(task.id, run));
        console.log(JSON.stringify({ claimed: task.id, runId, branch: run.branch, brief: `engineering/runs/${runId}.brief.md` }, null, 2));
      });
      return;
    }
    case "claim": {
      await withMutex(root, () => {
        const s = loadState(root);
        const paused = pauseReason(s.control, process.env);
        if (paused) throw new RuleError("PAUSED", paused);
        const taskId = need(flags, "task");
        const runId = newRunId(now());
        const backlog = claim(s.backlog, { taskId, runId, owner: need(flags, "owner"), now: now(), approvals: s.approvals, control: s.control, policy: s.policy });
        const baseSha = git("rev-parse", "HEAD") || "0000000";
        saveBacklog(backlog);
        saveRun({
          version: 1,
          runId,
          taskId,
          mode: "manual",
          startedAt: now().toISOString(),
          baseSha,
          branch: flags.branch ?? `agent/${taskId.toLowerCase()}-${runId.slice(-6)}`,
          checkpoints: [{ at: now().toISOString(), state: "CLAIMED", note: "claimed", sha: baseSha }],
          handoffs: [],
          gates: {},
          nextAction: "plan",
          endedAt: null,
        });
        console.log(runId);
      });
      return;
    }
    case "transition": {
      await withMutex(root, () => {
        const s = loadState(root);
        const to = need(flags, "to") as State;
        const paused = pauseReason(s.control, process.env);
        if (paused && to !== "BLOCKED" && to !== "FAILED") throw new RuleError("PAUSED", paused);
        if (!STATES.includes(to)) throw new RuleError("BAD_STATE", `unknown state ${to}`);
        const runId = flags.run ?? null;
        const run = runId ? requireRun(runId) : null;
        const backlog = transition(s.backlog, {
          taskId: need(flags, "task"),
          to,
          by: flags.by ?? "medyra-orchestrator",
          runId,
          now: now(),
          note: flags.note,
          blocker: flags.blocker,
          approvals: s.approvals,
          control: s.control,
          policy: s.policy,
          run,
        });
        saveBacklog(backlog);
        if (run) {
          const t = backlog.tasks.find((x) => x.id === run.taskId)!;
          run.checkpoints.push({ at: now().toISOString(), state: to, note: flags.note ?? `→ ${to}`, sha: t.commitSha });
          if (["DONE", "FAILED", "CANCELLED", "BLOCKED"].includes(to)) run.endedAt = now().toISOString();
          saveRun(run);
        }
        console.log(`${flags.task} → ${to}`);
      });
      return;
    }
    case "commit": {
      await withMutex(root, () => {
        const s = loadState(root);
        saveBacklog(recordCommit(s.backlog, need(flags, "task"), need(flags, "sha"), need(flags, "branch")));
        console.log(`recorded ${flags.sha}`);
      });
      return;
    }
    case "review": {
      await withMutex(root, () => {
        const s = loadState(root);
        const role = need(flags, "role");
        if (!(ROLES as readonly string[]).includes(role)) throw new RuleError("BAD_ROLE", `unknown role ${role}`);
        const verdict = need(flags, "verdict");
        if (verdict !== "PASS" && verdict !== "BLOCK") throw new RuleError("BAD_VERDICT", "verdict must be PASS or BLOCK");
        const backlog = recordReview(s.backlog, {
          taskId: need(flags, "task"),
          role: role as (typeof ROLES)[number],
          verdict,
          sha: need(flags, "sha"),
          summary: need(flags, "summary"),
          now: now(),
        });
        saveBacklog(backlog);
        const t = backlog.tasks.find((x) => x.id === flags.task)!;
        console.log(JSON.stringify({ recorded: true, remainingGaps: reviewGaps(t, s.policy) }, null, 2));
      });
      return;
    }
    case "gate": {
      await withMutex(root, () => {
        const run = requireRun(need(flags, "run"));
        const gate = need(flags, "gate");
        if (!(GATES as readonly string[]).includes(gate)) throw new RuleError("BAD_GATE", `unknown gate ${gate}`);
        const result = RESULT.parse(need(flags, "result"));
        run.gates = { ...run.gates, [gate]: { result, sha: need(flags, "sha"), detail: need(flags, "detail") } };
        saveRun(run);
        console.log(`${gate}: ${result}`);
      });
      return;
    }
    case "handoff": {
      await withMutex(root, () => {
        const run = requireRun(need(flags, "run"));
        const raw = JSON.parse(readFileSync(need(flags, "file"), "utf8"));
        const parsed = HandoffSchema.safeParse(raw);
        if (!parsed.success) {
          throw new RuleError("INVALID_HANDOFF", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        }
        if (parsed.data.runId !== run.runId || parsed.data.taskId !== run.taskId) throw new RuleError("HANDOFF_MISMATCH", "handoff run/task does not match the run record");
        run.handoffs.push(parsed.data);
        run.nextAction = parsed.data.nextAction;
        saveRun(run);
        console.log(`handoff from ${parsed.data.role} recorded (${parsed.data.status})`);
      });
      return;
    }
    case "checkpoint": {
      await withMutex(root, () => {
        const run = requireRun(need(flags, "run"));
        const { backlog } = loadState(root);
        const t = backlog.tasks.find((x) => x.id === run.taskId)!;
        run.checkpoints.push({ at: now().toISOString(), state: t.state, note: need(flags, "note"), sha: t.commitSha });
        if (flags.next) run.nextAction = flags.next;
        saveRun(run);
        console.log("checkpoint saved");
      });
      return;
    }
    case "evidence": {
      await withMutex(root, () => {
        const s = loadState(root);
        const id = need(flags, "task");
        saveBacklog({ ...s.backlog, tasks: s.backlog.tasks.map((t) => (t.id === id ? { ...t, completionEvidence: need(flags, "text") } : t)) });
        console.log("evidence recorded");
      });
      return;
    }
    case "recover": {
      await withMutex(root, () => {
        const s = loadState(root);
        const r = recoverStale(s.backlog, s.control, now());
        if (r.recovered.length) saveBacklog(r.backlog);
        console.log(JSON.stringify({ recovered: r.recovered }, null, 2));
      });
      return;
    }
    case "usage": {
      await withMutex(root, () => {
        const s = loadState(root);
        const usd = Number(need(flags, "usd"));
        if (!Number.isFinite(usd) || usd < 0) throw new RuleError("BAD_USD", "--usd must be a non-negative number");
        const kind = need(flags, "kind");
        if (kind !== "estimated" && kind !== "billed") throw new RuleError("BAD_KIND", "--kind must be estimated or billed");
        s.usage.entries.push({ runId: need(flags, "run"), at: now().toISOString(), usd, kind, source: need(flags, "source") });
        writeJsonAtomic(paths.usage, s.usage);
        console.log("usage recorded");
      });
      return;
    }
    case "report": {
      const s = loadState(root);
      const by = (st: State) => s.backlog.tasks.filter((t) => t.state === st);
      const active = s.backlog.tasks.filter((t) => t.claim);
      const { eligible, ineligible } = eligibility(s.backlog, s.approvals, s.control, s.policy);
      const b = budgetStatus(s.usage, s.control, now());
      const awaiting = by("AWAITING_APPROVAL").concat(by("READY_TO_MERGE"));
      const decisions = s.backlog.tasks.filter((t) => t.approval === "OWNER_DECISION_NEEDED" && t.state !== "CANCELLED");
      const list = (ts: { id: string; title: string }[]) => (ts.length ? ts.map((t) => `- ${t.id} ${t.title}`).join("\n") : "- none");
      console.log(
        [
          `# Medyra engineering report (${now().toISOString().slice(0, 10)})`,
          "",
          `Autonomy: ${s.control.paused ? "PAUSED" : "not paused"} · execution ${s.control.autonomy.executionEnabled ? "enabled" : "disabled"} · schedule ${s.control.autonomy.scheduleEnabled ? "enabled" : "disabled"}`,
          `Budget: ${b.today.toFixed(2)} USD today, ${b.thisMonth.toFixed(2)} USD this month (estimates unless marked billed)`,
          "",
          `## Done\n${list(by("DONE"))}`,
          `## In progress\n${list(active)}`,
          `## Awaiting approval or merge\n${list(awaiting)}`,
          `## Blocked\n${by("BLOCKED").map((t) => `- ${t.id} ${t.title}: ${t.blockers.join("; ")}`).join("\n") || "- none"}`,
          `## Failed\n${list(by("FAILED"))}`,
          `## Proposed (not approved)\n${list(by("PROPOSED"))}`,
          `## Founder decisions needed\n${list(decisions)}`,
          `## Next eligible work\n${eligible.length ? eligible.slice(0, 5).map((t) => `- ${t.id} ${t.title}`).join("\n") : `- none (${ineligible.length} READY tasks are not eligible; run \`next\` for reasons)`}`,
          "",
          ...usageSection(s),
          "",
          "CI, browser tests, security findings and deployments: see the GitHub Actions summary for the same commit. This report does not infer them.",
        ].join("\n"),
      );
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
      process.exitCode = command ? 2 : 0;
  }
}

main().catch((error: unknown) => {
  if (error instanceof RuleError || error instanceof StoreError) {
    console.error(`refused: ${error.message}`);
    process.exitCode = 4;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});

