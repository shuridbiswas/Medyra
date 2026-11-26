// @vitest-environment node
//
// Failure-injection tests for the autonomous engineering system: duplicate claims, stale leases,
// pause, budget, approvals, illegal transitions, stale review evidence, migration conflicts,
// invalid handoffs, protected paths, and the PreToolUse guard hook.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  budgetStatus,
  claim,
  eligibility,
  forbiddenChanges,
  gateGaps,
  preflight,
  recordCommit,
  recordReview,
  recoverStale,
  reviewGaps,
  RuleError,
  transition,
} from "./lib/engine.ts";
import {
  ApprovalsSchema,
  BacklogSchema,
  ControlSchema,
  HandoffSchema,
  PolicySchema,
  type Approvals,
  type Backlog,
  type Control,
  type Run,
  type Task,
} from "./lib/model.ts";
import { loadState, withMutex } from "./lib/store.ts";
import { scanText } from "./secret-scan.ts";
import { check, hash } from "./migrations-check.ts";

const repo = path.resolve(import.meta.dirname, "../..");
const policy = PolicySchema.parse(JSON.parse(readFileSync(path.join(repo, "engineering/policy.json"), "utf8")));
const NOW = new Date("2026-11-26T12:00:00Z");
const SHA = "abc1234";
const SHA2 = "def5678";

const control = (over: Partial<Control["limits"]> = {}, autonomy: Partial<Control["autonomy"]> = {}): Control =>
  ControlSchema.parse({
    version: 1,
    paused: false,
    autonomy: { executionEnabled: true, scheduleEnabled: false, autoIntegrateToDev: false, hostedDevMigrations: false, ...autonomy },
    limits: { maxConcurrentImplementations: 1, maxRemediationAttempts: 2, maxTasksPerCycle: 1, maxCycleMinutes: 45, claimTtlMinutes: 90, perRunUsd: 5, perDayUsd: 10, perMonthUsd: 100, ...over },
    models: {},
  });

const task = (id: string, over: Partial<Task> = {}): Task =>
  BacklogSchema.parse({ version: 1, canonical: "local-bootstrap", tasks: [{
    id,
    title: `Task ${id} title`,
    description: "A description long enough",
    source: "test",
    approval: "APPROVED_REQUIREMENT",
    priority: "P1",
    acceptanceCriteria: ["works well"],
    risk: "low",
    requiredAgents: ["medyra-feature-engineer"],
    fileScope: ["src/features/home/**"],
    requiredGates: ["lint"],
    state: "READY",
    ...over,
    dependencies: [],
  }] }).tasks[0];

const backlog = (...tasks: Task[]): Backlog => ({ version: 1, canonical: "local-bootstrap", tasks });
const approve = (...entries: [string, Approvals["approvals"][number]["scope"]][]): Approvals =>
  ApprovalsSchema.parse({ version: 1, approvals: entries.map(([taskId, scope]) => ({ taskId, scope, approvedBy: "owner", at: NOW.toISOString(), reference: "test" })) });

const ctx = (b: Backlog, a: Approvals, c = control()) => ({ approvals: a, control: c, policy, now: NOW });

function runWithGates(taskId: string, sha: string, gates: Run["gates"]): Run {
  return { version: 1, runId: "run-20261126T120000Z-abcd12", taskId, mode: "manual", startedAt: NOW.toISOString(), baseSha: SHA, branch: "agent/x", checkpoints: [], handoffs: [], gates, nextAction: "x", endedAt: null };
}

const allMandatory = (sha: string): Run["gates"] =>
  Object.fromEntries(["lint", "typecheck", "unit", "pglite", "build", "secret-scan", "code-review"].map((g) => [g, { result: "PASSED", sha, detail: "ok" }]));

/** Walks a claimed task to REVIEWING at `sha`. */
function toReviewing(b: Backlog, id: string, runId: string, a: Approvals): Backlog {
  const base = { by: "medyra-feature-engineer", runId, now: NOW, approvals: a, control: control(), policy, run: null };
  for (const to of ["PLANNING", "IMPLEMENTING", "TESTING"] as const) b = transition(b, { ...base, taskId: id, to });
  b = recordCommit(b, id, SHA, "agent/x");
  return transition(b, { ...base, taskId: id, to: "REVIEWING" });
}

describe("claims and concurrency", () => {
  it("claims an approved READY task once; a duplicate claim is refused", () => {
    const a = approve(["FEAT-001", "execute"]);
    let b = backlog(task("FEAT-001"));
    b = claim(b, { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(b, a) });
    expect(b.tasks[0].state).toBe("CLAIMED");
    expect(() => claim(b, { taskId: "FEAT-001", runId: "r2", owner: "o", ...ctx(b, a) })).toThrow(/cannot be claimed/);
  });

  it("refuses unapproved tasks and PROPOSED → READY without an owner approval", () => {
    const b = backlog(task("FEAT-001"), task("FEAT-002", { state: "PROPOSED", approval: "PROPOSED_BY_AGENT" }));
    const none = approve();
    expect(eligibility(b, none, control(), policy).eligible).toHaveLength(0);
    expect(() => transition(b, { taskId: "FEAT-002", to: "READY", by: "x", runId: null, now: NOW, approvals: none, control: control(), policy, run: null })).toThrow(/needs an owner 'execute' approval/);
  });

  it("an agent-proposed task stays ineligible even with an execute record until reclassified", () => {
    const b = backlog(task("FEAT-003", { approval: "PROPOSED_BY_AGENT" }));
    const { ineligible } = eligibility(b, approve(["FEAT-003", "execute"]), control(), policy);
    expect(ineligible[0].reasons.join()).toMatch(/approval status is PROPOSED_BY_AGENT/);
  });

  it("enforces the concurrency limit", () => {
    const a = approve(["FEAT-001", "execute"], ["FEAT-002", "execute"]);
    let b = backlog(task("FEAT-001"), task("FEAT-002"));
    b = claim(b, { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(b, a) });
    expect(eligibility(b, a, control(), policy).ineligible[0].reasons.join()).toMatch(/concurrency limit/);
  });

  it("never runs two tasks touching migrations at once, even with spare capacity", () => {
    const a = approve(["DB-001", "execute"], ["DB-002", "execute"]);
    let b = backlog(task("DB-001", { fileScope: ["supabase/migrations/**"] }), task("DB-002", { fileScope: ["supabase/migrations/2026*.sql"] }));
    const c = control({ maxConcurrentImplementations: 2 });
    b = claim(b, { taskId: "DB-001", runId: "r1", owner: "o", ...ctx(b, a, c) });
    const { eligible, ineligible } = eligibility(b, a, c, policy);
    expect(eligible).toHaveLength(0);
    expect(ineligible[0].reasons.join()).toMatch(/conflicts with active DB-001 on supabase\/migrations/);
  });

  it("selects by priority then id, and waits for dependencies", () => {
    const a = approve(["DOC-001", "execute"], ["SEC-001", "execute"], ["QA-001", "execute"]);
    const b = backlog(task("DOC-001", { priority: "P2" }), task("SEC-001", { priority: "P0" }), task("QA-001", { priority: "P0" }));
    expect(eligibility(b, a, control(), policy).eligible.map((t) => t.id)).toEqual(["QA-001", "SEC-001", "DOC-001"]);
    const withDep = BacklogSchema.parse({ ...b, tasks: [...b.tasks.slice(0, 2), { ...b.tasks[2], dependencies: ["DOC-001"] }] });
    expect(eligibility(withDep, a, control(), policy).ineligible.find((i) => i.id === "QA-001")?.reasons.join()).toMatch(/dependency DOC-001/);
  });
});

describe("interruption and recovery", () => {
  it("releases an expired lease to READY, counts a retry, and is idempotent", () => {
    const a = approve(["FEAT-001", "execute"]);
    let b = backlog(task("FEAT-001"));
    b = claim(b, { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(b, a) });
    const later = new Date(NOW.getTime() + 91 * 60_000);
    const first = recoverStale(b, control(), later);
    expect(first.recovered).toEqual(["FEAT-001"]);
    expect(first.backlog.tasks[0]).toMatchObject({ state: "READY", retryCount: 1, claim: null });
    expect(recoverStale(first.backlog, control(), later).recovered).toEqual([]);
    expect(recoverStale(b, control(), NOW).recovered).toEqual([]); // lease still valid
  });

  it("fails a task whose leases keep expiring beyond the retry limit", () => {
    const a = approve(["FEAT-001", "execute"]);
    let b = backlog(task("FEAT-001", { retryCount: 2 }));
    b = claim(b, { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(b, a) });
    expect(recoverStale(b, control(), new Date(NOW.getTime() + 100 * 60_000)).backlog.tasks[0].state).toBe("FAILED");
    const failed = backlog(task("FEAT-001", { state: "FAILED", retryCount: 2 }));
    expect(() => transition(failed, { taskId: "FEAT-001", to: "READY", by: "x", runId: null, now: NOW, approvals: a, control: control(), policy, run: null })).toThrow(/used 2 of 2/);
  });

  it("only the run that holds the claim can move the task", () => {
    const a = approve(["FEAT-001", "execute"]);
    let b = backlog(task("FEAT-001"));
    b = claim(b, { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(b, a) });
    expect(() => transition(b, { taskId: "FEAT-001", to: "PLANNING", by: "x", runId: "intruder", now: NOW, approvals: a, control: control(), policy, run: null })).toThrow(/claimed by r1/);
  });

  it("serializes state writes across concurrent callers and breaks a stale mutex", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "medyra-eng-"));
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => withMutex(dir, async () => {
      order.push(n);
      await new Promise((r) => setTimeout(r, 20));
      order.push(-n);
    })));
    for (let i = 0; i < order.length; i += 2) expect(order[i + 1]).toBe(-order[i]); // no interleaving
    writeFileSync(path.join(dir, "engineering", ".mutex"), "{}");
    await expect(withMutex(dir, () => "ok", 0)).resolves.toBe("ok"); // stale lock broken
    expect(existsSync(path.join(dir, "engineering", ".mutex"))).toBe(false);
  });
});

describe("pause and budget", () => {
  const usage = (usd: number) => ({ version: 1 as const, entries: [{ runId: "r", at: NOW.toISOString(), usd, kind: "estimated" as const, source: "t" }] });

  it("stops on pause from the control file or the repository variable", () => {
    expect(preflight({ control: { ...control(), paused: true }, usage: usage(0), env: {}, now: NOW, mode: "dry-run" }).ok).toBe(false);
    expect(preflight({ control: control(), usage: usage(0), env: { MEDYRA_AUTONOMY_PAUSED: "true" }, now: NOW, mode: "dry-run" }).reasons).toContain("paused by MEDYRA_AUTONOMY_PAUSED");
  });

  it("refuses real runs when execution is disabled or the budget cannot cover one more run", () => {
    expect(preflight({ control: control({}, { executionEnabled: false }), usage: usage(0), env: {}, now: NOW, mode: "manual" }).reasons.join()).toMatch(/not enabled/);
    const spent = preflight({ control: control(), usage: usage(6), env: {}, now: NOW, mode: "manual" });
    expect(spent.reasons.join()).toMatch(/budget exhausted: 4.00 USD left/);
    expect(preflight({ control: control(), usage: usage(4), env: {}, now: NOW, mode: "manual" }).ok).toBe(true);
    expect(preflight({ control: control(), usage: usage(4), env: {}, now: NOW, mode: "scheduled" }).reasons.join()).toMatch(/scheduled execution is not enabled/);
  });

  it("counts the month as well as the day", () => {
    const old = { version: 1 as const, entries: [{ runId: "r", at: "2026-11-02T00:00:00Z", usd: 97, kind: "billed" as const, source: "t" }] };
    expect(budgetStatus(old, control(), NOW)).toMatchObject({ today: 0, thisMonth: 97, canStartRun: false });
  });
});

describe("evidence, reviews and approvals", () => {
  const a = approve(["FEAT-001", "execute"]);
  const claimed = () => claim(backlog(task("FEAT-001")), { taskId: "FEAT-001", runId: "r1", owner: "o", ...ctx(backlog(), a) });

  it("rejects illegal transitions", () => {
    expect(() => transition(backlog(task("FEAT-001")), { taskId: "FEAT-001", to: "DONE", by: "x", runId: null, now: NOW, approvals: a, control: control(), policy, run: null })).toThrow(RuleError);
  });

  it("needs a PASS from code review and QA on the exact commit; a new commit makes reviews stale", () => {
    let b = toReviewing(claimed(), "FEAT-001", "r1", a);
    const go = (bb: Backlog, run: Run | null = runWithGates("FEAT-001", SHA, allMandatory(SHA))) =>
      transition(bb, { taskId: "FEAT-001", to: "READY_TO_MERGE", by: "medyra-orchestrator", runId: "r1", now: NOW, approvals: a, control: control(), policy, run });
    expect(() => go(b)).toThrow(/no review of abc1234/);
    expect(() => recordReview(b, { taskId: "FEAT-001", role: "medyra-feature-engineer", verdict: "PASS", sha: SHA, summary: "self", now: NOW })).toThrow(/cannot record reviews/);
    b = recordReview(b, { taskId: "FEAT-001", role: "medyra-code-reviewer", verdict: "PASS", sha: SHA, summary: "ok", now: NOW });
    b = recordReview(b, { taskId: "FEAT-001", role: "medyra-qa-engineer", verdict: "BLOCK", sha: SHA, summary: "bug", now: NOW });
    expect(() => go(b)).toThrow(/BLOCK on abc1234/);
    b = recordReview(b, { taskId: "FEAT-001", role: "medyra-qa-engineer", verdict: "PASS", sha: SHA, summary: "fixed", now: NOW });
    expect(reviewGaps(b.tasks[0], policy)).toEqual([]);
    const moved = recordCommit(b, "FEAT-001", SHA2, "agent/x");
    expect(reviewGaps(moved.tasks[0], policy)).toHaveLength(2);
    expect(() => recordReview(moved, { taskId: "FEAT-001", role: "medyra-code-reviewer", verdict: "PASS", sha: SHA, summary: "old", now: NOW })).toThrow(/review is for abc1234/);
    expect(go(b).tasks[0].state).toBe("READY_TO_MERGE");
  });

  it("treats missing, failed, stale or N/A mandatory gates as blockers", () => {
    const t = { ...task("FEAT-001"), commitSha: SHA };
    expect(gateGaps(t, null, policy)).toEqual(["no run record"]);
    const partial = runWithGates("FEAT-001", SHA, { ...allMandatory(SHA), build: { result: "NOT_EXECUTED", sha: SHA, detail: "skipped" } });
    expect(gateGaps(t, partial, policy)).toEqual(["build: NOT_EXECUTED"]);
    const stale = runWithGates("FEAT-001", SHA, { ...allMandatory(SHA), lint: { result: "PASSED", sha: SHA2, detail: "old" } });
    expect(gateGaps(t, stale, policy)).toEqual([`lint: evidence is for ${SHA2}, not ${SHA}`]);
    const na = runWithGates("FEAT-001", SHA, { ...allMandatory(SHA), unit: { result: "NOT_APPLICABLE", sha: SHA, detail: "?" } });
    expect(gateGaps(t, na, policy)).toEqual(["unit: mandatory gate cannot be N/A"]);
    expect(gateGaps(t, runWithGates("FEAT-001", SHA, allMandatory(SHA)), policy)).toEqual([]);
  });

  it("security-sensitive work needs the security reviewer and an owner approval; integration needs approval", () => {
    const sens = approve(["SEC-003", "execute"]);
    let b = claim(backlog(task("SEC-003", { fileScope: ["src/lib/auth/**"] })), { taskId: "SEC-003", runId: "r1", owner: "o", ...ctx(backlog(), sens) });
    b = toReviewing(b, "SEC-003", "r1", sens);
    for (const role of ["medyra-code-reviewer", "medyra-qa-engineer"] as const) b = recordReview(b, { taskId: "SEC-003", role, verdict: "PASS", sha: SHA, summary: "ok", now: NOW });
    const run = runWithGates("SEC-003", SHA, allMandatory(SHA));
    const go = (bb: Backlog, ap: Approvals) => transition(bb, { taskId: "SEC-003", to: "READY_TO_MERGE", by: "o", runId: "r1", now: NOW, approvals: ap, control: control(), policy, run });
    expect(() => go(b, sens)).toThrow(/medyra-security-reviewer: no review/);
    b = recordReview(b, { taskId: "SEC-003", role: "medyra-security-reviewer", verdict: "PASS", sha: SHA, summary: "ok", now: NOW });
    expect(() => go(b, sens)).toThrow(/needs an owner 'security-change' approval/);
    const withSec = approve(["SEC-003", "execute"], ["SEC-003", "security-change"]);
    b = go(b, withSec);
    expect(() => transition(b, { taskId: "SEC-003", to: "INTEGRATED", by: "o", runId: "r1", now: NOW, approvals: withSec, control: control(), policy, run })).toThrow(/needs an owner 'integrate' approval/);
    const done = transition(b, { taskId: "SEC-003", to: "INTEGRATED", by: "o", runId: "r1", now: NOW, approvals: approve(["SEC-003", "integrate"]), control: control(), policy, run });
    expect(() => transition(done, { taskId: "SEC-003", to: "DONE", by: "o", runId: null, now: NOW, approvals: withSec, control: control(), policy, run })).toThrow(/no completion evidence/);
  });

  it("validates agent handoffs strictly", () => {
    const good = {
      runId: "run-1", taskId: "FEAT-001", role: "medyra-qa-engineer", inputSha: SHA, outputSha: null, filesModified: [], decisions: [], testsExecuted: ["npm test"],
      testEvidence: [{ gate: "unit", result: "PASSED", detail: "1145 passed" }], reviewFindings: [], unresolved: [], nextAction: "code review", status: "COMPLETE", verdict: "PASS",
    };
    expect(HandoffSchema.safeParse(good).success).toBe(true);
    expect(HandoffSchema.safeParse({ ...good, role: "medyra-intern" }).success).toBe(false);
    expect(HandoffSchema.safeParse({ ...good, testEvidence: [{ gate: "unit", result: "probably fine", detail: "" }] }).success).toBe(false);
    expect(HandoffSchema.safeParse({ ...good, inputSha: "HEAD" }).success).toBe(false);
  });

  it("flags owner-only, secret and out-of-scope files in a change", () => {
    const t = task("FEAT-001");
    expect(forbiddenChanges(["src/features/home/content.ts"], policy, t)).toEqual([]);
    expect(forbiddenChanges(["engineering/control.json", ".env.local", "src/proxy.ts"], policy, t)).toEqual([
      "engineering/control.json: owner-only path",
      "engineering/control.json: outside FEAT-001 file scope",
      ".env.local: secret path",
      ".env.local: outside FEAT-001 file scope",
      "src/proxy.ts: outside FEAT-001 file scope",
    ]);
  });
});

describe("repository state", () => {
  it("the committed engineering files are valid and the policy keeps the system conservative", () => {
    const s = loadState(repo);
    expect(s.control.autonomy).toEqual({ executionEnabled: false, scheduleEnabled: false, autoIntegrateToDev: false, hostedDevMigrations: false });
    expect(s.control.limits.maxConcurrentImplementations).toBe(1);
    for (const p of [".env.local", "scripts/.seed-output/**"]) expect(s.policy.secretPaths).toContain(p);
    for (const c of ["db:reset:dev", "seed:wipe", "seed:clean", "db:migrate", "push --force"]) expect(s.policy.forbiddenCommands).toContain(c);
    for (const t of s.backlog.tasks.filter((x) => x.approval !== "APPROVED_REQUIREMENT")) expect(["PROPOSED", "BLOCKED", "DONE", "CANCELLED"]).toContain(t.state);
  });
});

describe("secret scan and migration gate", () => {
  it("finds credentials without printing them, and ignores placeholders", () => {
    const fake = ["sbp", "_", "0123456789abcdef0123456789abcdef"].join("");
    expect(scanText("x.ts", `const t = "${fake}";`)).toEqual(["x.ts:1 supabase-personal-access-token"]);
    expect(scanText(".env.example", "SUPABASE_ACCESS_TOKEN=\nRESEND_API_KEY=")).toEqual([]);
  });

  it("rejects edited, deleted, misordered, destructive or unguarded migrations", () => {
    const lock = { version: 1 as const, files: { "20261101000001_a.sql": hash("select 1;") } };
    expect(check({ "20261101000001_a.sql": "select 1;" }, lock).errors).toEqual([]);
    expect(check({ "20261101000001_a.sql": "select 2;" }, lock).errors.join()).toMatch(/was modified/);
    expect(check({}, lock).errors.join()).toMatch(/deleted or renamed/);
    expect(check({ "20261101000001_a.sql": "select 1;", "20261001000001_b.sql": "select 1;" }, lock).errors.join()).toMatch(/sorts before/);
    expect(check({ "20261101000001_a.sql": "select 1;", "20261201000001_c.sql": "drop table public.posts;" }, lock).errors.join()).toMatch(/destructive/);
    expect(check({ "20261101000001_a.sql": "select 1;", "20261201000001_c.sql": "-- medyra:destructive-approved DB-009\ndrop table public.x;" }, lock).errors).toEqual([]);
    expect(check({ "20261101000001_a.sql": "select 1;", "20261201000001_d.sql": "create function private.f() returns int language sql as $$select 1$$;" }, lock).errors.join()).toMatch(/revoke execute/);
    expect(check({ "20261101000001_a.sql": "select 1;", "20261201000001_e.sql": "create function public.f() returns int language sql security definer as $$select 1$$;" }, lock).errors.join()).toMatch(/security definer/);
    expect(check({ "20261101000001_a.sql": "select 1;", "bad.sql": "" }, lock).errors.join()).toMatch(/name must be/);
  });

  it("the repository's migrations match their lock", () => {
    const lock = JSON.parse(readFileSync(path.join(repo, "engineering/migrations.lock.json"), "utf8"));
    const dir = path.join(repo, "supabase/migrations");
    const files = Object.fromEntries(Object.keys(lock.files).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
    expect(check(files, lock).errors).toEqual([]);
  });
});

describe("PreToolUse guard hook", () => {
  const hook = path.join(repo, ".claude/hooks/pre-tool-guard.mjs");
  const run = (input: object, owner = false) => {
    const r = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo, MEDYRA_OWNER_MODE: owner ? "1" : "" },
    });
    return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision as string) : "allow";
  };
  const file = (tool: string, p: string) => ({ tool_name: tool, tool_input: { file_path: path.join(repo, p) } });
  const bash = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

  it("blocks secrets for everyone, including the owner", () => {
    expect(run(file("Read", ".env.local"))).toBe("deny");
    expect(run(file("Read", ".env.local"), true)).toBe("deny");
    expect(run(file("Read", "scripts/.seed-output/accounts.json"))).toBe("deny");
    expect(run(bash("cat .env.local"), true)).toBe("deny");
    expect(run(bash("echo $SUPABASE_ACCESS_TOKEN"))).toBe("deny");
    expect(run(bash("printenv"))).toBe("deny");
    expect(run({ tool_name: "Grep", tool_input: { pattern: "KEY", path: ".env.local" } })).toBe("deny");
    expect(run(file("Read", ".env.example"))).toBe("allow");
  });

  it("blocks owner-only edits and dangerous commands for agents but not the owner", () => {
    expect(run(file("Edit", "engineering/approvals.json"))).toBe("deny");
    expect(run(file("Write", ".claude/settings.json"))).toBe("deny");
    expect(run(file("Read", "engineering/approvals.json"))).toBe("allow");
    expect(run(file("Edit", "engineering/approvals.json"), true)).toBe("allow");
    for (const c of ["npm run db:reset:dev", "npm run seed:wipe", "git push --force origin dev", "git push origin --delete main", "npm install left-pad", "npx netlify deploy --prod"]) {
      expect(run(bash(c))).toBe("deny");
    }
    expect(run({ tool_name: "PowerShell", tool_input: { command: "npm run db:migrate" } })).toBe("deny");
    expect(run(bash("npm run db:migrate"), true)).toBe("allow");
    expect(run(bash("npm test && npm run lint"))).toBe("allow");
    expect(run(file("Edit", "src/features/home/content.ts"))).toBe("allow");
  });

  it("fails closed on unreadable input", () => {
    const r = spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo } });
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
