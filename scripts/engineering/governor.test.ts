// @vitest-environment node
//
// Usage governor tests. All telemetry is synthetic: nothing here sends a request to Claude.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { holdClaimForPause, recoverStale } from "./lib/engine.ts";
import {
  GovernorConfigSchema,
  admit,
  agentUsage,
  beginSlice,
  emptyLedger,
  endSlice,
  expireSlices,
  pacedWeeklyCap,
  settleSlices,
  sliceEstimate,
  type AdmissionRequest,
  type GovernorConfig,
  type Ledger,
  type Snapshot,
} from "./lib/governor.ts";
import { BacklogSchema, ControlSchema, type Control } from "./lib/model.ts";
import { capture, mergeWindow } from "./usage/statusline-capture.mjs";
import { sliceEnv } from "./usage/cli.ts";

const repo = path.resolve(import.meta.dirname, "../..");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK_START = Date.parse("2026-11-23T00:00:00Z");
const WEEK_RESET = new Date(WEEK_START + 7 * DAY).toISOString();
/** Noon on day `d` (1-7) of the subscription week. */
const onDay = (d: number) => new Date(WEEK_START + (d - 1) * DAY + 12 * HOUR);

const baseConfig = JSON.parse(readFileSync(path.join(repo, "engineering/governor.json"), "utf8"));
const config = (mut: (g: GovernorConfig["usageGovernor"]) => void = () => {}): GovernorConfig => {
  const c = structuredClone(baseConfig);
  c.usageGovernor.billing.extraUsageDisabledConfirmedAt = "2026-11-20T00:00:00Z";
  mut(c.usageGovernor);
  return GovernorConfigSchema.parse(c);
};
const control = (over: Partial<Control> = {}, autonomy: Partial<Control["autonomy"]> = {}): Control =>
  ControlSchema.parse({
    version: 1,
    paused: false,
    autonomy: { executionEnabled: true, scheduleEnabled: true, autoIntegrateToDev: false, hostedDevMigrations: false, ...autonomy },
    limits: { maxConcurrentImplementations: 1, maxRemediationAttempts: 2, maxTasksPerCycle: 1, maxCycleMinutes: 45, claimTtlMinutes: 90, perRunUsd: 5, perDayUsd: 10, perMonthUsd: 100 },
    models: {},
    ...over,
  });
const snap = (now: Date, fiveHour: number, weekly: number, over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1,
  source: "synthetic",
  capturedAt: new Date(now.getTime() - 60_000).toISOString(),
  claudeCodeVersion: "test",
  fiveHour: { usedPercent: fiveHour, resetsAt: new Date(now.getTime() + 2 * HOUR).toISOString() },
  sevenDay: { usedPercent: weekly, resetsAt: WEEK_RESET },
  ...over,
});
const req = (over: Partial<AdmissionRequest> = {}): AdmissionRequest => ({ kind: "continue", taskId: "FEAT-001", taskApproved: true, model: "sonnet", securitySensitive: false, ...over });
const decide = (o: { now: Date; snapshot: Snapshot | null; ledger?: Ledger; cfg?: GovernorConfig; ctl?: Control; env?: Record<string, string>; request?: Partial<AdmissionRequest> }) =>
  admit({ config: o.cfg ?? config(), ledger: o.ledger ?? emptyLedger(), snapshot: o.snapshot, control: o.ctl ?? control(), env: o.env ?? {}, now: o.now, request: req(o.request) });
const codes = (d: ReturnType<typeof decide>) => [...new Set(d.failures.map((f) => f.code))];
const g = () => config().usageGovernor;

describe("weekly budget and pacing", () => {
  it("admits a slice when every limit allows it", () => {
    const d = decide({ now: onDay(4), snapshot: snap(onDay(4), 1, 5) });
    expect(codes(d)).toEqual([]);
    expect(d.admitted).toBe(true);
  });

  it("paces the weekly allocation from the real reset time: 3.57% a day, cumulative", () => {
    expect(pacedWeeklyCap(g(), snap(onDay(1), 0, 0).sevenDay!, onDay(1))).toBeCloseTo(3.57, 2);
    expect(pacedWeeklyCap(g(), snap(onDay(4), 0, 0).sevenDay!, onDay(4))).toBeCloseTo(14.29, 2);
    expect(pacedWeeklyCap(g(), snap(onDay(7), 0, 0).sevenDay!, onDay(7))).toBe(25);
  });

  it("stops at the pacing allowance and schedules the next day boundary", () => {
    const d = decide({ now: onDay(1), snapshot: snap(onDay(1), 1, 3) }); // 3 + 0.5 margin + 0.5 slice > 3.57
    expect(codes(d)).toEqual(["WEEKLY_PACING"]);
    expect(d.nextEligibleAt).toBe(new Date(WEEK_START + DAY).toISOString());
  });

  it("carries unused allowance forward within the week", () => {
    expect(decide({ now: onDay(5), snapshot: snap(onDay(5), 1, 16) }).admitted).toBe(true); // cap 17.86
  });

  it("never carries allowance into a new week", () => {
    // A new week starts; the old week was barely used, yet day 1 still caps at 3.57%.
    const newWeekStart = Date.parse(WEEK_RESET);
    const now = new Date(newWeekStart + 12 * HOUR);
    const s = snap(now, 1, 4, { sevenDay: { usedPercent: 4, resetsAt: new Date(newWeekStart + 7 * DAY).toISOString() } });
    expect(codes(decide({ now, snapshot: s }))).toEqual(["WEEKLY_PACING"]);
  });

  it("pauses at weekly exhaustion until the weekly reset", () => {
    const d = decide({ now: onDay(7), snapshot: snap(onDay(7), 0, 24.5) });
    expect(codes(d)).toEqual(["WEEKLY_BUDGET"]);
    expect(Date.parse(d.nextEligibleAt!)).toBeGreaterThan(Date.parse(WEEK_RESET));
  });

  it("a five-hour reset does not reopen an exhausted week", () => {
    const now = onDay(7);
    const fresh5h = snap(now, 0, 25, { fiveHour: { usedPercent: 0, resetsAt: new Date(now.getTime() + 5 * HOUR).toISOString() } });
    expect(codes(decide({ now, snapshot: fresh5h }))).toEqual(["WEEKLY_BUDGET"]);
  });

  it("a weekly reset with fresh telemetry reopens execution", () => {
    const newWeek = Date.parse(WEEK_RESET);
    const now = new Date(newWeek + HOUR);
    const s = snap(now, 0, 0, { sevenDay: { usedPercent: 0, resetsAt: new Date(newWeek + 7 * DAY).toISOString() } });
    expect(decide({ now, snapshot: s }).admitted).toBe(true);
  });
});

describe("five-hour safeguard", () => {
  it("stops new requests before 9% (reading + margin + slice estimate)", () => {
    expect(decide({ now: onDay(3), snapshot: snap(onDay(3), 6.5, 2) }).admitted).toBe(true); // 6.5+0.5+2 = 9
    const d = decide({ now: onDay(3), snapshot: snap(onDay(3), 6.6, 2) });
    expect(codes(d)).toEqual(["FIVE_HOUR"]);
    expect(Date.parse(d.nextEligibleAt!)).toBeGreaterThan(onDay(3).getTime() + 2 * HOUR);
  });

  it("winds down at 8%: no new task, and warns from 7%", () => {
    const d = decide({ now: onDay(3), snapshot: snap(onDay(3), 7.6, 2), request: { kind: "new-task" } });
    expect(codes(d)).toEqual(["FIVE_HOUR"]);
    expect(d.failures[0].detail).toMatch(/wind-down/);
    expect(decide({ now: onDay(3), snapshot: snap(onDay(3), 6.6, 2), request: { kind: "continue" } }).warnings.join()).toMatch(/warning/);
  });

  it("treats rounded readings as higher than shown", () => {
    expect(agentUsage(g(), emptyLedger(), snap(onDay(2), 5, 5))).toEqual({ fiveHour: 5.5, weekly: 5.5 });
  });
});

describe("telemetry fails closed", () => {
  it("refuses with no snapshot", () => {
    expect(codes(decide({ now: onDay(2), snapshot: null }))).toEqual(["TELEMETRY"]);
  });

  it("refuses a stale snapshot and re-checks in 15 minutes", () => {
    const d = decide({ now: onDay(2), snapshot: snap(onDay(2), 1, 1, { capturedAt: new Date(onDay(2).getTime() - 20 * 60_000).toISOString() }) });
    expect(codes(d)).toEqual(["TELEMETRY"]);
    expect(d.nextEligibleAt).toBe(new Date(onDay(2).getTime() + 15 * 60_000).toISOString());
  });

  it("refuses a snapshot whose window already reset instead of assuming usage dropped", () => {
    const now = onDay(2);
    const s = snap(now, 9.5, 1, { fiveHour: { usedPercent: 9.5, resetsAt: new Date(now.getTime() - 60_000).toISOString() } });
    expect(decide({ now, snapshot: s }).failures[0].detail).toMatch(/already reset/);
  });

  it("refuses a missing window and a snapshot from the future", () => {
    expect(codes(decide({ now: onDay(2), snapshot: snap(onDay(2), 1, 1, { sevenDay: null }) }))).toEqual(["TELEMETRY"]);
    expect(codes(decide({ now: onDay(2), snapshot: snap(onDay(2), 1, 1, { capturedAt: new Date(onDay(2).getTime() + HOUR).toISOString() }) }))).toEqual(["TELEMETRY"]);
  });

  it("waits for a reading taken after the last slice settled (delayed usage updates)", () => {
    const now = onDay(3);
    let ledger = beginSlice(g(), emptyLedger(), { sliceId: "slice-a1", runId: null, taskId: "FEAT-001", agent: "o", model: "sonnet", snapshot: snap(now, 1, 3), now: new Date(now.getTime() - 30 * 60_000) });
    ledger = endSlice(ledger, "slice-a1", "completed", "s1", new Date(now.getTime() - 3 * 60_000));
    const early = snap(now, 1, 3, { capturedAt: new Date(now.getTime() - 2 * 60_000).toISOString() }); // 1 min after the end
    expect(decide({ now, snapshot: early, ledger }).failures.map((f) => f.detail).join()).toMatch(/after the last agent slice/);
    expect(decide({ now, snapshot: snap(now, 3, 4, { capturedAt: now.toISOString() }), ledger }).admitted).toBe(true);
  });
});

describe("attribution and the ledger", () => {
  const ran = (now: Date, before: Snapshot) => {
    const l = beginSlice(g(), emptyLedger(), { sliceId: "slice-b1", runId: null, taskId: "FEAT-001", agent: "o", model: "sonnet", snapshot: before, now: new Date(now.getTime() - 20 * 60_000) });
    return endSlice(l, "slice-b1", "completed", "s1", new Date(now.getTime() - 10 * 60_000));
  };

  it("attributes the whole account increase to the slice, including the founder's own use", () => {
    const now = onDay(3);
    const after = snap(now, 4, 5); // 3 points in five hours, 2 in the week, some of it personal
    const l = settleSlices(g(), ran(now, snap(now, 1, 3)), after, now);
    expect(l.slices[0].attributed).toEqual({ fiveHourPercent: 3, weeklyPercent: 2, confidence: "medium" });
  });

  it("settles each slice exactly once (no duplicate accounting)", () => {
    const now = onDay(3);
    const once = settleSlices(g(), ran(now, snap(now, 1, 3)), snap(now, 4, 5), now);
    const twice = settleSlices(g(), once, snap(now, 9, 9), now);
    expect(twice.slices[0].attributed).toEqual(once.slices[0].attributed);
    expect(() => beginSlice(g(), twice, { sliceId: "slice-b1", runId: null, taskId: null, agent: "o", model: "sonnet", snapshot: snap(now, 1, 1), now })).toThrow(/already recorded/);
  });

  it("records an overshoot and raises later estimates; a falling reading is an anomaly, not credit", () => {
    const now = onDay(3);
    const l = settleSlices(g(), ran(now, snap(now, 1, 3)), snap(now, 6, 4), now);
    expect(l.anomalies.map((a) => a.kind)).toContain("overshoot");
    expect(sliceEstimate(g(), l).fiveHour).toBeCloseTo(5 * 1.25);
    const down = settleSlices(g(), ran(now, snap(now, 3, 3)), snap(now, 2, 3), now);
    expect(down.slices[0].attributed!.fiveHourPercent).toBe(0);
    expect(down.anomalies.map((a) => a.kind)).toContain("usage-decreased");
  });

  it("charges the estimate when a window resets during a slice (low confidence)", () => {
    const now = onDay(3);
    const after = snap(now, 1, 3, { fiveHour: { usedPercent: 1, resetsAt: new Date(now.getTime() + 5 * HOUR).toISOString() } });
    const l = settleSlices(g(), ran(now, snap(now, 1, 3)), after, now);
    expect(l.slices[0].attributed).toMatchObject({ fiveHourPercent: 1 + 2, confidence: "low" });
  });

  it("strict mode counts personal usage against the agents; estimated mode needs the owner's yes", () => {
    const now = onDay(3);
    expect(codes(decide({ now, snapshot: snap(now, 8, 3) }))).toEqual(["FIVE_HOUR"]); // all personal, still paused
    const est = config((x) => { x.accountingMode = "estimated-attribution"; });
    expect(codes(decide({ now, snapshot: snap(now, 8, 3), cfg: est }))).toEqual(["FIVE_HOUR"]); // not authorized: strict applied
    const authorized = config((x) => { x.accountingMode = "estimated-attribution"; x.estimatedAttributionAuthorizedByOwner = true; });
    expect(decide({ now, snapshot: snap(now, 8, 3), cfg: authorized }).admitted).toBe(true);
    expect(codes(decide({ now, snapshot: snap(now, 61, 3), cfg: authorized }))).toContain("SHARED_ACCOUNT");
  });
});

describe("authority, billing and bypass", () => {
  it("emergency stop wins from any of its three sources", () => {
    const now = onDay(3);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), ctl: control({ paused: true }) }))).toEqual(["EMERGENCY_STOP"]);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), env: { MEDYRA_AUTONOMY_PAUSED: "true" } }))).toEqual(["EMERGENCY_STOP"]);
    const l: Ledger = { ...emptyLedger(), manualPause: { reason: "holiday", at: now.toISOString() } };
    const d = decide({ now, snapshot: snap(now, 0, 0), ledger: l });
    expect(codes(d)).toEqual(["EMERGENCY_STOP"]);
    expect(d.nextEligibleAt).toBeNull();
  });

  it("refuses API credentials, provider switches and unconfirmed extra usage", () => {
    const now = onDay(3);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), env: { ANTHROPIC_API_KEY: "x" } }))).toEqual(["PAID_USAGE"]);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), env: { CLAUDE_CODE_USE_BEDROCK: "1" } }))).toEqual(["PAID_USAGE"]);
    const unconfirmed = config((x) => { x.billing.extraUsageDisabledConfirmedAt = null; });
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), cfg: unconfirmed }))).toEqual(["PAID_USAGE"]);
  });

  it("strips credentials and owner mode from a slice's environment", () => {
    const env = sliceEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "u", MEDYRA_OWNER_MODE: "1", PATH: "p" }, "slice-x");
    expect(env).toEqual({ PATH: "p", MEDYRA_GOVERNED_SLICE: "slice-x" });
  });

  it("refuses unauthorized execution and unapproved tasks", () => {
    const now = onDay(3);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), ctl: control({}, { executionEnabled: false }) }))).toEqual(["NOT_AUTHORIZED"]);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), request: { taskApproved: false } }))).toEqual(["TASK"]);
  });

  it("restricts models: opus only for security-sensitive work, only allowed models", () => {
    const now = onDay(3);
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), request: { model: "opus" } }))).toEqual(["MODEL"]);
    expect(decide({ now, snapshot: snap(now, 0, 0), request: { model: "opus", securitySensitive: true } }).admitted).toBe(true);
    const noOpus = config((x) => { x.models.allowed = ["sonnet", "haiku"]; });
    expect(codes(decide({ now, snapshot: snap(now, 0, 0), cfg: noOpus, request: { model: "opus", securitySensitive: true } }))).toEqual(["MODEL"]);
  });

  it("the config cannot be loosened past the founder's policy", () => {
    for (const mut of [
      (x: Record<string, Record<string, unknown>>) => { x.weekly.allocationPercent = 30; },
      (x: Record<string, Record<string, unknown>>) => { x.fiveHour.allocationPercent = 15; },
      (x: Record<string, Record<string, unknown>>) => { x.billing.allowApiBillingFallback = true; },
      (x: Record<string, Record<string, unknown>>) => { x.billing.allowAdditionalPaidUsage = true; },
      (x: Record<string, Record<string, unknown>>) => { x.weekly.carryForwardAcrossCycles = true; },
      (x: Record<string, Record<string, unknown>>) => { x.safety.failClosedOnMissingTelemetry = false; },
      (x: Record<string, Record<string, unknown>>) => { x.scheduler.allowQuotaConsumingPolling = true; },
      (x: Record<string, Record<string, unknown>>) => { x.execution.maxConcurrentAIRequests = 2; },
      (x: Record<string, Record<string, unknown>>) => { x.fiveHour.stopNewRequestsPercent = 6; },
    ]) {
      const c = structuredClone(baseConfig);
      mut(c.usageGovernor);
      expect(GovernorConfigSchema.safeParse(c).success).toBe(false);
    }
  });
});

describe("concurrency, interruption and resumption", () => {
  it("allows one AI request at a time", () => {
    const now = onDay(3);
    const l = beginSlice(g(), emptyLedger(), { sliceId: "slice-c1", runId: null, taskId: "FEAT-001", agent: "o", model: "sonnet", snapshot: snap(now, 1, 1), now });
    expect(() => beginSlice(g(), l, { sliceId: "slice-c2", runId: null, taskId: "FEAT-001", agent: "o", model: "sonnet", snapshot: snap(now, 1, 1), now })).toThrow(/running/);
    expect(codes(decide({ now, snapshot: snap(now, 1, 1), ledger: l }))).toContain("CONCURRENCY");
  });

  it("closes a vanished slice as interrupted once its lease passes", () => {
    const now = onDay(3);
    const l = beginSlice(g(), emptyLedger(), { sliceId: "slice-d1", runId: null, taskId: "FEAT-001", agent: "o", model: "sonnet", snapshot: snap(now, 1, 1), now });
    const later = new Date(now.getTime() + 40 * 60_000);
    expect(expireSlices(l, later).slices[0]).toMatchObject({ outcome: "interrupted" });
    expect(expireSlices(l, now).slices[0].outcome).toBe("running");
  });

  it("a governor pause holds the claim, so waiting a week never spends a retry", () => {
    const t0 = onDay(3);
    const b = BacklogSchema.parse({ version: 1, canonical: "local-bootstrap", tasks: [{
      id: "FEAT-001", title: "Task title here", description: "A description long enough", source: "test", approval: "APPROVED_REQUIREMENT", priority: "P1",
      acceptanceCriteria: ["works well"], risk: "low", requiredAgents: ["medyra-feature-engineer"], fileScope: ["src/x/**"], requiredGates: ["lint"], dependencies: [],
      state: "IMPLEMENTING", run: "run-20261126T120000Z-abcd12", claim: { runId: "run-20261126T120000Z-abcd12", owner: "r", claimedAt: t0.toISOString(), expiresAt: new Date(t0.getTime() + HOUR).toISOString() },
    }] });
    const resumeAt = new Date(t0.getTime() + 4 * DAY);
    const held = holdClaimForPause(b, { taskId: "FEAT-001", runId: "run-20261126T120000Z-abcd12", until: resumeAt, control: control(), now: t0 });
    const r = recoverStale(held, control(), new Date(resumeAt.getTime() - HOUR));
    expect(r.recovered).toEqual([]);
    expect(r.backlog.tasks[0]).toMatchObject({ state: "IMPLEMENTING", retryCount: 0 });
    expect(() => holdClaimForPause(b, { taskId: "FEAT-001", runId: "run-20261126T120000Z-zzzz99", until: resumeAt, control: control(), now: t0 })).toThrow(/not held/);
  });
});

describe("status line capture", () => {
  it("records only the documented windows and keeps the worst reading per window", () => {
    const input = { version: "2.1.330", rate_limits: { five_hour: { used_percentage: 4, resets_at: 1795700000 }, seven_day: { used_percentage: 10, resets_at: 1796000000 } } };
    const a = capture(input, null, new Date("2026-11-26T00:00:00Z"))!;
    expect(a.fiveHour).toEqual({ usedPercent: 4, resetsAt: new Date(1795700000 * 1000).toISOString() });
    const older = { ...input, rate_limits: { ...input.rate_limits, five_hour: { used_percentage: 3, resets_at: 1795700000 } } };
    expect(capture(older, a)!.fiveHour!.usedPercent).toBe(4);
    expect(capture({ version: "x" }, a)).toBeNull(); // API-key session or before the first response
    expect(mergeWindow({ usedPercent: 50, resetsAt: "2026-11-26T00:00:00.000Z" }, { usedPercent: 1, resetsAt: "2026-11-26T05:00:00.000Z" })!.usedPercent).toBe(1);
  });
});

describe("CLI end to end (scratch state, fake Claude)", () => {
  function scratch() {
    const dir = mkdtempSync(path.join(tmpdir(), "medyra-gov-"));
    cpSync(path.join(repo, "engineering"), path.join(dir, "engineering"), { recursive: true, filter: (src) => !src.includes(".local") && !src.includes(`${path.sep}runs${path.sep}`) });
    mkdirSync(path.join(dir, "engineering", "runs"), { recursive: true });
    const cfg = JSON.parse(readFileSync(path.join(dir, "engineering/governor.json"), "utf8"));
    cfg.usageGovernor.billing.extraUsageDisabledConfirmedAt = "2026-11-20T00:00:00Z";
    writeFileSync(path.join(dir, "engineering/governor.json"), JSON.stringify(cfg));
    const ctl = JSON.parse(readFileSync(path.join(dir, "engineering/control.json"), "utf8"));
    ctl.autonomy.executionEnabled = true;
    writeFileSync(path.join(dir, "engineering/control.json"), JSON.stringify(ctl));
    // Make one approved task eligible: reset FEAT-001 to READY.
    const b = JSON.parse(readFileSync(path.join(dir, "engineering/backlog.json"), "utf8"));
    for (const t of b.tasks) if (t.id === "FEAT-001") Object.assign(t, { state: "READY", claim: null, run: null, retryCount: 0, reviewResults: [], commitSha: null });
    writeFileSync(path.join(dir, "engineering/backlog.json"), JSON.stringify(b));
    const fake = path.join(dir, "fake-claude.mjs");
    writeFileSync(fake, `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(path.join(dir, "calls.log"))}, JSON.stringify({ args: process.argv.slice(2), apiKey: !!process.env.ANTHROPIC_API_KEY, slice: process.env.MEDYRA_GOVERNED_SLICE }) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, session_id: "sess-1", result: "checkpointed" }));`);
    const snapFile = path.join(dir, "snapshot.json");
    const writeSnap = (s: Snapshot) => writeFileSync(snapFile, JSON.stringify(s));
    const cli = (args: string[], at: Date, extra: Record<string, string> = {}) =>
      spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(repo, "scripts/engineering/usage/cli.ts"), ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, MEDYRA_ENGINEERING_ROOT: dir, MEDYRA_NOW: at.toISOString(), MEDYRA_USAGE_SNAPSHOT: snapFile, MEDYRA_CLAUDE_BIN: fake, ANTHROPIC_API_KEY: "", MEDYRA_AUTONOMY_PAUSED: "", ...extra },
      });
    return { dir, cli, writeSnap };
  }

  it("runs one slice, then waits for fresh telemetry, then resumes the same run", () => {
    const { dir, cli, writeSnap } = scratch();
    const t1 = onDay(3);
    expect(cli(["run", "--execute"], t1).stdout).toMatch(/TELEMETRY/); // no snapshot yet: fail closed
    writeSnap(snap(t1, 1, 3));
    const first = cli(["run", "--execute"], t1);
    expect(first.stdout).toMatch(/"outcome": "completed"/);
    const call = JSON.parse(readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n")[0]);
    expect(call.apiKey).toBe(false);
    expect(call.slice).toMatch(/^slice-/);
    expect(call.args).toEqual(expect.arrayContaining(["--max-turns", "30", "--model", "sonnet", "--output-format", "json"]));
    // Immediately after: no reading since the slice ended, so the scheduler pauses.
    const t2 = new Date(t1.getTime() + 60_000);
    expect(cli(["tick"], t2).stdout).toMatch(/paused: TELEMETRY/);
    // A fresh reading settles the slice and allows the next one, which resumes the same session.
    const t3 = new Date(t1.getTime() + 10 * 60_000);
    writeSnap(snap(t3, 2.5, 3.5, { fiveHour: { usedPercent: 2.5, resetsAt: new Date(t1.getTime() + 2 * HOUR).toISOString() } }));
    const second = cli(["run", "--execute"], t3);
    expect(second.stdout).toMatch(/"outcome": "completed"/);
    const calls = readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(calls[1].args).toEqual(expect.arrayContaining(["--resume", "sess-1"]));
    const ledger = JSON.parse(readFileSync(path.join(dir, "engineering/.local/usage-ledger.json"), "utf8"));
    expect(ledger.slices[0].attributed).toMatchObject({ fiveHourPercent: 1.5, weeklyPercent: 0.5 });
    expect(ledger.slices).toHaveLength(2);
  });

  it("restarting the scheduler keeps state; an exhausted five-hour window pauses and holds the claim", () => {
    const { dir, cli, writeSnap } = scratch();
    const t1 = onDay(3);
    writeSnap(snap(t1, 1, 3));
    cli(["run", "--execute"], t1);
    const t2 = new Date(t1.getTime() + 10 * 60_000);
    writeSnap(snap(t2, 8.5, 4)); // the founder used a lot meanwhile
    expect(cli(["tick"], t2).stdout).toMatch(/paused: FIVE_HOUR/);
    expect(cli(["tick"], new Date(t2.getTime() + 60_000)).stdout).toMatch(/paused: FIVE_HOUR/); // a fresh process sees the same state
    const b = JSON.parse(readFileSync(path.join(dir, "engineering/backlog.json"), "utf8"));
    const t = b.tasks.find((x: { id: string }) => x.id === "FEAT-001");
    expect(Date.parse(t.claim.expiresAt)).toBeGreaterThan(t2.getTime() + 2 * HOUR); // held past the reset
    expect(t.retryCount).toBe(0);
    const ledger = JSON.parse(readFileSync(path.join(dir, "engineering/.local/usage-ledger.json"), "utf8"));
    expect(ledger.pauses).toHaveLength(1); // logged once, not on every tick
  });

  it("fails closed on a corrupted ledger, refuses bypass attempts, honours the owner pause", () => {
    const { dir, cli, writeSnap } = scratch();
    const t1 = onDay(3);
    writeSnap(snap(t1, 1, 3));
    expect(cli(["configure", "--set", "weekly.allocationPercent=40"], t1).stdout).toMatch(/refused/);
    expect(cli(["admit"], t1, { ANTHROPIC_API_KEY: "sk-test" }).stdout).toMatch(/refused: PAID_USAGE/);
    expect(cli(["admit"], t1).stdout).toMatch(/^admitted/); // and prints no usage figures
    cli(["pause", "--reason", "owner away"], t1);
    expect(cli(["admit"], t1).stdout).toMatch(/EMERGENCY_STOP/);
    cli(["resume"], t1);
    mkdirSync(path.join(dir, "engineering/.local"), { recursive: true });
    writeFileSync(path.join(dir, "engineering/.local/usage-ledger.json"), "{ not json");
    const r = cli(["run", "--execute"], t1);
    expect(r.stdout).toMatch(/fail closed/);
    expect(r.status).toBe(3);
  });

  it("the orchestrator's own cycle refuses real runs without governor admission", () => {
    const { dir, cli } = scratch();
    void cli;
    const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(repo, "scripts/engineering/orchestrator.ts"), "cycle", "--mode", "manual"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, MEDYRA_ENGINEERING_ROOT: dir, MEDYRA_USAGE_SNAPSHOT: path.join(dir, "none.json"), MEDYRA_AUTONOMY_PAUSED: "" },
    });
    expect(r.stdout).toMatch(/usage governor TELEMETRY/);
  });
});
