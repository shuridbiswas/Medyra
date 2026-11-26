/**
 * Data model of Medyra's autonomous engineering system. Every file under `engineering/` is
 * validated against these schemas before it is used, so a malformed or hand-edited record fails
 * loudly instead of steering an agent.
 */
import { z } from "zod";

export const TASK_PREFIXES = ["ENG", "SEC", "DB", "QA", "OPS", "FEAT", "DOC"] as const;
export const TASK_ID = /^(ENG|SEC|DB|QA|OPS|FEAT|DOC)-\d{3}$/;

export const STATES = [
  "PROPOSED",
  "READY",
  "CLAIMED",
  "PLANNING",
  "IMPLEMENTING",
  "TESTING",
  "REVIEWING",
  "CHANGES_REQUESTED",
  "AWAITING_APPROVAL",
  "READY_TO_MERGE",
  "INTEGRATED",
  "PREVIEW_VALIDATED",
  "DONE",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
] as const;
export type State = (typeof STATES)[number];

/** The only legal moves. Guards in engine.ts add evidence and approval requirements on top. */
export const TRANSITIONS: Record<State, readonly State[]> = {
  PROPOSED: ["READY", "BLOCKED", "CANCELLED"],
  READY: ["CLAIMED", "BLOCKED", "CANCELLED"],
  CLAIMED: ["PLANNING", "READY", "BLOCKED", "FAILED"],
  PLANNING: ["IMPLEMENTING", "BLOCKED", "FAILED", "READY"],
  IMPLEMENTING: ["TESTING", "BLOCKED", "FAILED", "READY"],
  TESTING: ["REVIEWING", "IMPLEMENTING", "FAILED", "READY"],
  REVIEWING: ["CHANGES_REQUESTED", "AWAITING_APPROVAL", "READY_TO_MERGE"],
  CHANGES_REQUESTED: ["IMPLEMENTING", "FAILED", "BLOCKED"],
  AWAITING_APPROVAL: ["READY_TO_MERGE", "CHANGES_REQUESTED", "BLOCKED"],
  READY_TO_MERGE: ["INTEGRATED", "CHANGES_REQUESTED"],
  INTEGRATED: ["PREVIEW_VALIDATED", "DONE"],
  PREVIEW_VALIDATED: ["DONE"],
  DONE: [],
  BLOCKED: ["READY", "CANCELLED"],
  FAILED: ["READY", "CANCELLED"],
  CANCELLED: [],
};

/** States in which a task holds a claim (counts against concurrency, cannot be claimed again). */
export const ACTIVE_STATES: readonly State[] = [
  "CLAIMED",
  "PLANNING",
  "IMPLEMENTING",
  "TESTING",
  "REVIEWING",
  "CHANGES_REQUESTED",
];

export const ROLES = [
  "medyra-orchestrator",
  "medyra-product-steward",
  "medyra-feature-engineer",
  "medyra-database-engineer",
  "medyra-qa-engineer",
  "medyra-security-reviewer",
  "medyra-code-reviewer",
  "medyra-devops-engineer",
  "medyra-documentation-steward",
  "medyra-maintenance-engineer",
] as const;
export type Role = (typeof ROLES)[number];

export const GATES = [
  "lint",
  "typecheck",
  "unit",
  "pglite",
  "build",
  "acceptance",
  "regression",
  "browser",
  "accessibility",
  "dependency-scan",
  "secret-scan",
  "code-review",
  "security-review",
  "migration-compatibility",
  "docs-consistency",
  "preview-smoke",
] as const;
export type Gate = (typeof GATES)[number];

export const RESULT = z.enum(["PASSED", "FAILED", "NOT_APPLICABLE", "NOT_EXECUTED", "BLOCKED"]);
export type Result = z.infer<typeof RESULT>;

const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
const iso = z.string().datetime({ offset: true });

export const RISK = z.enum(["low", "medium", "high", "critical"]);

export const TaskSchema = z.object({
  id: z.string().regex(TASK_ID),
  title: z.string().min(5).max(140),
  description: z.string().min(10),
  source: z.string().min(3),
  /** APPROVED only when engineering/approvals.json holds an owner record for this id. */
  approval: z.enum(["APPROVED_REQUIREMENT", "PROPOSED_BY_AGENT", "OWNER_DECISION_NEEDED"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  dependencies: z.array(z.string().regex(TASK_ID)).default([]),
  acceptanceCriteria: z.array(z.string().min(5)).min(1),
  risk: RISK,
  /** Security-sensitive tasks need the security reviewer and human sign-off before integration. */
  securitySensitive: z.boolean().default(false),
  requiredAgents: z.array(z.enum(ROLES)).min(1),
  fileScope: z.array(z.string().min(1)).min(1),
  requiredGates: z.array(z.enum(GATES)).min(1),
  state: z.enum(STATES),
  run: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  commitSha: sha.nullable().default(null),
  retryCount: z.number().int().min(0).default(0),
  blockers: z.array(z.string()).default([]),
  reviewResults: z
    .array(z.object({ role: z.enum(ROLES), verdict: z.enum(["PASS", "BLOCK"]), sha, at: iso, summary: z.string() }))
    .default([]),
  completionEvidence: z.string().nullable().default(null),
  claim: z.object({ runId: z.string(), owner: z.string(), claimedAt: iso, expiresAt: iso }).nullable().default(null),
  history: z.array(z.object({ from: z.enum(STATES), to: z.enum(STATES), at: iso, by: z.string(), note: z.string().optional() })).default([]),
});
export type Task = z.infer<typeof TaskSchema>;

export const BacklogSchema = z
  .object({ version: z.literal(1), canonical: z.literal("local-bootstrap"), tasks: z.array(TaskSchema) })
  .superRefine((b, ctx) => {
    const ids = new Set<string>();
    for (const t of b.tasks) {
      if (ids.has(t.id)) ctx.addIssue({ code: "custom", message: `duplicate task id ${t.id}` });
      ids.add(t.id);
    }
    for (const t of b.tasks) {
      for (const d of t.dependencies) {
        if (!ids.has(d)) ctx.addIssue({ code: "custom", message: `${t.id} depends on unknown ${d}` });
      }
    }
  });
export type Backlog = z.infer<typeof BacklogSchema>;

export const APPROVAL_SCOPES = ["execute", "integrate", "migrate-dev", "security-change", "dependency"] as const;

/** Owner-only file. Agents are blocked from editing it by the PreToolUse hook and by review policy. */
export const ApprovalsSchema = z.object({
  version: z.literal(1),
  approvals: z.array(
    z.object({
      taskId: z.string().regex(TASK_ID),
      scope: z.enum(APPROVAL_SCOPES),
      approvedBy: z.literal("owner"),
      at: iso,
      reference: z.string().min(3),
    }),
  ),
});
export type Approvals = z.infer<typeof ApprovalsSchema>;

/** Owner-only file: pause switch, activation flags and limits. */
export const ControlSchema = z.object({
  version: z.literal(1),
  paused: z.boolean(),
  pauseReason: z.string().optional(),
  autonomy: z.object({
    executionEnabled: z.boolean(),
    scheduleEnabled: z.boolean(),
    autoIntegrateToDev: z.boolean(),
    hostedDevMigrations: z.boolean(),
  }),
  limits: z.object({
    maxConcurrentImplementations: z.number().int().min(1).max(4),
    maxRemediationAttempts: z.number().int().min(0).max(5),
    maxTasksPerCycle: z.number().int().min(1).max(5),
    maxCycleMinutes: z.number().int().min(5).max(180),
    claimTtlMinutes: z.number().int().min(10).max(720),
    perRunUsd: z.number().positive(),
    perDayUsd: z.number().positive(),
    perMonthUsd: z.number().positive(),
  }),
  models: z.partialRecord(z.enum(ROLES), z.enum(["haiku", "sonnet", "opus", "inherit"])),
});
export type Control = z.infer<typeof ControlSchema>;

export const PolicySchema = z.object({
  version: z.literal(1),
  /** Files nobody but the owner edits (hook-enforced). */
  ownerOnlyPaths: z.array(z.string()),
  /** Secret or personal-data paths no agent may read. */
  secretPaths: z.array(z.string()),
  /** Paths changed by at most one active task at a time. */
  serializedPaths: z.array(z.string()),
  /** Paths whose change makes a task security-sensitive. */
  securitySensitivePaths: z.array(z.string()),
  /** Shell commands no agent may run. Substring match; defence in depth only. */
  forbiddenCommands: z.array(z.string()),
  /** Gates every task must pass regardless of what it declares. */
  mandatoryGates: z.array(z.enum(GATES)),
});
export type Policy = z.infer<typeof PolicySchema>;

export const UsageSchema = z.object({
  version: z.literal(1),
  entries: z.array(
    z.object({
      runId: z.string(),
      at: iso,
      usd: z.number().min(0),
      kind: z.enum(["estimated", "billed"]),
      source: z.string(),
    }),
  ),
});
export type Usage = z.infer<typeof UsageSchema>;

/** One agent handoff. Machine-validated; stored inside the run record. */
export const HandoffSchema = z.object({
  runId: z.string().min(3),
  taskId: z.string().regex(TASK_ID),
  role: z.enum(ROLES),
  inputSha: sha,
  outputSha: sha.nullable(),
  filesModified: z.array(z.string()),
  decisions: z.array(z.string()),
  testsExecuted: z.array(z.string()),
  testEvidence: z.array(z.object({ gate: z.enum(GATES), result: RESULT, detail: z.string() })),
  reviewFindings: z.array(
    z.object({
      severity: z.enum(["critical", "high", "medium", "low", "info"]),
      file: z.string(),
      line: z.number().int().nullable(),
      finding: z.string(),
      remediation: z.string(),
    }),
  ),
  unresolved: z.array(z.string()),
  nextAction: z.string().min(3),
  status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "FAILED"]),
  verdict: z.enum(["PASS", "BLOCK", "NONE"]).default("NONE"),
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const RunSchema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^run-\d{8}T\d{6}Z-[a-z0-9]{4,8}$/),
  taskId: z.string().regex(TASK_ID),
  mode: z.enum(["dry-run", "manual", "scheduled"]),
  startedAt: iso,
  baseSha: sha,
  branch: z.string(),
  checkpoints: z.array(z.object({ at: iso, state: z.enum(STATES), note: z.string(), sha: sha.nullable() })),
  handoffs: z.array(HandoffSchema),
  gates: z.partialRecord(z.enum(GATES), z.object({ result: RESULT, sha, detail: z.string() })).default({}),
  nextAction: z.string(),
  endedAt: iso.nullable().default(null),
});
export type Run = z.infer<typeof RunSchema>;
