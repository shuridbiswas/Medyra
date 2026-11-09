/**
 * Applies repo migrations that the DEV database has not recorded yet, in order, through the
 * Management API, and records each in supabase_migrations.schema_migrations (the same history
 * `supabase db push` reads). Migration files are never edited. Stops at the first failure.
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { managementQuery } from "./sql.ts";

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const q = <T>(sql: string) => managementQuery<T[]>(target.ref, token, sql);
  const applied = new Set((await q<{ version: string }>("select version from supabase_migrations.schema_migrations")).map((r) => r.version));
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const pending = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !applied.has(f.split("_")[0]));
  if (pending.length === 0) return console.log("Nothing to apply: every migration is recorded.");
  for (const file of pending) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    console.log(`Applying ${file} ...`);
    await q(sql);
    await q(`insert into supabase_migrations.schema_migrations (version, name, statements) values ('${version}', '${rest.join("_")}', array[$mig$${sql}$mig$])`);
    console.log("  applied and recorded");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SeedSafetyError ? `\nRefusing to run: ${error.message}` : `\nMigration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
