#!/usr/bin/env node
/**
 * PreToolUse guard for every Claude session in this repository (interactive, headless, subagents).
 * Rules come from engineering/policy.json so the hook, CI and the orchestrator share one policy.
 *
 * Always denied: reading or searching secret paths (.env.local, seed passwords, credentials...).
 * Denied unless the OWNER started Claude with MEDYRA_OWNER_MODE=1: editing owner-only files
 * (control, approvals, policy, settings, hooks) and forbidden shell commands (resets, wipes,
 * hosted migrations, force pushes, deploys, dependency installs).
 *
 * String matching is defence in depth only: unattended runs also execute in CI where secrets and
 * production credentials are simply absent. Fails closed: if input or policy cannot be read, deny.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const ownerMode = process.env.MEDYRA_OWNER_MODE === "1";
const ALWAYS_SECRET_TOKENS = [".env.local", ".credentials.json", ".seed-output", "supabase_access_token", ".git-credentials"];

function decide(decision, reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
  process.exit(0);
}

const deny = (reason) => decide("deny", `Medyra guard: ${reason}`);

export function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped.replace(/\u0000/g, ".*")}$`, "i");
}

const matches = (rel, globs) => globs.some((g) => globToRegExp(g).test(rel) || globToRegExp(g).test(path.posix.basename(rel)));

function relative(p) {
  const abs = path.resolve(projectDir, p);
  return path.relative(projectDir, abs).split(path.sep).join("/");
}

let input;
let policy;
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
  policy = JSON.parse(readFileSync(path.join(projectDir, "engineering", "policy.json"), "utf8"));
} catch (error) {
  deny(`could not read hook input or engineering/policy.json (${error.message}); refusing by default`);
}

const tool = input.tool_name ?? "";
const ti = input.tool_input ?? {};

if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const file = ti.file_path ?? ti.notebook_path ?? "";
  const rel = relative(file);
  if (matches(rel, policy.secretPaths) || ALWAYS_SECRET_TOKENS.some((t) => rel.toLowerCase().includes(t))) {
    deny(`${rel} is a secret or personal-data path. Use .env.example for variable names.`);
  }
  if (tool !== "Read" && !ownerMode && matches(rel, policy.ownerOnlyPaths)) {
    deny(`${rel} is owner-only (engineering/policy.json). Propose the change in a PR description instead.`);
  }
}

if (tool === "Grep" || tool === "Glob") {
  const text = [ti.path, ti.pattern, ti.glob].filter(Boolean).join(" ").toLowerCase();
  if (ALWAYS_SECRET_TOKENS.some((t) => text.includes(t))) deny("searching secret paths is not allowed");
}

if (tool === "Bash" || tool === "PowerShell") {
  const command = String(ti.command ?? "");
  const lower = command.toLowerCase();
  if (ALWAYS_SECRET_TOKENS.some((t) => lower.includes(t))) deny("the command references a secret path or credential");
  if (/\bprintenv\b|\benv\s*$|\bset\s*$|get-childitem\s+env:|\$env:[a-z_]*(key|token|secret)/i.test(command)) {
    deny("dumping environment variables is not allowed");
  }
  if (!ownerMode) {
    const hit = policy.forbiddenCommands.find((f) => lower.includes(f.toLowerCase()));
    if (hit) deny(`'${hit}' is forbidden for agents (engineering/policy.json). The owner can run it manually.`);
  }
}

process.exit(0);
