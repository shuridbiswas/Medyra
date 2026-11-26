/**
 * Durable state on disk: JSON files under `engineering/`, validated on every read, written
 * atomically (temp file + rename), with a cross-process mutex so two runners cannot interleave
 * read-modify-write cycles. In CI the files are committed to a branch, so state survives the runner.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import {
  ApprovalsSchema,
  BacklogSchema,
  ControlSchema,
  PolicySchema,
  RunSchema,
  UsageSchema,
  type Run,
} from "./model.ts";

export class StoreError extends Error {}

export function engineeringPaths(root: string) {
  const dir = path.join(root, "engineering");
  return {
    dir,
    backlog: path.join(dir, "backlog.json"),
    approvals: path.join(dir, "approvals.json"),
    control: path.join(dir, "control.json"),
    policy: path.join(dir, "policy.json"),
    usage: path.join(dir, "usage.json"),
    runs: path.join(dir, "runs"),
    mutex: path.join(dir, ".mutex"),
    run: (runId: string) => path.join(dir, "runs", `${runId}.json`),
  };
}

export function readJson<S extends z.ZodTypeAny>(file: string, schema: S): z.infer<S> {
  if (!existsSync(file)) throw new StoreError(`missing ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new StoreError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new StoreError(`${path.basename(file)} is invalid: ${issues}`);
  }
  return parsed.data;
}

export function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

export function loadState(root: string) {
  const p = engineeringPaths(root);
  return {
    backlog: readJson(p.backlog, BacklogSchema),
    approvals: readJson(p.approvals, ApprovalsSchema),
    control: readJson(p.control, ControlSchema),
    policy: readJson(p.policy, PolicySchema),
    usage: readJson(p.usage, UsageSchema),
  };
}

export function loadRun(root: string, runId: string): Run | null {
  const file = engineeringPaths(root).run(runId);
  return existsSync(file) ? readJson(file, RunSchema) : null;
}

/**
 * Cross-process mutex around state mutations. The lock file is created exclusively; a lock older
 * than `staleMs` (crashed process) is broken. Not a substitute for CI `concurrency` groups, which
 * serialize runners across machines.
 */
export async function withMutex<T>(root: string, fn: () => T | Promise<T>, staleMs = 10 * 60_000, attempts = 50): Promise<T> {
  const lock = engineeringPaths(root).mutex;
  mkdirSync(path.dirname(lock), { recursive: true });
  for (let i = 0; i < attempts; i++) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      try {
        return await fn();
      } finally {
        rmSync(lock, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) rmSync(lock, { force: true });
      } catch {
        // the holder released it between the two calls
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new StoreError("could not acquire engineering/.mutex (another run holds it)");
}
