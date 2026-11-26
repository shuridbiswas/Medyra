/**
 * Deterministic rules of the engineering system: pause, budget, eligibility, claims, state
 * transitions, review and gate evidence, stale-claim recovery. Pure functions: they take state and
 * return new state or a refusal. Language models never decide any of this.
 */
import {
  ACTIVE_STATES,
  GATES,
  TRANSITIONS,
  type Approvals,
  type Backlog,
  type Control,
  type Gate,
  type Policy,
  type Role,
  type Run,
  type State,
  type Task,
  type Usage,
} from "./model.ts";

export class RuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const REVIEW_ROLES: readonly Role[] = ["medyra-code-reviewer", "medyra-qa-engineer", "medyra-security-reviewer"];

// ---------------------------------------------------------------------------
// Pause and budget
// ---------------------------------------------------------------------------

/** Paused if the owner-only control file says so, or the repository variable is set in CI. */
export function pauseReason(control: Control, env: Record<string, string | undefined>): string | null {
  if (control.paused) return `paused in engineering/control.json${control.pauseReason ? `: ${control.pauseReason}` : ""}`;
  if ((env.MEDYRA_AUTONOMY_PAUSED ?? "").toLowerCase() === "true") return "paused by MEDYRA_AUTONOMY_PAUSED";
  return null;
}

export function budgetStatus(usage: Usage, control: Control, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  let today = 0;
  let thisMonth = 0;
  for (const e of usage.entries) {
    if (e.at.slice(0, 10) === day) today += e.usd;
    if (e.at.slice(0, 7) === month) thisMonth += e.usd;
  }
  const { perRunUsd, perDayUsd, perMonthUsd } = control.limits;
  const remaining = Math.min(perDayUsd - today, perMonthUsd - thisMonth);
  return { today, thisMonth, remaining, perRunUsd, canStartRun: remaining >= perRunUsd };
}

export type Preflight = { ok: boolean; reasons: string[] };

/** Step 1-3 of every cycle. Dry runs only need the system to be unpaused; real runs need more. */
export function preflight(input: {
  control: Control;
  usage: Usage;
  env: Record<string, string | undefined>;
  now: Date;
  mode: "dry-run" | "manual" | "scheduled";
}): Preflight {
  const reasons: string[] = [];
  const paused = pauseReason(input.control, input.env);
  if (paused) reasons.push(paused);
  if (input.mode !== "dry-run") {
    if (!input.control.autonomy.executionEnabled) reasons.push("autonomous execution is not enabled (control.autonomy.executionEnabled)");
    if (input.mode === "scheduled" && !input.control.autonomy.scheduleEnabled) reasons.push("scheduled execution is not enabled");
    const budget = budgetStatus(input.usage, input.control, input.now);
    if (!budget.canStartRun) {
      reasons.push(`budget exhausted: ${budget.remaining.toFixed(2)} USD left, a run may cost up to ${budget.perRunUsd} USD`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Approval and eligibility
// ---------------------------------------------------------------------------

export function isApproved(approvals: Approvals, taskId: string, scope: Approvals["approvals"][number]["scope"]): boolean {
  return approvals.approvals.some((a) => a.taskId === taskId && a.scope === scope);
}

/** Literal part of a glob before the first wildcard. */
const globPrefix = (glob: string) => glob.split("*")[0];

/** True when two path globs can describe the same file (prefix overlap; conservative). */
export function scopesOverlap(a: string, b: string): boolean {
  const pa = globPrefix(a);
  const pb = globPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped.replace(/\u0000/g, ".*")}$`);
}

export const matchesAny = (file: string, globs: readonly string[]) => globs.some((g) => globToRegExp(g).test(file.replace(/\\/g, "/")));

/** Serialized areas (migrations, shared types, CI...) a task's declared scope touches. */
export function serializedAreas(task: Task, policy: Policy): string[] {
  return policy.serializedPaths.filter((s) => task.fileScope.some((f) => scopesOverlap(f, s)));
}

export function isSecuritySensitive(task: Task, policy: Policy): boolean {
  return task.securitySensitive || task.fileScope.some((f) => policy.securitySensitivePaths.some((s) => scopesOverlap(f, s)));
}

export type Ineligible = { id: string; reasons: string[] };

export function eligibility(backlog: Backlog, approvals: Approvals, control: Control, policy: Policy) {
  const byId = new Map(backlog.tasks.map((t) => [t.id, t]));
  const active = backlog.tasks.filter((t) => ACTIVE_STATES.includes(t.state));
  const atCapacity = active.length >= control.limits.maxConcurrentImplementations;
  const eligible: Task[] = [];
  const ineligible: Ineligible[] = [];
  for (const t of backlog.tasks) {
    if (t.state !== "READY") continue;
    const reasons: string[] = [];
    if (!isApproved(approvals, t.id, "execute")) reasons.push("no owner approval to execute (engineering/approvals.json)");
    if (t.approval !== "APPROVED_REQUIREMENT") reasons.push(`approval status is ${t.approval}`);
    for (const d of t.dependencies) {
      if (byId.get(d)?.state !== "DONE") reasons.push(`dependency ${d} is not DONE`);
    }
    if (t.blockers.length > 0) reasons.push(`blocked: ${t.blockers.join("; ")}`);
    if (t.claim) reasons.push("already claimed");
    if (atCapacity) reasons.push(`concurrency limit reached (${control.limits.maxConcurrentImplementations})`);
    const mine = serializedAreas(t, policy);
    for (const other of active) {
      const shared = serializedAreas(other, policy).filter((a) => mine.includes(a));
      if (shared.length > 0) reasons.push(`conflicts with active ${other.id} on ${shared.join(", ")}`);
    }
    if (reasons.length === 0) eligible.push(t);
    else ineligible.push({ id: t.id, reasons });
  }
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
  eligible.sort((a, b) => rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id));
  return { eligible, ineligible };
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const update = (backlog: Backlog, id: string, fn: (t: Task) => Task): Backlog => {
  const found = backlog.tasks.some((t) => t.id === id);
  if (!found) throw new RuleError("UNKNOWN_TASK", `unknown task ${id}`);
  return { ...backlog, tasks: backlog.tasks.map((t) => (t.id === id ? fn(t) : t)) };
};

export function claim(
  backlog: Backlog,
  ctx: { taskId: string; runId: string; owner: string; now: Date; approvals: Approvals; control: Control; policy: Policy },
): Backlog {
  const { eligible, ineligible } = eligibility(backlog, ctx.approvals, ctx.control, ctx.policy);
  if (!eligible.some((t) => t.id === ctx.taskId)) {
    const why = ineligible.find((i) => i.id === ctx.taskId)?.reasons.join("; ") ?? "task is not READY";
    throw new RuleError("NOT_ELIGIBLE", `${ctx.taskId} cannot be claimed: ${why}`);
  }
  const expiresAt = new Date(ctx.now.getTime() + ctx.control.limits.claimTtlMinutes * 60_000).toISOString();
  return update(backlog, ctx.taskId, (t) => ({
    ...t,
    state: "CLAIMED",
    run: ctx.runId,
    claim: { runId: ctx.runId, owner: ctx.owner, claimedAt: ctx.now.toISOString(), expiresAt },
    history: [...t.history, { from: t.state, to: "CLAIMED", at: ctx.now.toISOString(), by: ctx.owner, note: ctx.runId }],
  }));
}

/** Releases claims whose lease expired (crashed or cancelled runner). Idempotent. */
export function recoverStale(backlog: Backlog, control: Control, now: Date): { backlog: Backlog; recovered: string[] } {
  const recovered: string[] = [];
  const tasks = backlog.tasks.map((t): Task => {
    if (!t.claim || !ACTIVE_STATES.includes(t.state) || new Date(t.claim.expiresAt) > now) return t;
    recovered.push(t.id);
    const retries = t.retryCount + 1;
    const to: State = retries > control.limits.maxRemediationAttempts ? "FAILED" : "READY";
    return {
      ...t,
      state: to,
      claim: null,
      retryCount: retries,
      history: [...t.history, { from: t.state, to, at: now.toISOString(), by: "recovery", note: `lease of ${t.claim.runId} expired` }],
    };
  });
  return { backlog: { ...backlog, tasks }, recovered };
}

/**
 * A usage-governor pause is not a failure: the run keeps its claim until it may resume, so waiting
 * for an allowance reset never spends a retry. Only the run that holds the claim may extend it.
 */
export function holdClaimForPause(backlog: Backlog, ctx: { taskId: string; runId: string; until: Date; control: Control; now: Date }): Backlog {
  const task = backlog.tasks.find((t) => t.id === ctx.taskId);
  if (!task?.claim || task.claim.runId !== ctx.runId || !ACTIVE_STATES.includes(task.state)) {
    throw new RuleError("NOT_CLAIM_OWNER", `${ctx.taskId} is not held by ${ctx.runId}`);
  }
  const expiresAt = new Date(Math.max(ctx.until.getTime(), ctx.now.getTime()) + ctx.control.limits.claimTtlMinutes * 60_000).toISOString();
  return update(backlog, ctx.taskId, (t) => ({ ...t, claim: { ...t.claim!, expiresAt } }));
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Reviewers a task needs for its current commit: code + QA always, security when sensitive. */
export function requiredReviewers(task: Task, policy: Policy): Role[] {
  const roles: Role[] = ["medyra-code-reviewer", "medyra-qa-engineer"];
  if (isSecuritySensitive(task, policy)) roles.push("medyra-security-reviewer");
  return roles;
}

/** Missing or failed reviews for the exact commit. Reviews of an older commit do not count. */
export function reviewGaps(task: Task, policy: Policy): string[] {
  if (!task.commitSha) return ["no commit recorded for review"];
  const gaps: string[] = [];
  for (const role of requiredReviewers(task, policy)) {
    const latest = [...task.reviewResults].reverse().find((r) => r.role === role && r.sha === task.commitSha);
    if (!latest) gaps.push(`${role}: no review of ${task.commitSha}`);
    else if (latest.verdict !== "PASS") gaps.push(`${role}: BLOCK on ${task.commitSha}`);
  }
  return gaps;
}

/** Mandatory checks without a PASSED (or justified NOT_APPLICABLE) result for the exact commit. */
export function gateGaps(task: Task, run: Run | null, policy: Policy): string[] {
  if (!task.commitSha) return ["no commit recorded"];
  if (!run) return ["no run record"];
  const required = new Set<Gate>([...policy.mandatoryGates, ...task.requiredGates]);
  const gaps: string[] = [];
  for (const gate of GATES) {
    if (!required.has(gate)) continue;
    const r = run.gates[gate];
    if (!r) gaps.push(`${gate}: not executed`);
    else if (r.sha !== task.commitSha) gaps.push(`${gate}: evidence is for ${r.sha}, not ${task.commitSha}`);
    else if (r.result === "NOT_APPLICABLE" && policy.mandatoryGates.includes(gate)) gaps.push(`${gate}: mandatory gate cannot be N/A`);
    else if (r.result !== "PASSED" && r.result !== "NOT_APPLICABLE") gaps.push(`${gate}: ${r.result}`);
  }
  return gaps;
}

/** Records a review. Reviewers must be review roles; a new commit makes earlier reviews stale. */
export function recordReview(
  backlog: Backlog,
  ctx: { taskId: string; role: Role; verdict: "PASS" | "BLOCK"; sha: string; summary: string; now: Date },
): Backlog {
  if (!REVIEW_ROLES.includes(ctx.role)) throw new RuleError("NOT_A_REVIEWER", `${ctx.role} cannot record reviews`);
  return update(backlog, ctx.taskId, (t) => {
    if (t.commitSha !== ctx.sha) throw new RuleError("STALE_REVIEW", `review is for ${ctx.sha} but the task is at ${t.commitSha ?? "no commit"}`);
    return { ...t, reviewResults: [...t.reviewResults, { role: ctx.role, verdict: ctx.verdict, sha: ctx.sha, at: ctx.now.toISOString(), summary: ctx.summary }] };
  });
}

/** A new commit on the branch: earlier review and gate evidence no longer applies to it. */
export function recordCommit(backlog: Backlog, taskId: string, sha: string, branch: string): Backlog {
  return update(backlog, taskId, (t) => ({ ...t, commitSha: sha, branch }));
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export function transition(
  backlog: Backlog,
  ctx: {
    taskId: string;
    to: State;
    by: string;
    runId: string | null;
    now: Date;
    note?: string;
    approvals: Approvals;
    control: Control;
    policy: Policy;
    run: Run | null;
    blocker?: string;
  },
): Backlog {
  return update(backlog, ctx.taskId, (t) => {
    if (!TRANSITIONS[t.state].includes(ctx.to)) {
      throw new RuleError("ILLEGAL_TRANSITION", `${t.id}: ${t.state} → ${ctx.to} is not allowed`);
    }
    if (ACTIVE_STATES.includes(t.state) && t.claim && t.claim.runId !== ctx.runId) {
      throw new RuleError("NOT_CLAIM_OWNER", `${t.id} is claimed by ${t.claim.runId}`);
    }
    if (t.state === "PROPOSED" && ctx.to === "READY" && !isApproved(ctx.approvals, t.id, "execute")) {
      throw new RuleError("NEEDS_APPROVAL", `${t.id} needs an owner 'execute' approval to become READY`);
    }
    if (t.state === "FAILED" && ctx.to === "READY" && t.retryCount >= ctx.control.limits.maxRemediationAttempts) {
      throw new RuleError("RETRIES_EXHAUSTED", `${t.id} used ${t.retryCount} of ${ctx.control.limits.maxRemediationAttempts} attempts`);
    }
    if (ctx.to === "AWAITING_APPROVAL" || ctx.to === "READY_TO_MERGE") {
      const gaps = reviewGaps(t, ctx.policy);
      if (gaps.length > 0) throw new RuleError("REVIEWS_MISSING", `${t.id}: ${gaps.join("; ")}`);
    }
    if (ctx.to === "READY_TO_MERGE" && isSecuritySensitive(t, ctx.policy) && !isApproved(ctx.approvals, t.id, "security-change")) {
      throw new RuleError("NEEDS_APPROVAL", `${t.id} is security-sensitive and needs an owner 'security-change' approval`);
    }
    if (ctx.to === "INTEGRATED" && !ctx.control.autonomy.autoIntegrateToDev && !isApproved(ctx.approvals, t.id, "integrate")) {
      throw new RuleError("NEEDS_APPROVAL", `${t.id} needs an owner 'integrate' approval (auto-integration is off)`);
    }
    if (ctx.to === "DONE" || ctx.to === "READY_TO_MERGE") {
      const gaps = gateGaps(t, ctx.run, ctx.policy);
      if (gaps.length > 0) throw new RuleError("GATES_MISSING", `${t.id}: ${gaps.join("; ")}`);
    }
    if (ctx.to === "DONE" && !t.completionEvidence) throw new RuleError("NO_EVIDENCE", `${t.id} has no completion evidence`);
    if (ctx.to === "BLOCKED" && !ctx.blocker) throw new RuleError("NO_BLOCKER", "a BLOCKED transition needs a blocker description");

    const stillActive = ACTIVE_STATES.includes(ctx.to) || ctx.to === "AWAITING_APPROVAL" || ctx.to === "READY_TO_MERGE";
    return {
      ...t,
      state: ctx.to,
      retryCount: t.state === "FAILED" && ctx.to === "READY" ? t.retryCount + 1 : t.retryCount,
      blockers: ctx.to === "BLOCKED" ? [...t.blockers, ctx.blocker as string] : ctx.to === "READY" ? [] : t.blockers,
      claim: stillActive ? t.claim : null,
      history: [...t.history, { from: t.state, to: ctx.to, at: ctx.now.toISOString(), by: ctx.by, note: ctx.note }],
    };
  });
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function newRunId(now: Date, random: () => number = Math.random): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const suffix = Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0");
  return `run-${stamp}-${suffix}`;
}

/** Protected-path check used by the hook and by the PR gate: which files may this change touch? */
export function forbiddenChanges(files: readonly string[], policy: Policy, task: Task | null): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (matchesAny(f, policy.ownerOnlyPaths)) problems.push(`${f}: owner-only path`);
    if (matchesAny(f, policy.secretPaths)) problems.push(`${f}: secret path`);
    if (task && !matchesAny(f, task.fileScope)) problems.push(`${f}: outside ${task.id} file scope`);
  }
  return problems;
}
