/**
 * Read-only audit and backup of the DEV database.
 *   npm run db:audit    writes DATABASE_AUDIT.md (live schema, counts, classification)
 *   npm run db:backup   exports every public table to scripts/.backup/<UTC timestamp>/*.json
 * Nothing is modified. The backup is a data export (rows as JSON), not a restore guarantee:
 * it does not include schema, policies, auth settings or the files themselves, and there is no
 * point-in-time recovery.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { managementQuery } from "./sql.ts";

type Row = Record<string, unknown>;

/** Tables that must never be bulk-cleared: append-only history and security logs. */
export const APPEND_ONLY = ["audit_logs", "community_audit_logs", "two_factor_events", "moderation_actions", "verification_review_events", "verification_audit_log"];
/** Fixed lists seeded by migrations; kept by the reset when they exist. */
export const REFERENCE_HINT = ["forum_topics", "retention_policies", "verification_policy", "academic_institutions", "institution_verification_methods", "program_categories", "academic_programs"];

export type Classification = "MEMBER DATA" | "REFERENCE/CONFIG" | "APPEND-ONLY";

// linksToMembers is kept for the audit table; child tables (mentor_availability) link through
// another member table, so only the named fixed lists count as reference data.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function classify(table: string, _linksToMembers?: boolean): Classification {
  if (APPEND_ONLY.includes(table)) return "APPEND-ONLY";
  if (REFERENCE_HINT.includes(table)) return "REFERENCE/CONFIG";
  return "MEMBER DATA";
}

/** Tables a migration file creates, and whether the CREATE TABLE block mentions members. */
export function migrationTables(dir: string) {
  const out: { table: string; file: string; linksToMembers: boolean }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(dir, file), "utf8");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+) \(([\s\S]*?)\n\);/g)) {
      out.push({ table: m[1], file, linksToMembers: /references (public\.profiles|auth\.users)/.test(m[2]) });
    }
  }
  return out;
}

const COUNT = `(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::int`;

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const q = <T = Row>(sql: string) => managementQuery<T[]>(target.ref, token, sql);
  const backup = process.argv.includes("--backup");

  const tables = await q<{ t: string; rls: boolean; policies: number; rows: number }>(
    `select c.relname t, c.relrowsecurity rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int policies,
       ${COUNT} as rows
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  );

  if (backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(process.cwd(), "scripts", ".backup", stamp);
    mkdirSync(dir, { recursive: true });
    const rows: string[] = [];
    // shortcut: whole-table export in one request, fine at dev scale; page it if a table passes ~50k rows.
    for (const t of tables) {
      const [{ data }] = await q<{ data: Row[] }>(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as data from public.${t.t} x`);
      writeFileSync(path.join(dir, `${t.t}.json`), JSON.stringify(data));
      rows.push(`${t.t}: ${data.length === t.rows ? "ok" : "MISMATCH"} (${data.length}/${t.rows})`);
    }
    const users = await q(`select id, lower(email) as email, created_at, last_sign_in_at from auth.users order by created_at`);
    writeFileSync(path.join(dir, "_auth_users.json"), JSON.stringify(users));
    const objects = await q(`select bucket_id, name, (metadata->>'size')::int as size from storage.objects order by 1, 2`);
    writeFileSync(path.join(dir, "_storage_objects.json"), JSON.stringify(objects));
    console.log(`Backup written to ${path.relative(process.cwd(), dir)} (git-ignored)`);
    console.log(rows.join("\n"));
    console.log(`auth users: ${users.length}, storage object names: ${objects.length}`);
    const bad = rows.filter((r) => r.includes("MISMATCH"));
    if (bad.length) throw new Error(`Row counts differ from the live tables for: ${bad.join(", ")}`);
    console.log("Verified: every exported table has as many rows as the live table.");
    return;
  }

  const applied = (await q<{ version: string }>("select version from supabase_migrations.schema_migrations order by 1")).map((r) => r.version);
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !applied.includes(f.split("_")[0]));
  const repoTables = migrationTables("supabase/migrations");
  const live = new Set(tables.map((t) => t.t));
  const linkOf = new Map(repoTables.map((t) => [t.table, t.linksToMembers]));

  const cols = await q<{ t: string; cols: string }>(
    `select table_name t, string_agg(column_name || ' ' || data_type || case when is_nullable = 'NO' then ' NN' else '' end, ', ' order by ordinal_position) cols
       from information_schema.columns where table_schema = 'public' group by 1 order by 1`,
  );
  const fks = await q<{ t: string; ref: string; rule: string }>(
    `select conrelid::regclass::text t, confrelid::regclass::text ref,
       case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' else confdeltype::text end rule
       from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace order by 1, 2`,
  );
  const cons = await q<{ t: string; kind: string; n: number }>(
    `select conrelid::regclass::text t, case contype when 'c' then 'CHECK' when 'u' then 'UNIQUE' when 'p' then 'PRIMARY KEY' end kind, count(*)::int n
       from pg_constraint where contype in ('c','u','p') and connamespace = 'public'::regnamespace group by 1, 2 order by 1, 2`,
  );
  const triggers = await q<{ t: string; trg: string; fn: string }>(
    `select c.relname t, tg.tgname trg, p.proname fn from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = tg.tgfoid
      where not tg.tgisinternal and n.nspname in ('public','auth') order by 1, 2`,
  );
  const fns = await q<{ s: string; f: string; definer: boolean }>(
    `select n.nspname s, p.proname f, p.prosecdef definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') order by 1, 2`,
  );
  const buckets = await q<{ id: string; public: boolean; limit: number | null; objects: number }>(
    `select b.id, b.public, b.file_size_limit as limit, (select count(*) from storage.objects o where o.bucket_id = b.id)::int objects from storage.buckets b order by 1`,
  );
  const users = await q<{ email: string; created: string; seeded: boolean; files: number }>(
    `select lower(u.email) email, to_char(u.created_at, 'YYYY-MM-DD') created, u.email like 'seed+%@example.com' seeded,
       (select count(*) from storage.objects o where (storage.foldername(o.name))[1] = u.id::text)::int files
       from auth.users u order by u.created_at`,
  );

  const by = <T extends { t: string }>(rows: T[], t: string) => rows.filter((r) => r.t === t);
  const keep = (env.SEED_KEEP_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);
  const md: string[] = [];
  md.push("# Database audit (medyra-dev)", "", `Generated by \`npm run db:audit\` on ${new Date().toISOString()} from the LIVE database plus the repo migrations. Read-only. Project ref \`${target.ref}\`.`, "");
  md.push("## 1. Migrations: repo vs live", "", `Repo: ${files.length} files. Applied to the dev database: ${applied.length}.`, "");
  md.push(pending.length ? `**Not applied to dev (${pending.length}):** ${pending.map((f) => `\`${f}\``).join(", ")}. Their tables and functions below are marked "repo only". Stage C/D cannot seed those modules until they are applied.` : "All repo migrations are applied.", "");
  md.push("## 2. Tables, classification and row counts", "", "| Table | Class | Live rows | RLS | Policies | Owning module |", "| --- | --- | ---: | --- | ---: | --- |");
  const moduleOf = (t: string) => repoTables.find((x) => x.table === t)?.file.replace(/^\d+_/, "").replace(".sql", "") ?? "";
  for (const t of tables) md.push(`| ${t.t} | ${classify(t.t, linkOf.get(t.t) ?? true)} | ${t.rows} | ${t.rls ? "on" : "**OFF**"} | ${t.policies} | ${moduleOf(t.t)} |`);
  for (const t of repoTables.filter((x) => !live.has(x.table))) md.push(`| ${t.table} | ${classify(t.table, t.linksToMembers)} | repo only | - | - | ${t.file.replace(/^\d+_/, "").replace(".sql", "")} |`);
  md.push("", "Classification is derived: append-only tables are the known history and security logs; only the fixed lists (`forum_topics`, `retention_policies`, `verification_policy` and the institution and program registry) are reference/config and are confirmed against their data once the migrations are applied; everything else is member data. `staff_roles` is member data but is the admin grant: a reset deletes administrators' rows too unless their account is on the keep list.", "");
  md.push("## 3. Columns", "");
  for (const t of tables) md.push(`- **${t.t}**: ${by(cols, t.t)[0]?.cols ?? ""}`);
  md.push("", "## 4. Foreign keys and delete behaviour", "", "| From | To | On delete |", "| --- | --- | --- |", ...fks.map((f) => `| ${f.t} | ${f.ref} | ${f.rule} |`));
  md.push("", "## 5. Constraints (live)", "", ...tables.map((t) => `- ${t.t}: ${by(cons, t.t).map((c) => `${c.n} ${c.kind}`).join(", ") || "none"}`));
  md.push("", "## 6. Triggers (live)", "", ...triggers.map((t) => `- ${t.t}: \`${t.trg}\` -> ${t.fn}()`));
  md.push("", "## 7. Functions (live)", "", `public/private functions: ${fns.length}, of which security definer: ${fns.filter((f) => f.definer).length}.`, "", ...fns.map((f) => `- ${f.s}.${f.f}${f.definer ? " (security definer)" : ""}`));
  md.push("", "## 8. Storage buckets (live)", "", "| Bucket | Public | Size limit | Objects |", "| --- | --- | ---: | ---: |", ...buckets.map((b) => `| ${b.id} | ${b.public} | ${b.limit ?? ""} | ${b.objects} |`));
  md.push("", "## 9. Accounts", "", `${users.length} account(s); ${users.filter((u) => u.seeded).length} seeded. Keep list (SEED_KEEP_EMAILS): ${keep.length ? keep.length + " address(es)" : "**empty, ask the owner**"}.`, "");
  md.push("| Email | Created | Seeded | Storage files |", "| --- | --- | --- | ---: |", ...users.map((u) => `| ${u.email} | ${u.created} | ${u.seeded} | ${u.files} |`));
  md.push("", "## 10. Administrator mechanism and sign-in gates", "",
    "- **Admin:** `private.is_admin()` is true for a member with a row in `public.staff_roles` (role `admin`). The app never writes that table; the project owner inserts the row with SQL (for example through the Management API). It is not a profile flag. Staff actions run only through security definer functions that check `is_admin()` and write `audit_logs`. The admin area also demands a confirmed two-step sign-in (`requireAdmin()`).",
    "- **Sign-in code:** `MFA_ENFORCEMENT` (required by default; `off` for local development only) and `TWO_FACTOR_SECRET` plus Resend for emailed codes. If the secret is missing members are not challenged, but `requireAdmin()` stays closed.",
    `- **Upstash:** ${env.UPSTASH_REDIS_REST_URL ? "configured (check keys before reset)" : "not configured: nothing to clean there"}. **Pinecone:** ${env.PINECONE_API_KEY ? "configured (check namespaces before reset)" : "not configured: nothing to clean there"}.`);
  md.push("", "## 11. Append-only tables (special handling)", "", `${APPEND_ONLY.map((t) => `\`${t}\``).join(", ")}. Account deletion cascades and the protection triggers' account-deletion exemptions are tried first; anything left is reported and not bypassed without approval.`);
  writeFileSync("DATABASE_AUDIT.md", md.join("\n") + "\n");
  console.log(`Wrote DATABASE_AUDIT.md: ${tables.length} live tables, ${repoTables.filter((x) => !live.has(x.table)).length} repo-only, ${pending.length} pending migration(s).`);
}

if (process.argv[1]?.endsWith("audit.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof SeedSafetyError ? `\nRefusing to run: ${error.message}` : `\nAudit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
