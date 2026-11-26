/**
 * Medyra usage governor: keeps autonomous agents inside a share of the founder's Claude
 * subscription. Pure functions only (no I/O) so every rule is unit-tested with synthetic telemetry.
 *
 * Telemetry: Claude Code's documented status line fields rate_limits.five_hour / seven_day
 * (used_percentage 0-100, resets_at epoch seconds), captured by usage/statusline-capture.mjs.
 * Those numbers are ACCOUNT-WIDE: they include the founder's own Claude use.
 */
import { z } from "zod";
import type { Control } from "./model.ts";

const iso = z.string().datetime({ offset: true });
const pct = z.number().min(0).max(100);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

// ---------------------------------------------------------------------------
// Configuration. Literals encode the founder's policy, so loosening it fails validation;
// numbers may only be tightened below the stated ceilings.
// ---------------------------------------------------------------------------

export const MODELS = ["haiku", "sonnet", "opus"] as const;

export const GovernorConfigSchema = z.object({
  version: z.literal(1),
  usageGovernor: z.object({
    enabled: z.literal(true),
    primaryBudget: z.literal("weekly"),
    accountingMode: z.enum(["strict-account-protection", "estimated-attribution"]),
    /** Mode B needs validation and the owner's explicit yes; agents cannot set this in good faith. */
    estimatedAttributionAuthorizedByOwner: z.boolean(),
    weekly: z.object({
      allocationPercent: z.number().gt(0).max(25),
      pacingEnabled: z.literal(true),
      carryForwardWithinCycle: z.literal(true),
      carryForwardAcrossCycles: z.literal(false),
    }),
    fiveHour: z
      .object({
        allocationPercent: z.number().gt(0).max(10),
        warningPercent: z.number().gt(0),
        checkpointPercent: z.number().gt(0),
        stopNewRequestsPercent: z.number().gt(0),
      })
      .refine((f) => f.warningPercent < f.checkpointPercent && f.checkpointPercent < f.stopNewRequestsPercent && f.stopNewRequestsPercent <= f.allocationPercent, {
        message: "thresholds must satisfy warning < checkpoint < stop <= allocation",
      }),
    /** Mode B only: account-wide levels at which agents back off for the founder's own use. */
    sharedAccount: z.object({ weeklyStopPercent: pct, fiveHourStopPercent: pct }),
    execution: z.object({
      maxConcurrentAIRequests: z.literal(1),
      maxConcurrentImplementationTasks: z.literal(1),
      maxRemediationAttempts: z.number().int().min(0).max(2),
      automaticPause: z.literal(true),
      automaticResume: z.boolean(),
      checkpointingEnabled: z.literal(true),
      /** One admitted request = one bounded headless slice. */
      sliceMaxTurns: z.number().int().min(1).max(60),
      sliceTimeoutMinutes: z.number().int().min(5).max(45),
    }),
    /** Conservative cost of one slice before any has been observed; raised by observation, never lowered. */
    sliceEstimate: z.object({
      fiveHourPercent: z.number().gt(0).max(10),
      weeklyPercent: z.number().gt(0).max(25),
      safetyMultiplier: z.number().min(1).max(5),
    }),
    telemetry: z.object({
      maxAgeMinutes: z.number().int().min(1).max(30),
      /** Usage figures lag; a slice is only settled with a snapshot taken this long after it ended. */
      settleMinutes: z.number().int().min(1).max(60),
      /** used_percentage may be rounded; every reading is treated as this much higher. */
      roundingMarginPercent: z.number().min(0.5).max(5),
    }),
    models: z.object({
      allowed: z.array(z.enum(MODELS)).min(1),
      opusOnlyForSecuritySensitive: z.literal(true),
    }),
    scheduler: z.object({
      eligibilityCheckMinutes: z.number().int().min(5).max(60),
      preferResetBasedScheduling: z.literal(true),
      allowQuotaConsumingPolling: z.literal(false),
    }),
    billing: z.object({
      subscriptionOnly: z.literal(true),
      allowAdditionalPaidUsage: z.literal(false),
      allowApiBillingFallback: z.literal(false),
      /** Extra usage is an account setting no script can read: the owner records the date they checked it was off. */
      extraUsageDisabledConfirmedAt: iso.nullable(),
    }),
    safety: z.object({
      failClosedOnMissingTelemetry: z.literal(true),
      requireFreshTelemetry: z.literal(true),
      emergencyStopEnabled: z.literal(true),
      preventAgentBudgetBypass: z.literal(true),
    }),
  }),
});
export type GovernorConfig = z.infer<typeof GovernorConfigSchema>;
type G = GovernorConfig["usageGovernor"];

// ---------------------------------------------------------------------------
// Telemetry snapshot (written by the status line capture) and the persistent ledger
// ---------------------------------------------------------------------------

export const WindowSchema = z.object({ usedPercent: pct, resetsAt: iso });
export type Window = z.infer<typeof WindowSchema>;

export const SnapshotSchema = z.object({
  version: z.literal(1),
  source: z.enum(["statusline", "synthetic"]),
  capturedAt: iso,
  claudeCodeVersion: z.string().nullable(),
  fiveHour: WindowSchema.nullable(),
  sevenDay: WindowSchema.nullable(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const Reading = z.object({ fiveHour: WindowSchema.nullable(), sevenDay: WindowSchema.nullable() });

export const SliceSchema = z.object({
  sliceId: z.string().min(6),
  runId: z.string().nullable(),
  taskId: z.string().nullable(),
  agent: z.string(),
  model: z.enum(MODELS),
  startedAt: iso,
  expiresAt: iso,
  endedAt: iso.nullable(),
  outcome: z.enum(["running", "completed", "interrupted", "failed"]),
  sessionId: z.string().nullable(),
  before: Reading,
  after: Reading.nullable(),
  attributed: z.object({ fiveHourPercent: z.number().min(0), weeklyPercent: z.number().min(0), confidence: z.enum(["low", "medium"]) }).nullable(),
});
export type Slice = z.infer<typeof SliceSchema>;

export const LedgerSchema = z.object({
  version: z.literal(1),
  manualPause: z.object({ reason: z.string(), at: iso }).nullable(),
  slices: z.array(SliceSchema),
  pauses: z.array(z.object({ at: iso, codes: z.array(z.string()), taskId: z.string().nullable(), nextEligibleAt: iso.nullable() })),
  resumes: z.array(z.object({ at: iso, taskId: z.string().nullable() })),
  anomalies: z.array(z.object({ at: iso, kind: z.string(), detail: z.string() })),
  lastDecision: z.object({ at: iso, admitted: z.boolean(), codes: z.array(z.string()), nextEligibleAt: iso.nullable() }).nullable(),
});
export type Ledger = z.infer<typeof LedgerSchema>;

export const emptyLedger = (): Ledger => ({ version: 1, manualPause: null, slices: [], pauses: [], resumes: [], anomalies: [], lastDecision: null });

// ---------------------------------------------------------------------------
// Pacing and usage
// ---------------------------------------------------------------------------

const t = (s: string) => new Date(s).getTime();

/** Start of the subscription week, derived from the real reset time (never from the calendar). */
export const weekStart = (sevenDay: Window) => t(sevenDay.resetsAt) - WEEK;

/** Day 1..7 of the current subscription week. */
export function weekDay(sevenDay: Window, now: Date): number {
  return Math.min(7, Math.max(1, Math.floor((now.getTime() - weekStart(sevenDay)) / DAY) + 1));
}

/** Cumulative agent allowance so far this week (unused days carry forward inside the week only). */
export function pacedWeeklyCap(g: G, sevenDay: Window, now: Date): number {
  return (g.weekly.allocationPercent * weekDay(sevenDay, now)) / 7;
}

/** Largest observed slice cost (times the multiplier) or the configured estimate, whichever is higher. */
export function sliceEstimate(g: G, ledger: Ledger): { fiveHour: number; weekly: number } {
  const seen = ledger.slices.filter((s) => s.attributed).slice(-20);
  const m = g.sliceEstimate.safetyMultiplier;
  return {
    fiveHour: Math.max(g.sliceEstimate.fiveHourPercent, ...seen.map((s) => s.attributed!.fiveHourPercent * m)),
    weekly: Math.max(g.sliceEstimate.weeklyPercent, ...seen.map((s) => s.attributed!.weeklyPercent * m)),
  };
}

/**
 * Usage counted against the agents' allocation.
 * Strict mode: everything the account used in the window (the founder's own use included).
 * Estimated mode: attributed slice deltas in the same window, unsettled slices at the estimate.
 */
export function agentUsage(g: G, ledger: Ledger, snap: Snapshot): { fiveHour: number; weekly: number } {
  const margin = g.telemetry.roundingMarginPercent;
  if (g.accountingMode === "strict-account-protection" || !g.estimatedAttributionAuthorizedByOwner) {
    return { fiveHour: snap.fiveHour!.usedPercent + margin, weekly: snap.sevenDay!.usedPercent + margin };
  }
  const est = sliceEstimate(g, ledger);
  const inWindow = (s: Slice, w: Window, span: number) => t(s.startedAt) >= t(w.resetsAt) - span;
  let fiveHour = 0;
  let weekly = 0;
  for (const s of ledger.slices) {
    if (inWindow(s, snap.fiveHour!, 5 * HOUR)) fiveHour += s.attributed ? s.attributed.fiveHourPercent : est.fiveHour;
    if (inWindow(s, snap.sevenDay!, WEEK)) weekly += s.attributed ? s.attributed.weeklyPercent : est.weekly;
  }
  return { fiveHour: fiveHour + margin, weekly: weekly + margin };
}

// ---------------------------------------------------------------------------
// Admission controller
// ---------------------------------------------------------------------------

/** Environment variables that would make Claude Code bill an API account or another provider. */
export const BILLING_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] as const;
/** Removed from a slice's environment as well, so it talks to the default endpoint with the subscription login. */
export const SLICE_SCRUB_ENV = [...BILLING_ENV, "ANTHROPIC_BASE_URL"] as const;

export type Code =
  | "EMERGENCY_STOP"
  | "PAID_USAGE"
  | "NOT_AUTHORIZED"
  | "TELEMETRY"
  | "WEEKLY_BUDGET"
  | "WEEKLY_PACING"
  | "SHARED_ACCOUNT"
  | "FIVE_HOUR"
  | "MODEL"
  | "CONCURRENCY"
  | "TASK";

export interface AdmissionRequest {
  kind: "new-task" | "continue";
  taskId: string | null;
  taskApproved: boolean;
  model: (typeof MODELS)[number];
  securitySensitive: boolean;
}

export interface Decision {
  admitted: boolean;
  failures: { code: Code; detail: string }[];
  warnings: string[];
  nextEligibleAt: string | null;
  figures: null | {
    accountFiveHour: number;
    accountWeekly: number;
    agentFiveHour: number;
    agentWeekly: number;
    pacedCap: number;
    weekDay: number;
    estimate: { fiveHour: number; weekly: number };
    fiveHourResetsAt: string;
    weeklyResetsAt: string;
    telemetryAgeMinutes: number;
  };
}

/** Problems with the telemetry itself; any one means "do not run". */
export function telemetryProblems(g: G, ledger: Ledger, snap: Snapshot | null, now: Date): string[] {
  if (!snap) return ["no usage snapshot (status line capture not configured, or no subscriber session has reported yet)"];
  const p: string[] = [];
  if (!snap.fiveHour || !snap.sevenDay) p.push("snapshot lacks the five-hour or weekly window");
  const age = (now.getTime() - t(snap.capturedAt)) / 60_000;
  if (age < -5) p.push("snapshot is dated in the future");
  if (age > g.telemetry.maxAgeMinutes) p.push(`snapshot is ${Math.round(age)} min old (max ${g.telemetry.maxAgeMinutes})`);
  // A passed reset time means the snapshot describes an old window: never assume usage dropped.
  if (snap.fiveHour && t(snap.fiveHour.resetsAt) <= now.getTime()) p.push("five-hour window in the snapshot has already reset; waiting for a fresh reading");
  if (snap.sevenDay && t(snap.sevenDay.resetsAt) <= now.getTime()) p.push("weekly window in the snapshot has already reset; waiting for a fresh reading");
  const lastEnd = ledger.slices.map((s) => s.endedAt).filter(Boolean).sort().at(-1);
  if (lastEnd && t(snap.capturedAt) < t(lastEnd) + g.telemetry.settleMinutes * 60_000) {
    p.push("no reading taken after the last agent slice settled");
  }
  return p;
}

export function admit(input: {
  config: GovernorConfig;
  ledger: Ledger;
  snapshot: Snapshot | null;
  control: Control;
  env: Record<string, string | undefined>;
  now: Date;
  request: AdmissionRequest;
}): Decision {
  const g = input.config.usageGovernor;
  const { ledger, snapshot: snap, control, env, now, request } = input;
  const failures: Decision["failures"] = [];
  const warnings: string[] = [];
  const fail = (code: Code, detail: string) => failures.push({ code, detail });

  // 1. Emergency stop
  if (control.paused) fail("EMERGENCY_STOP", `control.json paused${control.pauseReason ? `: ${control.pauseReason}` : ""}`);
  if (env.MEDYRA_AUTONOMY_PAUSED === "true") fail("EMERGENCY_STOP", "MEDYRA_AUTONOMY_PAUSED=true");
  if (ledger.manualPause) fail("EMERGENCY_STOP", `usage governor paused by owner: ${ledger.manualPause.reason}`);
  // 2. No paid usage, no API fallback
  for (const k of BILLING_ENV) if (env[k]) fail("PAID_USAGE", `${k} is set; it would route requests away from the subscription`);
  if (!g.billing.extraUsageDisabledConfirmedAt) fail("PAID_USAGE", "owner has not recorded that claude.ai extra usage is turned off");
  // authorization
  if (!control.autonomy.executionEnabled) fail("NOT_AUTHORIZED", "control.autonomy.executionEnabled is false");
  // 3. Telemetry
  const tp = telemetryProblems(g, ledger, snap, now);
  for (const d of tp) fail("TELEMETRY", d);

  let figures: Decision["figures"] = null;
  const est = sliceEstimate(g, ledger);
  if (tp.length === 0 && snap?.fiveHour && snap.sevenDay) {
    const used = agentUsage(g, ledger, snap);
    const cap = pacedWeeklyCap(g, snap.sevenDay, now);
    figures = {
      accountFiveHour: snap.fiveHour.usedPercent,
      accountWeekly: snap.sevenDay.usedPercent,
      agentFiveHour: used.fiveHour,
      agentWeekly: used.weekly,
      pacedCap: cap,
      weekDay: weekDay(snap.sevenDay, now),
      estimate: est,
      fiveHourResetsAt: snap.fiveHour.resetsAt,
      weeklyResetsAt: snap.sevenDay.resetsAt,
      telemetryAgeMinutes: Math.round((now.getTime() - t(snap.capturedAt)) / 60_000),
    };
    // 4. Weekly budget, 5. pacing
    if (used.weekly + est.weekly > g.weekly.allocationPercent) fail("WEEKLY_BUDGET", `weekly ${used.weekly.toFixed(2)}% + slice ${est.weekly.toFixed(2)}% > ${g.weekly.allocationPercent}%`);
    else if (used.weekly + est.weekly > cap) fail("WEEKLY_PACING", `weekly ${used.weekly.toFixed(2)}% + slice ${est.weekly.toFixed(2)}% > day-${figures.weekDay} allowance ${cap.toFixed(2)}%`);
    // 6. Shared-account protection (estimated mode; strict mode already counts everything)
    if (g.accountingMode === "estimated-attribution") {
      if (!g.estimatedAttributionAuthorizedByOwner) warnings.push("estimated attribution not authorized by owner: strict accounting applied");
      if (snap.sevenDay.usedPercent >= g.sharedAccount.weeklyStopPercent) fail("SHARED_ACCOUNT", `account weekly ${snap.sevenDay.usedPercent}% >= ${g.sharedAccount.weeklyStopPercent}%`);
      if (snap.fiveHour.usedPercent >= g.sharedAccount.fiveHourStopPercent) fail("SHARED_ACCOUNT", `account five-hour ${snap.fiveHour.usedPercent}% >= ${g.sharedAccount.fiveHourStopPercent}%`);
    }
    // 7. Five-hour safeguard
    if (used.fiveHour >= g.fiveHour.warningPercent) warnings.push(`five-hour usage ${used.fiveHour.toFixed(2)}% reached the ${g.fiveHour.warningPercent}% warning level`);
    if (request.kind === "new-task" && used.fiveHour >= g.fiveHour.checkpointPercent) fail("FIVE_HOUR", `five-hour ${used.fiveHour.toFixed(2)}% >= wind-down ${g.fiveHour.checkpointPercent}%: no new tasks`);
    else if (used.fiveHour + est.fiveHour > g.fiveHour.stopNewRequestsPercent) fail("FIVE_HOUR", `five-hour ${used.fiveHour.toFixed(2)}% + slice ${est.fiveHour.toFixed(2)}% > ${g.fiveHour.stopNewRequestsPercent}%`);
  }
  // 8. Model restrictions (no per-model telemetry is documented, so this is policy only)
  if (!g.models.allowed.includes(request.model)) fail("MODEL", `${request.model} is not an allowed model`);
  if (request.model === "opus" && !request.securitySensitive) fail("MODEL", "opus is reserved for security-sensitive work");
  // 9. Concurrency
  const active = ledger.slices.filter((s) => s.outcome === "running" && t(s.expiresAt) > now.getTime());
  if (active.length >= g.execution.maxConcurrentAIRequests) fail("CONCURRENCY", `slice ${active[0].sliceId} is still running`);
  // 10. Task approval
  if (!request.taskApproved) fail("TASK", request.taskId ? `${request.taskId} is not approved for execution` : "no approved task is eligible");

  return { admitted: failures.length === 0, failures, warnings, nextEligibleAt: nextEligibleAt(g, ledger, snap, failures, now, est), figures };
}

/**
 * Earliest time the blockers could clear, computed from real reset times; null when a human must act.
 * Reaching this time only allows re-checking: fresh telemetry is still required.
 */
export function nextEligibleAt(g: G, ledger: Ledger, snap: Snapshot | null, failures: Decision["failures"], now: Date, est: { weekly: number }): string | null {
  const codes = new Set(failures.map((f) => f.code));
  if (codes.size === 0) return now.toISOString();
  if (["EMERGENCY_STOP", "PAID_USAGE", "NOT_AUTHORIZED", "MODEL", "TASK"].some((c) => codes.has(c as Code))) return null;
  const settle = g.telemetry.settleMinutes * 60_000;
  const times: number[] = [];
  if (codes.has("TELEMETRY")) times.push(now.getTime() + g.scheduler.eligibilityCheckMinutes * 60_000);
  if (snap?.sevenDay && codes.has("WEEKLY_BUDGET")) times.push(t(snap.sevenDay.resetsAt) + settle);
  if (snap?.sevenDay && codes.has("WEEKLY_PACING")) {
    const used = agentUsage(g, ledger, snap).weekly + est.weekly;
    const day = Math.ceil((used * 7) / g.weekly.allocationPercent);
    times.push(day > 7 ? t(snap.sevenDay.resetsAt) + settle : weekStart(snap.sevenDay) + (day - 1) * DAY);
  }
  if (snap?.fiveHour && (codes.has("FIVE_HOUR") || codes.has("SHARED_ACCOUNT"))) times.push(t(snap.fiveHour.resetsAt) + settle);
  if (codes.has("SHARED_ACCOUNT") && snap?.sevenDay && snap.sevenDay.usedPercent >= g.sharedAccount.weeklyStopPercent) times.push(t(snap.sevenDay.resetsAt) + settle);
  if (codes.has("CONCURRENCY")) {
    const run = ledger.slices.find((s) => s.outcome === "running");
    if (run) times.push(t(run.expiresAt));
  }
  return new Date(Math.max(now.getTime(), ...times)).toISOString();
}

// ---------------------------------------------------------------------------
// Slice accounting
// ---------------------------------------------------------------------------

export function beginSlice(
  g: G,
  ledger: Ledger,
  s: { sliceId: string; runId: string | null; taskId: string | null; agent: string; model: Slice["model"]; snapshot: Snapshot; now: Date },
): Ledger {
  if (ledger.slices.some((x) => x.sliceId === s.sliceId)) throw new Error(`slice ${s.sliceId} already recorded`);
  if (ledger.slices.some((x) => x.outcome === "running" && t(x.expiresAt) > s.now.getTime())) throw new Error("another AI request is running");
  const slice: Slice = {
    sliceId: s.sliceId,
    runId: s.runId,
    taskId: s.taskId,
    agent: s.agent,
    model: s.model,
    startedAt: s.now.toISOString(),
    expiresAt: new Date(s.now.getTime() + (g.execution.sliceTimeoutMinutes + 5) * 60_000).toISOString(),
    endedAt: null,
    outcome: "running",
    sessionId: null,
    before: { fiveHour: s.snapshot.fiveHour, sevenDay: s.snapshot.sevenDay },
    after: null,
    attributed: null,
  };
  return { ...ledger, slices: [...ledger.slices, slice] };
}

export function endSlice(ledger: Ledger, sliceId: string, outcome: Exclude<Slice["outcome"], "running">, sessionId: string | null, now: Date): Ledger {
  return {
    ...ledger,
    slices: ledger.slices.map((s) => (s.sliceId === sliceId && s.outcome === "running" ? { ...s, outcome, sessionId, endedAt: now.toISOString() } : s)),
  };
}

/** A slice whose process vanished (crash, reboot) is closed as interrupted once its lease passes. */
export function expireSlices(ledger: Ledger, now: Date): Ledger {
  return {
    ...ledger,
    slices: ledger.slices.map((s) => (s.outcome === "running" && t(s.expiresAt) <= now.getTime() ? { ...s, outcome: "interrupted" as const, endedAt: s.expiresAt } : s)),
  };
}

function delta(before: Window | null, after: Window | null, fallback: number): { value: number; crossed: boolean; negative: boolean } {
  if (!before || !after) return { value: fallback, crossed: true, negative: false };
  if (after.resetsAt !== before.resetsAt) return { value: after.usedPercent + fallback, crossed: true, negative: false };
  const d = after.usedPercent - before.usedPercent;
  return { value: Math.max(0, d), crossed: false, negative: d < 0 };
}

/**
 * Attribute each ended slice once, using the first snapshot taken after it settled. The whole
 * account-wide increase is attributed to the agents (the founder's use during a slice counts
 * against Medyra), so the estimate errs high. Idempotent: settled slices are never touched again.
 */
export function settleSlices(g: G, ledger: Ledger, snap: Snapshot | null, now: Date): Ledger {
  if (!snap) return ledger;
  const est = sliceEstimate(g, ledger);
  const anomalies = [...ledger.anomalies];
  const slices = ledger.slices.map((s) => {
    if (s.attributed || !s.endedAt || t(snap.capturedAt) < t(s.endedAt) + g.telemetry.settleMinutes * 60_000) return s;
    const f = delta(s.before.fiveHour, snap.fiveHour, est.fiveHour);
    const w = delta(s.before.sevenDay, snap.sevenDay, est.weekly);
    if (f.negative || w.negative) anomalies.push({ at: now.toISOString(), kind: "usage-decreased", detail: `${s.sliceId}: reading fell inside one window (rounding or delayed report)` });
    if (f.value > est.fiveHour || w.value > est.weekly) anomalies.push({ at: now.toISOString(), kind: "overshoot", detail: `${s.sliceId}: observed ${f.value.toFixed(2)}% / ${w.value.toFixed(2)}% vs estimate ${est.fiveHour.toFixed(2)}% / ${est.weekly.toFixed(2)}%` });
    return {
      ...s,
      after: { fiveHour: snap.fiveHour, sevenDay: snap.sevenDay },
      attributed: { fiveHourPercent: f.value, weeklyPercent: w.value, confidence: f.crossed || w.crossed ? ("low" as const) : ("medium" as const) },
    };
  });
  return { ...ledger, slices, anomalies };
}
