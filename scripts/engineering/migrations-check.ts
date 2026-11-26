/**
 * Migration safety gate.
 *   node scripts/engineering/migrations-check.ts           # verify
 *   node scripts/engineering/migrations-check.ts --record  # append NEW files to the lock (never rewrites existing entries)
 *   node scripts/engineering/migrations-check.ts --record --baseline  # one-time: lock every current file without content rules
 *
 * Fails when: a file name is not `<14-digit timestamp>_<snake_name>.sql`; two files share a
 * timestamp; a new file is older than the newest locked one (ordering); a locked file changed or
 * disappeared (applied migrations are immutable); or the migration uses statements that destroy
 * data without an explicit `-- medyra:destructive-approved <task id>` marker.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Lock = { version: 1; files: Record<string, string> };

const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const DESTRUCTIVE = /\b(drop\s+table|drop\s+schema|truncate\s|delete\s+from\s+(?!public\.notifications\b)[a-z_.]+\s*;|alter\s+table\s+[a-z_.]+\s+drop\s+column)/i;

export const hash = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

export function check(files: Record<string, string>, lock: Lock): { errors: string[]; additions: string[] } {
  const errors: string[] = [];
  const names = Object.keys(files).sort();
  const seen = new Map<string, string>();
  for (const n of names) {
    const m = NAME.exec(n);
    if (!m) {
      errors.push(`${n}: name must be <YYYYMMDDHHMMSS>_<snake_case>.sql`);
      continue;
    }
    if (seen.has(m[1])) errors.push(`${n}: timestamp ${m[1]} already used by ${seen.get(m[1])}`);
    seen.set(m[1], n);
  }
  for (const [n, h] of Object.entries(lock.files)) {
    if (!(n in files)) errors.push(`${n}: locked migration (committed migrations are treated as applied) was deleted or renamed`);
    else if (hash(files[n]) !== h) errors.push(`${n}: locked migration (committed migrations are treated as applied) was modified; write a new migration instead`);
  }
  const newestLocked = Object.keys(lock.files).sort().at(-1) ?? "";
  const additions = names.filter((n) => !(n in lock.files));
  for (const n of additions) {
    if (n < newestLocked) errors.push(`${n}: new migration sorts before already-locked ${newestLocked}`);
    const body = files[n];
    if (DESTRUCTIVE.test(body) && !/--\s*medyra:destructive-approved\s+[A-Z]+-\d{3}/.test(body)) {
      errors.push(`${n}: destructive statement without '-- medyra:destructive-approved <TASK-ID>'`);
    }
    if (/create\s+(or\s+replace\s+)?function\s+private\./i.test(body) && !/revoke\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+private/i.test(body)) {
      errors.push(`${n}: adds private functions but does not re-run 'revoke execute on all functions in schema private'`);
    }
    if (/security\s+definer/i.test(body) && !/(auth\.uid\(\)|private\.is_admin\(\)|private\.is_member\(\))/i.test(body)) {
      errors.push(`${n}: security definer function without an auth.uid()/is_admin()/is_member() check`);
    }
  }
  return { errors, additions };
}

function main() {
  const root = process.cwd();
  const dir = path.join(root, "supabase", "migrations");
  const lockFile = path.join(root, "engineering", "migrations.lock.json");
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
  const lock: Lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")) : { version: 1, files: {} };
  const { errors, additions } = check(files, lock);
  if (process.argv.includes("--record")) {
    const baseline = process.argv.includes("--baseline") && Object.keys(lock.files).length === 0;
    if (errors.length && !baseline) {
      console.error(errors.join("\n"));
      process.exit(1);
    }
    for (const n of additions) lock.files[n] = hash(files[n]);
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`recorded ${additions.length} new migration(s)`);
    return;
  }
  if (errors.length) {
    console.error(`migration check failed:\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log(`migration check: ${Object.keys(files).length} files, ${additions.length} not yet locked${additions.length ? ` (${additions.join(", ")}; run with --record in the same PR)` : ""}`);
}

if (process.argv[1]?.endsWith("migrations-check.ts")) main();
