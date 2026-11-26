/**
 * Medyra usage governor CLI. Every command is deterministic: none of them sends a request to Claude,
 * except `run --execute`, which launches one admitted, bounded headless slice.
 *
 *   status [--json]                 Current state, usage, pacing, next eligible time
 *   report [--days n]               Usage section for engineering reports
 *   pause --reason <text>           Owner pause (separate from control.json; both stop execution)
 *   resume                          Clears the owner pause only; every other check still applies
 *   configure [--set key=value]     Show or change governor.json within the founder's ceilings
 *   dry-run [--model m]             Full admission decision for the next slice, no side effects
 *   admit                           Same decision as an exit code (0 admitted, 3 refused), no figures printed (CI-safe)
 *   doctor [--probe]                Setup checks; --probe spends one tiny request to test headless telemetry
 *   tick                            Scheduler step: settle, decide, record pause/resume, launch a slice if allowed
 *   run --execute                   Runner: admit, claim or resume, one bounded slice, record
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { eligibility, holdClaimForPause, isApproved, isSecuritySensitive } from "../lib/engine.ts";
import {
  BILLING_ENV,
  SLICE_SCRUB_ENV,
  GovernorConfigSchema,
  admit,
  beginSlice,
  endSlice,
  expireSlices,
  settleSlices,
  type AdmissionRequest,
  type Decision,
  type Ledger,
} from "../lib/governor.ts";
import { ACTIVE_STATES, type Role } from "../lib/model.ts";
import { loadRun, loadState, withMutex, writeJsonAtomic } from "../lib/store.ts";
import { loadConfig, loadLedger, loadSnapshot, reportLines, saveLedger, statusLines, usagePaths } from "./state.ts";

const root = process.env.MEDYRA_ENGINEERING_ROOT ?? process.cwd();
const now = () => new Date(process.env.MEDYRA_NOW ?? Date.now());
const ORCHESTRATOR: Role = "medyra-orchestrator";
/** scripts/engineering, located from this file so a test can point MEDYRA_ENGINEERING_ROOT at scratch state. */
const SCRIPTS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function flagsOf(argv: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    flags[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  }
  return flags;
}

/** The task the next slice would work on: a claimed one to continue, else the next eligible one. */
function nextWork(model?: string) {
  const s = loadState(root);
  const active = s.backlog.tasks.find((t) => t.claim && ACTIVE_STATES.includes(t.state)) ?? null;
  const task = active ?? eligibility(s.backlog, s.approvals, s.control, s.policy).eligible[0] ?? null;
  const request: AdmissionRequest = {
    kind: active ? "continue" : "new-task",
    taskId: task?.id ?? null,
    taskApproved: !!task && task.approval === "APPROVED_REQUIREMENT" && isApproved(s.approvals, task.id, "execute"),
    model: (model ?? s.control.models[ORCHESTRATOR] ?? "sonnet") as AdmissionRequest["model"],
    securitySensitive: !!task && isSecuritySensitive(task, s.policy),
  };
  return { s, active, task, request };
}

function decide(ledger: Ledger, model?: string) {
  const config = loadConfig(root);
  const { snapshot } = loadSnapshot(root);
  const w = nextWork(model);
  const decision = admit({ config, ledger, snapshot, control: w.s.control, env: process.env, now: now(), request: w.request });
  return { config, snapshot, decision, ...w };
}

function latestCheckpoint(runId: string | null | undefined): string | null {
  if (!runId) return null;
  const run = loadRun(root, runId);
  const c = run?.checkpoints.at(-1);
  return c ? `${run!.runId} ${c.state} ${c.at.slice(0, 16)}: ${c.note}` : null;
}

/** Settle finished slices and close vanished ones before any decision. */
function refreshLedger(): Ledger {
  const config = loadConfig(root);
  const { snapshot } = loadSnapshot(root);
  return settleSlices(config.usageGovernor, expireSlices(loadLedger(root), now()), snapshot, now());
}

/** Record a decision; log a pause or resume only when the state flips, and hold the active claim while paused. */
function record(ledger: Ledger, d: Decision, taskId: string | null, runId: string | null): Ledger {
  const at = now().toISOString();
  const codes = [...new Set(d.failures.map((f) => f.code))];
  const wasAdmitted = ledger.lastDecision?.admitted ?? true;
  let next: Ledger = { ...ledger, lastDecision: { at, admitted: d.admitted, codes, nextEligibleAt: d.nextEligibleAt } };
  if (!d.admitted && (wasAdmitted || codes.join() !== ledger.lastDecision?.codes.join())) {
    next = { ...next, pauses: [...next.pauses, { at, codes, taskId, nextEligibleAt: d.nextEligibleAt }].slice(-500) };
  }
  if (d.admitted && ledger.lastDecision && !ledger.lastDecision.admitted) next = { ...next, resumes: [...next.resumes, { at, taskId }].slice(-500) };
  if (!d.admitted && taskId && runId) {
    const s = loadState(root);
    const until = new Date(d.nextEligibleAt ?? now().getTime() + 24 * 3_600_000);
    try {
      writeJsonAtomic(path.join(root, "engineering", "backlog.json"), holdClaimForPause(s.backlog, { taskId, runId, until, control: s.control, now: now() }));
    } catch {
      /* claim already gone: recovery handles it */
    }
  }
  return next;
}

function node(script: string, args: string[]) {
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

/** Environment for the headless slice: subscription only. API keys and provider switches are removed. */
export function sliceEnv<T extends Record<string, string | undefined>>(env: T, sliceId: string): T {
  const clean: Record<string, string | undefined> = { ...env };
  // (generic so callers keep NodeJS.ProcessEnv for spawnSync)
  for (const k of SLICE_SCRUB_ENV) delete clean[k];
  delete clean.MEDYRA_OWNER_MODE;
  clean.MEDYRA_GOVERNED_SLICE = sliceId;
  return clean as T;
}

function ensureStatuslineSettings(): string {
  const p = usagePaths(root);
  const capture = path.join(SCRIPTS, "usage", "statusline-capture.mjs").replace(/\\/g, "/");
  writeJsonAtomic(p.statuslineSettings, { statusLine: { type: "command", command: `node "${capture}"` } });
  return p.statuslineSettings;
}

function slicePrompt(taskId: string, runId: string, resuming: boolean): string {
  return [
    `You are ${ORCHESTRATOR} (read .claude/agents/${ORCHESTRATOR}.md and follow the medyra-orchestration skill).`,
    `Task ${taskId}, run ${runId}. Brief: engineering/runs/${runId}.brief.md.`,
    resuming ? "This is a resumed slice: follow the medyra-task-recovery skill, read the run record's last checkpoint and continue from the next incomplete step. Do not redo completed phases or re-run reviews that already hold for the unchanged commit." : "Start the run as the brief says.",
    "You are inside a usage-governed slice with a turn limit. Checkpoint (`npm run eng -- checkpoint`) and commit work in progress after each completed step, so stopping at any point loses nothing.",
    "Use only the roles this task needs. Never start another Claude session, cloud task or external AI service yourself.",
  ].join("\n");
}

async function runSlice(flags: Record<string, string>) {
  if (flags.execute !== "true") {
    console.log("refused: pass --execute to launch a real slice (it uses subscription allowance). Use dry-run to preview.");
    process.exitCode = 4;
    return;
  }
  const bin = process.env.MEDYRA_CLAUDE_BIN;
  if (!bin || !existsSync(bin)) {
    console.log("refused: set MEDYRA_CLAUDE_BIN to the Claude Code executable (see docs/engineering/USAGE_GOVERNOR.md)");
    process.exitCode = 4;
    return;
  }
  const config = loadConfig(root);
  const g = config.usageGovernor;
  const sliceId = `slice-${now().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
  // 1. Admission (under the state lock).
  const first = await withMutex(root, () => {
    const ledger = refreshLedger();
    const d = decide(ledger);
    saveLedger(root, record(ledger, d.decision, d.active?.id ?? null, d.active?.claim?.runId ?? null));
    return { admitted: d.decision.admitted, decision: d.decision, resuming: !!d.active };
  });
  if (!first.admitted) {
    console.log(JSON.stringify({ admitted: false, failures: first.decision.failures, nextEligibleAt: first.decision.nextEligibleAt }, null, 2));
    process.exitCode = 3;
    return;
  }
  // 2. New work is claimed by the orchestrator's own cycle, which takes the lock and re-runs admission.
  if (!first.resuming) {
    const c = node("orchestrator.ts", ["cycle", "--mode", flags.mode === "scheduled" ? "scheduled" : "manual", "--owner", "usage-runner"]);
    if (!/"claimed"/.test(c.stdout)) {
      console.log(`no slice: cycle did not claim a task: ${c.stdout.trim().slice(0, 300)}`);
      process.exitCode = 3;
      return;
    }
  }
  // 3. Start the slice (under the lock again): re-decide for the claimed task; beginSlice refuses a second runner.
  const started = await withMutex(root, () => {
    let ledger = refreshLedger();
    const d = decide(ledger);
    if (!d.decision.admitted || !d.active?.claim) return { refused: d.decision };
    ledger = beginSlice(g, ledger, { sliceId, runId: d.active.claim.runId, taskId: d.active.id, agent: ORCHESTRATOR, model: d.request.model, snapshot: d.snapshot!, now: now() });
    saveLedger(root, ledger);
    const prior = ledger.slices.filter((s) => s.runId === d.active!.claim!.runId && s.sessionId).at(-1)?.sessionId ?? null;
    return { taskId: d.active.id, runId: d.active.claim.runId, resuming: first.resuming, model: d.request.model, prior };
  });
  if ("refused" in started && started.refused) {
    console.log(JSON.stringify({ admitted: false, failures: started.refused.failures, nextEligibleAt: started.refused.nextEligibleAt }, null, 2));
    process.exitCode = 3;
    return;
  }
  const args = [
    "-p", slicePrompt(started.taskId, started.runId, started.resuming),
    "--model", started.model,
    "--max-turns", String(g.execution.sliceMaxTurns),
    "--output-format", "json",
    "--settings", ensureStatuslineSettings(),
    "--permission-mode", process.env.MEDYRA_RUNNER_PERMISSION_MODE ?? "acceptEdits",
    ...(started.prior ? ["--resume", started.prior] : []),
  ];
  // shortcut: a .mjs "binary" is run with node so tests can stand in for Claude Code; real use points at claude(.exe).
  const [cmd, cmdArgs] = bin.endsWith(".mjs") ? [process.execPath, [bin, ...args]] : [bin, args];
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8", env: sliceEnv(process.env, sliceId), timeout: g.execution.sliceTimeoutMinutes * 60_000, maxBuffer: 64 * 1024 * 1024 });
  let out: { session_id?: string; is_error?: boolean; result?: string } = {};
  try {
    out = JSON.parse(r.stdout || "{}");
  } catch {
    /* non-JSON output: treated as a failed slice */
  }
  const outcome = r.error || r.signal ? "interrupted" : out.is_error || r.status !== 0 ? "failed" : "completed";
  const notLoggedIn = /not logged in|\/login/i.test(String(out.result ?? ""));
  await withMutex(root, () => {
    let ledger = endSlice(loadLedger(root), sliceId, outcome, out.session_id ?? null, now());
    if (notLoggedIn) ledger = { ...ledger, manualPause: { reason: "headless Claude Code is not signed in to the subscription", at: now().toISOString() } };
    saveLedger(root, ledger);
  });
  node("orchestrator.ts", ["checkpoint", "--run", started.runId, "--note", `usage slice ${sliceId} ${outcome}; next slice needs fresh usage telemetry`]);
  console.log(JSON.stringify({ sliceId, taskId: started.taskId, runId: started.runId, outcome, sessionId: out.session_id ?? null, authProblem: notLoggedIn }, null, 2));
  process.exitCode = outcome === "completed" ? 0 : 3;
}

function setPath(obj: Record<string, unknown>, key: string, raw: string) {
  const parts = key.split(".");
  let o = obj;
  for (const k of parts.slice(0, -1)) o = o[k] as Record<string, unknown>;
  const v = raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : Number.isFinite(Number(raw)) ? Number(raw) : raw;
  o[parts.at(-1)!] = v;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = flagsOf(rest);
  try {
    switch (command) {
      case "status": {
        const ledger = refreshLedger();
        const d = decide(ledger, flags.model);
        if (flags.json === "true") return void console.log(JSON.stringify({ decision: d.decision, activeTask: d.active?.id ?? null }, null, 2));
        console.log(statusLines({ config: d.config, ledger, decision: d.decision, activeTask: d.active?.id ?? d.task?.id ?? null, executionEnabled: d.s.control.autonomy.executionEnabled, checkpoint: latestCheckpoint(d.active?.claim?.runId ?? d.active?.run) }).join("\n"));
        return;
      }
      case "report": {
        const ledger = refreshLedger();
        const d = decide(ledger);
        const days = Number(flags.days ?? 7);
        console.log(reportLines(d.config, ledger, d.decision, new Date(now().getTime() - days * 86_400_000)).join("\n"));
        return;
      }
      case "dry-run":
      case "admit": {
        const d = decide(refreshLedger(), flags.model);
        if (command === "admit") {
          // CI-safe: codes only, never the founder's usage figures.
          console.log(d.decision.admitted ? "admitted" : `refused: ${[...new Set(d.decision.failures.map((f) => f.code))].join(", ")}`);
        } else {
          console.log(JSON.stringify({ request: d.request, ...d.decision }, null, 2));
        }
        process.exitCode = d.decision.admitted ? 0 : 3;
        return;
      }
      case "pause":
      case "resume": {
        await withMutex(root, () => {
          const ledger = loadLedger(root);
          const manualPause = command === "pause" ? { reason: flags.reason ?? "paused by owner", at: now().toISOString() } : null;
          saveLedger(root, { ...ledger, manualPause });
        });
        console.log(command === "pause" ? "usage governor paused" : "owner pause cleared (all other checks still apply)");
        return;
      }
      case "configure": {
        const p = usagePaths(root);
        if (flags.set) {
          const [key, value] = flags.set.split("=");
          const raw = JSON.parse(readFileSync(p.config, "utf8"));
          setPath(raw.usageGovernor, key, value ?? "");
          const parsed = GovernorConfigSchema.safeParse(raw);
          if (!parsed.success) {
            console.log(`refused: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
            process.exitCode = 4;
            return;
          }
          writeJsonAtomic(p.config, parsed.data);
          console.log(`set usageGovernor.${key}`);
        }
        console.log(JSON.stringify(loadConfig(root), null, 2));
        return;
      }
      case "doctor":
        return doctor(flags);
      case "tick": {
        const result = await withMutex(root, () => {
          let ledger = refreshLedger();
          const d = decide(ledger);
          ledger = record(ledger, d.decision, d.active?.id ?? null, d.active?.claim?.runId ?? null);
          saveLedger(root, ledger);
          return { d, launch: d.decision.admitted && d.config.usageGovernor.execution.automaticResume && d.s.control.autonomy.scheduleEnabled };
        });
        const codes = [...new Set(result.d.decision.failures.map((f) => f.code))];
        console.log(result.d.decision.admitted ? (result.launch ? "eligible: launching slice" : "eligible: scheduling disabled, not launching") : `paused: ${codes.join(", ")}; next check ${result.d.decision.nextEligibleAt ?? "after owner action"}`);
        if (result.launch) await runSlice({ execute: "true", mode: "scheduled" });
        return;
      }
      case "run":
        return await runSlice(flags);
      default:
        console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));
        process.exitCode = command ? 2 : 0;
    }
  } catch (e) {
    // Corrupted ledger, config or state: fail closed and say why.
    console.log(`refused (fail closed): ${(e as Error).message}`);
    process.exitCode = 3;
  }
}

function doctor(flags: Record<string, string>) {
  const checks: [string, boolean, string][] = [];
  const p = usagePaths(root);
  const cfg = GovernorConfigSchema.safeParse(existsSync(p.config) ? JSON.parse(readFileSync(p.config, "utf8")) : null);
  checks.push(["governor.json valid", cfg.success, cfg.success ? "ok" : "invalid or missing"]);
  let ledgerOk = true;
  try {
    loadLedger(root);
  } catch {
    ledgerOk = false;
  }
  checks.push(["usage ledger readable", ledgerOk, ledgerOk ? p.ledger : "corrupted: move it aside after review; the governor stays closed meanwhile"]);
  const { snapshot, problem } = loadSnapshot(root);
  checks.push(["usage snapshot present", !!snapshot, snapshot ? `${snapshot.source}, captured ${snapshot.capturedAt}` : problem ?? `none at ${p.snapshot}: configure the status line capture`]);
  for (const k of BILLING_ENV) checks.push([`${k} unset`, !process.env[k], process.env[k] ? "SET: would bill outside the subscription" : "ok"]);
  if (cfg.success) checks.push(["extra usage confirmed off", !!cfg.data.usageGovernor.billing.extraUsageDisabledConfirmedAt, cfg.data.usageGovernor.billing.extraUsageDisabledConfirmedAt ?? "owner must check claude.ai settings and record the date"]);
  for (const file of [path.join(homedir(), ".claude", "settings.json"), path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json")]) {
    let helper = false;
    try {
      helper = !!JSON.parse(readFileSync(file, "utf8")).apiKeyHelper;
    } catch {
      /* missing or unreadable settings: nothing configured there */
    }
    checks.push([`no apiKeyHelper in ${file.startsWith(homedir()) && !file.startsWith(root) ? "user" : "project"} ${path.basename(file)}`, !helper, helper ? "apiKeyHelper would supply an API key" : "ok"]);
  }
  const bin = process.env.MEDYRA_CLAUDE_BIN;
  checks.push(["MEDYRA_CLAUDE_BIN set", !!bin && existsSync(bin), bin ?? "unset (only needed for real slices)"]);
  const s = loadState(root);
  checks.push(["execution authorized", s.control.autonomy.executionEnabled, String(s.control.autonomy.executionEnabled)]);
  for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
  if (flags.probe === "true") {
    if (!bin || !existsSync(bin)) return void console.log("probe skipped: MEDYRA_CLAUDE_BIN not set");
    // One minimal Haiku request with the capture status line, to learn whether headless runs refresh telemetry.
    const before = snapshot?.capturedAt ?? null;
    const r = spawnSync(bin, ["-p", "Reply with OK.", "--model", "haiku", "--max-turns", "1", "--output-format", "json", "--settings", ensureStatuslineSettings()], { cwd: root, encoding: "utf8", env: sliceEnv(process.env, "probe"), timeout: 120_000 });
    const after = loadSnapshot(root).snapshot?.capturedAt ?? null;
    let res = "";
    try {
      res = String(JSON.parse(r.stdout).result ?? "");
    } catch {
      res = (r.stdout || r.stderr || "").slice(0, 120);
    }
    console.log(`probe: exit ${r.status}; result "${res.slice(0, 80)}"; headless status line refreshed telemetry: ${after && after !== before ? "YES" : "NO"}`);
  }
  if (checks.some(([, ok]) => !ok)) process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void main();
