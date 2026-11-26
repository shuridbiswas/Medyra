/**
 * Read-only migration parity report for the DEV database: which repo migrations are recorded in
 * supabase_migrations.schema_migrations and which are pending. Runs only in
 * .github/workflows/dev-migration.yml with a scoped token from a protected environment. It never
 * applies, resets or writes anything. Exit 0 = in parity, 5 = pending migrations, 1 = error.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { assertDevOnly, loadEnvironment, requireManagementToken } from "../seed/safety.ts";
import { managementQuery } from "../seed/sql.ts";

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const rows = await managementQuery<{ version: string }[]>(target.ref, token, "select version from supabase_migrations.schema_migrations order by version");
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(path.join(process.cwd(), "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.has(f.split("_")[0]));
  const unknown = [...applied].filter((v) => !files.some((f) => f.startsWith(`${v}_`)));
  console.log(JSON.stringify({ project: "dev", repoMigrations: files.length, applied: applied.size, pending, appliedButNotInRepo: unknown }, null, 2));
  process.exit(pending.length || unknown.length ? 5 : 0);
}

main().catch((error: unknown) => {
  console.error(`parity check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
