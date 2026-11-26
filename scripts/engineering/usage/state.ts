/**
 * Files behind the usage governor, and the deterministic status/report text.
 * The ledger and snapshot hold personal subscription figures: both live outside version control
 * (engineering/.local/ is git-ignored; the snapshot is in the user's home directory).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { GovernorConfigSchema, LedgerSchema, SnapshotSchema, emptyLedger, type Decision, type GovernorConfig, type Ledger, type Snapshot } from "../lib/governor.ts";
import { readJson, writeJsonAtomic } from "../lib/store.ts";

export function usagePaths(root: string) {
  const local = path.join(root, "engineering", ".local");
  return {
    config: path.join(root, "engineering", "governor.json"),
    ledger: path.join(local, "usage-ledger.json"),
    statuslineSettings: path.join(local, "statusline-settings.json"),
    snapshot: process.env.MEDYRA_USAGE_SNAPSHOT ?? path.join(homedir(), ".medyra", "usage-snapshot.json"),
  };
}

export const loadConfig = (root: string): GovernorConfig => readJson(usagePaths(root).config, GovernorConfigSchema);

/** Missing ledger = fresh start. A corrupted ledger throws: the governor fails closed, it never resets accounting. */
export function loadLedger(root: string): Ledger {
  const file = usagePaths(root).ledger;
  return existsSync(file) ? readJson(file, LedgerSchema) : emptyLedger();
}

export const saveLedger = (root: string, ledger: Ledger) => writeJsonAtomic(usagePaths(root).ledger, LedgerSchema.parse(ledger));

/** Missing or malformed snapshot = no telemetry (null). */
export function loadSnapshot(root: string): { snapshot: Snapshot | null; problem: string | null } {
  const file = usagePaths(root).snapshot;
  if (!existsSync(file)) return { snapshot: null, problem: null };
  try {
    return { snapshot: SnapshotSchema.parse(JSON.parse(readFileSync(file, "utf8"))), problem: null };
  } catch {
    return { snapshot: null, problem: "snapshot file is unreadable or malformed" };
  }
}

const p = (n: number | undefined) => (n === undefined ? "n/a" : `${n.toFixed(2)}%`);
const when = (s: string | null | undefined) => (s ? s.replace("T", " ").slice(0, 16) + " UTC" : "n/a");

export function statusLines(input: {
  config: GovernorConfig;
  ledger: Ledger;
  decision: Decision;
  activeTask: string | null;
  executionEnabled: boolean;
  checkpoint: string | null;
}): string[] {
  const { config, ledger, decision: d, activeTask } = input;
  const g = config.usageGovernor;
  const f = d.figures;
  const running = ledger.slices.find((s) => s.outcome === "running");
  const settled = ledger.slices.filter((s) => s.attributed);
  const state = running ? "RUNNING" : d.admitted ? (input.executionEnabled ? "ELIGIBLE" : "ELIGIBLE (execution disabled)") : "PAUSED";
  return [
    `Autonomous execution:   ${state}`,
    `Accounting mode:        ${g.accountingMode}${g.accountingMode === "estimated-attribution" && !g.estimatedAttributionAuthorizedByOwner ? " (not authorized: strict applied)" : ""}`,
    `Five-hour (account):    ${p(f?.accountFiveHour)}   resets ${when(f?.fiveHourResetsAt)}`,
    `Weekly (account):       ${p(f?.accountWeekly)}   resets ${when(f?.weeklyResetsAt)}`,
    `Five-hour (agents):     ${p(f?.agentFiveHour)} of ${g.fiveHour.allocationPercent}% (warn ${g.fiveHour.warningPercent}, wind-down ${g.fiveHour.checkpointPercent}, stop ${g.fiveHour.stopNewRequestsPercent})`,
    `Weekly (agents):        ${p(f?.agentWeekly)} of ${g.weekly.allocationPercent}%`,
    `Weekly pacing:          day ${f?.weekDay ?? "n/a"}, allowance so far ${p(f?.pacedCap)}, remaining ${f ? p(Math.max(0, Math.min(f.pacedCap, g.weekly.allocationPercent) - f.agentWeekly)) : "n/a"}`,
    `Slice estimate:         ${f ? `${p(f.estimate.fiveHour)} five-hour, ${p(f.estimate.weekly)} weekly` : "n/a"}`,
    `Telemetry:              ${f ? `${f.telemetryAgeMinutes} min old` : "unavailable"}; attribution ${settled.length ? `${settled.length} slice(s) settled, confidence ${settled.at(-1)!.attributed!.confidence}` : "no slices observed yet"}`,
    `Next eligible:          ${d.admitted ? "now" : d.nextEligibleAt ? when(d.nextEligibleAt) : "needs the owner"}`,
    `Active agent:           ${running ? `${running.agent} (${running.model}) slice ${running.sliceId}` : "none"}`,
    `Current task:           ${activeTask ?? "none"}`,
    `Latest checkpoint:      ${input.checkpoint ?? "none"}`,
    `Pause reasons:          ${d.failures.length ? d.failures.map((x) => `${x.code}: ${x.detail}`).join(" | ") : "none"}`,
    `Warnings:               ${d.warnings.join(" | ") || "none"}`,
    `Additional paid usage:  prohibited (API fallback off; extra usage ${g.billing.extraUsageDisabledConfirmedAt ? `confirmed off by owner ${g.billing.extraUsageDisabledConfirmedAt.slice(0, 10)}` : "NOT yet confirmed off by owner"})`,
  ];
}

/** Short section for the engineering report. Figures are account-level estimates, never billing data. */
export function reportLines(config: GovernorConfig, ledger: Ledger, decision: Decision, since: Date): string[] {
  const g = config.usageGovernor;
  const recent = ledger.slices.filter((s) => new Date(s.startedAt) >= since);
  const tasks = new Set(recent.map((s) => s.taskId).filter(Boolean));
  const f = decision.figures;
  return [
    "## Usage (subscription, estimated)",
    `- Weekly: agents ${f ? `${f.agentWeekly.toFixed(2)}%` : "n/a"} of ${g.weekly.allocationPercent}% (account ${f ? `${f.accountWeekly}%` : "n/a"}); pacing allowance ${f ? `${f.pacedCap.toFixed(2)}%` : "n/a"}`,
    `- Five-hour: agents ${f ? `${f.agentFiveHour.toFixed(2)}%` : "n/a"} of ${g.fiveHour.allocationPercent}% (account ${f ? `${f.accountFiveHour}%` : "n/a"})`,
    `- Slices since ${since.toISOString().slice(0, 10)}: ${recent.length} across ${tasks.size} task(s); pauses ${ledger.pauses.filter((x) => new Date(x.at) >= since).length}; resumes ${ledger.resumes.filter((x) => new Date(x.at) >= since).length}`,
    `- Unexpected increases: ${ledger.anomalies.filter((a) => a.kind === "overshoot" && new Date(a.at) >= since).length}`,
    `- Next execution: ${decision.admitted ? "eligible now" : decision.nextEligibleAt ?? "needs the owner"} (${decision.failures.map((x) => x.code).filter((c, i, a) => a.indexOf(c) === i).join(", ") || "no blockers"})`,
    `- Emergency stop: ${decision.failures.some((x) => x.code === "EMERGENCY_STOP") ? "ON" : "off"}`,
    `- Limits: ${g.accountingMode === "strict-account-protection" ? "strict mode counts all account usage (yours included) against the agents" : "attribution is estimated from before/after readings, never exact"}; readings come from Claude Code's status line and may lag or be rounded.`,
  ];
}
