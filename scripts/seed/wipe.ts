/**
 * DEVELOPMENT-ONLY wipe of the dev project's member data, with a keep-list.
 *   npm run seed:wipe                                  preview only (default): counts + accounts
 *   npm run seed:wipe -- --confirm-wipe=<project-ref>  also asks you to type "DELETE <project-ref>"
 *
 * What it does when confirmed: for each account NOT in SEED_KEEP_EMAILS it removes the account's
 * storage objects through the Storage API, then deletes the user from auth.users. The foreign keys
 * cascade to profiles, posts, likes, comments, education, experience, skills, preferences and
 * network rows. It never truncates, drops, or touches migrations, auth config, buckets or policies.
 *
 * Storage limits: the Storage API only lets a member delete their own files, and this tool only
 * holds passwords for accounts it created (scripts/.seed-output/accounts.json). Files that belong
 * to any other account cannot be removed through the API; the preview and the final report list
 * how many there are instead of reaching for a privileged key.
 */
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { memberClient, readAccounts, signIn, writeAccounts } from "./api.ts";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { managementQuery } from "./sql.ts";

const TABLES = [
  "profiles",
  "onboarding_preferences",
  "notification_preferences",
  "profile_education",
  "profile_experience",
  "profile_skills",
  "posts",
  "post_comments",
  "post_likes",
  "connections",
  "follows",
  "member_blocks",
  "saved_items",
  "notifications",
] as const;

const confirmArg = process.argv.find((a) => a.startsWith("--confirm-wipe="))?.split("=")[1];

type AccountRow = { id: string; email: string; created_at: string; objects: number };

export function parseKeepList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isSeedEmail = (email: string) => /^seed\+[a-z0-9_]+@example\.com$/.test(email.toLowerCase());

/** Counts only tables that exist, so the tool still works before a later migration is applied. */
async function countsFor(ref: string, token: string): Promise<Record<string, number>> {
  const present = await managementQuery<{ table_name: string }[]>(
    ref,
    token,
    "select table_name from information_schema.tables where table_schema = 'public'",
  );
  const names = new Set(present.map((r) => r.table_name));
  const columns = [
    "(select count(*) from auth.users)::int as accounts",
    ...TABLES.filter((t) => names.has(t)).map((t) => `(select count(*) from public.${t})::int as ${t}`),
    "(select count(*) from storage.objects where bucket_id in ('avatars','covers'))::int as storage_objects",
  ];
  const [row] = await managementQuery<Record<string, number>[]>(ref, token, `select ${columns.join(", ")}`);
  return row;
}

/** What a reset must not change: policies, triggers, functions and bucket configuration. */
const STRUCTURE_SQL = `select
  (select count(*) from pg_policies where schemaname in ('public','storage'))::int as policies,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and t.tgenabled = 'O' and n.nspname = 'public')::int as enabled_triggers,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and t.tgenabled <> 'O' and n.nspname = 'public')::int as disabled_triggers,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int as tables_without_rls,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private'))::int as functions,
  (select md5(string_agg(id || public::text || coalesce(file_size_limit::text,'') || coalesce(allowed_mime_types::text,''), ',' order by id)) from storage.buckets) as buckets_hash`;

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const keep = parseKeepList(env.SEED_KEEP_EMAILS);

  const accounts = await managementQuery<AccountRow[]>(
    target.ref,
    token,
    `select u.id, lower(u.email) as email, u.created_at,
       (select count(*) from storage.objects o where (storage.foldername(o.name))[1] = u.id::text)::int as objects
     from auth.users u order by u.created_at`,
  );
  const before = await countsFor(target.ref, token);

  console.log(`Project: ${target.ref} (allowed by SEED_ALLOWED_PROJECT_REF)`);
  console.log("\nRows per table right now:");
  console.table(before);

  const doomed = accounts.filter((a) => !keep.includes(a.email));
  const kept = accounts.filter((a) => keep.includes(a.email));
  const missingKeep = keep.filter((k) => !accounts.some((a) => a.email === k));

  console.log(`\nAccounts: ${accounts.length} total, ${kept.length} on the keep list, ${doomed.length} would be deleted.`);
  console.table(
    accounts.map((a) => ({
      email: a.email,
      created: a.created_at.slice(0, 10),
      seedCreated: isSeedEmail(a.email),
      action: keep.includes(a.email) ? "KEEP" : "delete",
      storageFiles: a.objects,
    })),
  );
  if (keep.length === 0) {
    console.log(
      "\nSEED_KEEP_EMAILS is empty in .env.local, so EVERY account above would be deleted.\n" +
        "Tell me which email addresses to keep (comma-separated), then it goes into .env.local.",
    );
  }
  if (missingKeep.length > 0) {
    console.log(`\nKeep-list addresses with no account: ${missingKeep.length} (check spelling).`);
  }

  const file = readAccounts(target.ref);
  const reachable = new Set(file.accounts.map((a) => a.id));
  const orphanedFiles = doomed.filter((a) => !reachable.has(a.id)).reduce((n, a) => n + a.objects, 0);
  if (orphanedFiles > 0) {
    console.log(
      `\nNote: ${orphanedFiles} storage file(s) belong to accounts this tool has no password for. ` +
        "The Storage API cannot delete them without that member's session, so they would stay behind " +
        "as unreferenced files after the accounts are removed.",
    );
  }

  if (!confirmArg) {
    console.log("\nPreview only. Nothing was deleted.");
    return;
  }

  // ------------------------------------------------------------------------------ confirmed path
  if (confirmArg !== target.ref) {
    throw new SeedSafetyError("--confirm-wipe must equal the project ref being wiped.");
  }
  if (keep.length === 0) {
    throw new SeedSafetyError("SEED_KEEP_EMAILS is empty. Refusing to wipe every account; set it deliberately first.");
  }
  if (!process.stdin.isTTY) {
    throw new SeedSafetyError("The typed confirmation needs an interactive terminal.");
  }
  const phrase = `DELETE ${target.ref}`;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = (await rl.question(`\nType exactly "${phrase}" to delete ${doomed.length} accounts: `)).trim();
  rl.close();
  if (typed !== phrase) {
    console.log("Phrase did not match. Nothing was deleted.");
    return;
  }

  const structureBefore = (await managementQuery<Record<string, unknown>[]>(target.ref, token, STRUCTURE_SQL))[0];
  let removedFiles = 0;
  console.log("\nDeleting storage files through the Storage API (as each reachable member)…");
  for (const account of file.accounts) {
    const row = doomed.find((d) => d.id === account.id);
    if (!row || row.objects === 0) continue;
    const session = await signIn(target, account.email, account.password);
    if (!session) continue;
    const client = memberClient(target, session.token);
    for (const bucket of ["avatars", "covers"]) {
      const paths = await client.list(bucket, session.id);
      if (paths.length > 0 && (await client.remove(bucket, paths)) === 200) removedFiles += paths.length;
    }
  }
  console.log(`  removed ${removedFiles} files`);

  const ids = doomed.map((d) => `'${d.id}'`).join(",");
  if (ids) {
    const deleted = await managementQuery<{ id: string }[]>(
      target.ref,
      token,
      `delete from auth.users where id in (${ids}) returning id`,
    );
    console.log(`Deleted ${deleted.length} accounts (profiles and all content cascade).`);
    // Forget the stored passwords of accounts that no longer exist.
    const gone = new Set(deleted.map((d) => d.id));
    writeAccounts({ project: target.ref, accounts: file.accounts.filter((a) => !gone.has(a.id)) });
  }

  const after = await countsFor(target.ref, token);
  console.log("\nBefore / after:");
  console.table({ before, after });
  const structureAfter = (await managementQuery<Record<string, unknown>[]>(target.ref, token, STRUCTURE_SQL))[0];
  const unchanged = JSON.stringify(structureBefore) === JSON.stringify(structureAfter);
  console.log(unchanged ? "Verified: policies, triggers, functions and buckets are unchanged; no trigger is disabled." : `WARNING: structure changed: ${JSON.stringify({ structureBefore, structureAfter })}`);
  const remaining = await managementQuery<{ email: string }[]>(
    target.ref,
    token,
    "select lower(email) as email from auth.users",
  );
  const structureText = unchanged
    ? "Policies, enabled triggers, functions, RLS flags and bucket configuration are identical before and after; no trigger was disabled and no bypass was used."
    : `**Changed, investigate:** ${JSON.stringify({ structureBefore, structureAfter })}`;
  writeFileSync(
    "DATABASE_RESET_REPORT.md",
    [
      "# Database reset report (medyra-dev)",
      "",
      `Run on ${new Date().toISOString()} by \`npm run db:reset:dev\`. Accounts remaining: ${remaining.length} (${keep.length} on the keep list). Deleted accounts: ${doomed.length}. Storage files removed through the Storage API: ${removedFiles}.`,
      "",
      "## Rows per table, before and after",
      "",
      "| Table | Before | After |",
      "| --- | ---: | ---: |",
      ...Object.keys(before).map((k) => `| ${k} | ${before[k]} | ${after[k]} |`),
      "",
      "## Structure check",
      "",
      structureText,
      "",
      "```json",
      JSON.stringify({ structureBefore, structureAfter }, null, 1),
      "```",
      "",
    ].join("\n"),
  );
  const stray = remaining.filter((r) => !keep.includes(r.email));
  console.log(
    stray.length === 0
      ? `Verified: only the ${remaining.length} kept account(s) remain.`
      : `WARNING: ${stray.length} account(s) outside the keep list remain.`,
  );
}

if (process.argv[1]?.endsWith("wipe.ts")) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof SeedSafetyError
        ? `\nRefusing to run: ${error.message}`
        : `\nWipe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
