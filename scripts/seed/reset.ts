/**
 * Dry run of the full member-data reset (Stage B will add the confirmed path).
 *   npm run db:reset:dry-run
 * It really executes `delete from auth.users` for every account not in SEED_KEEP_EMAILS inside a
 * DO block, counts what is left in every public table, then raises an exception so the whole
 * transaction rolls back. Nothing is changed. If a protection trigger blocks the delete, the
 * trigger's message is shown: that is the real blocker a wipe would hit.
 */
import { readAccounts } from "./api.ts";
import { parseKeepList } from "./wipe.ts";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { managementQuery } from "./sql.ts";

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const q = <T>(sql: string) => managementQuery<T[]>(target.ref, token, sql);
  const keep = parseKeepList(env.SEED_KEEP_EMAILS);
  const lit = (list: string[]) => `array[${list.map((e) => `'${e.replace(/'/g, "''")}'`).join(",")}]::text[]`;

  const tables = (await q<{ t: string }>(
    `select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`,
  )).map((r) => r.t);
  const before = await q<Record<string, number>>(
    `select ${tables.map((t) => `(select count(*) from public.${t})::int as "${t}"`).join(", ")}`,
  );

  let after: Record<string, number> | null = null;
  let blocker: string | null = null;
  try {
    await q(`do $$ declare r record; n int; o jsonb := '{}'; begin
      delete from auth.users where lower(email) <> all (${lit(keep)});
      for r in select c.relname t from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public' and c.relkind = 'r' loop
        execute format('select count(*) from public.%I', r.t) into n; o := o || jsonb_build_object(r.t, n);
      end loop;
      raise exception 'DRYRUN%', o::text;
    end $$;`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const m = /DRYRUN(\{[^}]*\})/.exec(message.replace(/\\"/g, '"'));
    if (m) after = JSON.parse(m[1]) as Record<string, number>;
    else blocker = message.slice(0, 500);
  }

  const users = await q<{ email: string; created: string; seeded: boolean; files: number }>(
    `select lower(u.email) email, to_char(u.created_at, 'YYYY-MM-DD') created, u.email like 'seed+%@example.com' seeded,
       (select count(*) from storage.objects o where (storage.foldername(o.name))[1] = u.id::text)::int files from auth.users u order by u.created_at`,
  );
  const known = new Set(readAccounts(target.ref).accounts.map((a) => a.email));
  const doomed = users.filter((u) => !keep.includes(u.email));

  console.log(`Project ${target.ref}. Keep list: ${keep.length ? keep.length + " address(es)" : "EMPTY (every account would be deleted: tell me which to keep)"}`);
  console.log("\nAccounts:");
  console.table(users.map((u) => ({ email: u.email, created: u.created, seeded: u.seeded, action: keep.includes(u.email) ? "KEEP" : "delete", storageFiles: u.files, filesDeletableViaApi: u.files === 0 || known.has(u.email) })));
  if (after) {
    console.log("\nRows per table (before -> after the delete cascade; difference = rows removed):");
    console.table(Object.fromEntries(tables.map((t) => [t, { before: before[0][t], after: after![t], removed: before[0][t] - after![t] }])));
  } else {
    console.log(`\nBLOCKER: the account delete failed inside the dry run: ${blocker}`);
  }
  const orphaned = doomed.filter((u) => u.files > 0 && !known.has(u.email));
  console.log(
    orphaned.length
      ? `\nStorage: ${orphaned.reduce((n, u) => n + u.files, 0)} file(s) belong to ${orphaned.length} account(s) whose password this tool does not hold. The Storage API cannot delete them without that session; use the dashboard "Empty bucket" action.`
      : `\nStorage: every file of a deleted account can be removed through the Storage API (${doomed.reduce((n, u) => n + u.files, 0)} file(s)).`,
  );
  console.log("\nDry run only: the transaction was rolled back and nothing changed.");
}

if (process.argv[1]?.endsWith("reset.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof SeedSafetyError ? `\nRefusing to run: ${error.message}` : `\nDry run failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
