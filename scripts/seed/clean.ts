/**
 * Removes ONLY the seed data: accounts whose email matches seed+%@example.com (their profiles,
 * posts, comments, likes and profile rows cascade) and their images.
 *   npm run seed:clean -- --dry-run     show what would be deleted
 *   npm run seed:clean                  delete it
 * Images are deleted through the Storage API as each member BEFORE the account is removed, because
 * storage objects are not covered by the database cascade.
 */
import { memberClient, readAccounts, removeAccountsFile, signIn } from "./api.ts";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { COUNT_SQL, managementQuery } from "./sql.ts";

const dryRun = process.argv.includes("--dry-run");
const skipStorage = process.argv.includes("--skip-storage");
const MAX_EXPECTED = 100; // refuse if the pattern somehow matches far more than a seed run creates

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);

  const [{ n }] = await managementQuery<{ n: number }[]>(
    target.ref,
    token,
    "select count(*)::int as n from auth.users where email like 'seed+%@example.com'",
  );
  console.log(`Seed accounts found in ${target.ref}: ${n}`);
  if (n > MAX_EXPECTED) {
    throw new Error(`Matched ${n} accounts, more than the ${MAX_EXPECTED} a seed run creates. Not deleting anything.`);
  }
  console.log("Current seed data:");
  console.table(await managementQuery(target.ref, token, COUNT_SQL));
  if (dryRun) {
    console.log("Dry run: nothing deleted.");
    return;
  }
  if (n === 0) {
    removeAccountsFile();
    console.log("Nothing to delete.");
    return;
  }

  const file = readAccounts(target.ref);
  if (file.accounts.length === 0 && !skipStorage) {
    throw new Error(
      "scripts/.seed-output/accounts.json is missing, so images cannot be deleted through the Storage API " +
        "(they would be orphaned when the accounts go). Re-run with --skip-storage to delete the accounts anyway.",
    );
  }

  let removedImages = 0;
  let unreachable = 0;
  if (!skipStorage) {
    console.log("Deleting images through the Storage API as each member…");
    for (const account of file.accounts) {
      const session = await signIn(target, account.email, account.password);
      if (!session) {
        unreachable++;
        continue;
      }
      const client = memberClient(target, session.token);
      for (const bucket of ["avatars", "covers"]) {
        const paths = await client.list(bucket, session.id);
        if (paths.length > 0 && (await client.remove(bucket, paths)) === 200) removedImages += paths.length;
      }
    }
    console.log(`  removed ${removedImages} images; ${unreachable} accounts could not be signed in to`);
  }

  // Rows that outlive their creator (communities keep created_by = null) or that the seeder tagged.
  await managementQuery(
    target.ref,
    token,
    `delete from public.reports where details like '[seed]%';
     delete from public.communities where slug like 'seed-%';
     delete from public.student_verified_credentials where issuer like '[DEV TEST DATA]%';
     delete from public.student_verification_requests where student_message like '[DEV TEST DATA]%';
     delete from public.academic_programs where official_name like '%(DEV TEST DATA)';`,
  ).catch((e: unknown) => console.log(`  note: could not remove tagged rows (${e instanceof Error ? e.message.slice(0, 120) : e})`));
  const deleted = await managementQuery<{ email: string }[]>(
    target.ref,
    token,
    "delete from auth.users where email like 'seed+%@example.com' returning email",
  );
  // Rows whose owner column is nullable or that hang off a conversation outlive the accounts.
  await managementQuery(
    target.ref,
    token,
    `delete from public.conversations c where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id);
     delete from public.data_requests where user_id is null;`,
  ).catch((e: unknown) => console.log(`  note: could not remove orphaned conversations (${e instanceof Error ? e.message.slice(0, 120) : e})`));
  console.log(`Deleted ${deleted.length} seed accounts (their profiles, posts, comments and likes cascade).`);

  if (file.accounts.length > 0) {
    const idList = file.accounts.map((a) => `'${a.id}'`).join(",");
    const [{ left }] = await managementQuery<{ left: number }[]>(
      target.ref,
      token,
      `select count(*)::int as "left" from storage.objects where (storage.foldername(name))[1] in (${idList})`,
    );
    console.log(`Leftover seed images in storage: ${left}`);
  }
  removeAccountsFile();
  console.log("Removed scripts/.seed-output/accounts.json. Remaining seed rows:");
  console.table(await managementQuery(target.ref, token, COUNT_SQL));
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SeedSafetyError
      ? `\nRefusing to run: ${error.message}`
      : `\nClean failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
