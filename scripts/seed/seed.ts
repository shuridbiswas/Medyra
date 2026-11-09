/**
 * DEVELOPMENT-ONLY seed tool. Usage:
 *   npm run seed:dev -- --dry-run     print the plan, write nothing
 *   npm run seed:dev                  create the fictional data in the allowed dev project
 *
 * Accounts are created through the Auth API; profile data is written AS each member (row level
 * security applies); backdated posts, comments and likes are inserted with SQL through the
 * Management API using a scoped token from SUPABASE_ACCESS_TOKEN. Nothing secret is printed.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  memberClient,
  readAccounts,
  signIn,
  signUp,
  writeAccounts,
  type Session,
  type StoredAccount,
} from "./api.ts";
import { spawnSync } from "node:child_process";
import { buildModules, runModules, validateModules } from "./modules.ts";
import { buildPlan, describePlan, validatePlan, type SeedMember } from "./plan.ts";
import { avatarPng, coverPng } from "./png.ts";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import {
  COUNT_SQL, commentStatements, connectionStatements, followStatements, likeStatements, managementQuery,
  postStatements, profileAgeStatements, TIDY_NOTIFICATIONS_SQL,
} from "./sql.ts";

const dryRun = process.argv.includes("--dry-run");
const log = (message: string) => console.log(message);

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const now = new Date();
  const plan = buildPlan(now);
  const problems = validatePlan(plan, now);
  if (problems.length > 0) {
    throw new Error(`The generated plan breaks database rules:\n- ${problems.slice(0, 15).join("\n- ")}`);
  }

  log(`Target project: ${target.ref} (allowed by SEED_ALLOWED_PROJECT_REF)`);
  log("Plan:");
  console.log(JSON.stringify(describePlan(plan), null, 2));

  if (dryRun) {
    log("\nDry run. Members that would be created (emails are fictional, passwords are generated at run time):");
    console.table(
      plan.members.map((m) => ({
        slug: m.slug,
        name: `${m.firstName} ${m.lastName}`.slice(0, 40),
        lang: m.lang,
        city: m.cityKey,
        type: m.memberType,
        fields: m.fields.join(","),
        complete: m.complete,
        mentor: m.openToMentor,
        avatar: m.avatar,
        cover: m.cover,
      })),
    );
    log("Nothing was written. Run without --dry-run to seed.");
    return;
  }

  const token = requireManagementToken(env);

  // Resume after an interrupted run without signing 100 accounts in again (sign-in is rate limited).
  if (process.argv.includes("--modules-only")) {
    const rows = await managementQuery<{ id: string; email: string }[]>(target.ref, token, "select id, lower(email) as email from auth.users where email like 'seed+%@example.com'");
    const byEmail = new Map(rows.map((r) => [r.email, r.id]));
    const ids = new Map(plan.members.map((m) => [m.slug, byEmail.get(m.email)!]));
    if (plan.members.some((m) => !ids.get(m.slug))) throw new Error("Some seed accounts are missing. Run the full seed first.");
    console.table(await runModules({ ref: target.ref, token, ids, mod: buildModules(plan, now), plan, log }));
    return;
  }

  // ---------------------------------------------------------------------------- 1. accounts
  log("\n1/4 Creating accounts through the Auth API (existing seed accounts are reused)…");
  const stored = readAccounts(target.ref);
  const byEmail = new Map(stored.accounts.map((a) => [a.email, a]));
  const sessions = new Map<string, Session>();
  const ids = new Map<string, string>();
  let created = 0;
  let reused = 0;
  let unreachable = 0;

  for (const member of plan.members) {
    const known = byEmail.get(member.email);
    if (known) {
      const session = await signIn(target, known.email, known.password);
      if (session) {
        sessions.set(member.slug, session);
        ids.set(member.slug, session.id);
        reused++;
        continue;
      }
    }
    const password = `${randomBytes(18).toString("base64url")}aA1`;
    const result = await signUp(target, {
      email: member.email,
      password,
      firstName: member.firstName,
      lastName: member.lastName,
    });
    if (result.kind === "created") {
      const account: StoredAccount = {
        slug: member.slug,
        email: member.email,
        password,
        username: member.username,
        id: result.session.id,
      };
      byEmail.set(member.email, account);
      sessions.set(member.slug, result.session);
      ids.set(member.slug, result.session.id);
      created++;
      // Persist after every account so an interrupted run never loses a generated password.
      writeAccounts({ project: target.ref, accounts: [...byEmail.values()] });
    } else if (result.kind === "needs-confirmation") {
      throw new Error("The project requires email confirmation. Turn it off in the dev project (see TESTING.md).");
    } else {
      unreachable++;
      log(`  ${member.slug}: account exists but its password is not in accounts.json; content only`);
    }
  }
  log(`  created ${created}, reused ${reused}, content-only ${unreachable}`);

  // Accounts we cannot sign in as still need their real ids for content.
  const missing = plan.members.filter((m) => !ids.has(m.slug));
  if (missing.length > 0) {
    const emails = missing.map((m) => `'${m.email}'`).join(",");
    const rows = await managementQuery<{ id: string; email: string }[]>(
      target.ref,
      token,
      `select id, email from auth.users where email in (${emails})`,
    );
    for (const row of rows) {
      const member = missing.find((m) => m.email === row.email);
      if (member) ids.set(member.slug, row.id);
    }
  }
  for (const member of plan.members) {
    if (!ids.has(member.slug)) throw new Error(`No account id for ${member.slug}`);
  }

  // ---------------------------------------------------------------------------- 2. profiles
  log("\n2/4 Writing profiles, images and profile sections as each member…");
  let imageCount = 0;
  for (const [index, member] of plan.members.entries()) {
    const session = sessions.get(member.slug);
    if (!session) continue;
    imageCount += await seedMember(target, member, session, index);
  }
  log(`  uploaded ${imageCount} new images`);

  // ---------------------------------------------------------------------------- 3. content
  log("\n3/4 Inserting backdated posts, comments, likes and network rows (privileged SQL, real account ids)…");
  for (const sql of profileAgeStatements(plan.members, ids)) await managementQuery(target.ref, token, sql);
  for (const sql of postStatements(plan.posts, ids)) await managementQuery(target.ref, token, sql);
  for (const sql of commentStatements(plan.comments, ids)) await managementQuery(target.ref, token, sql);
  for (const sql of likeStatements(plan.likes, ids)) await managementQuery(target.ref, token, sql);
  for (const sql of connectionStatements(plan.connections, ids)) await managementQuery(target.ref, token, sql);
  for (const sql of followStatements(plan.follows, ids)) await managementQuery(target.ref, token, sql);
  await managementQuery(target.ref, token, TIDY_NOTIFICATIONS_SQL);

  // ---------------------------------------------------------------------------- 4. summary
  log("\n3b/4 Communities, forums, mentorship, messaging, moderation (real database functions, backdated)…");
  const modules = buildModules(plan, now);
  const moduleProblems = validateModules(modules);
  if (moduleProblems.length > 0) throw new Error(`Module plan breaks database rules:\n- ${moduleProblems.slice(0, 10).join("\n- ")}`);
  console.table(await runModules({ ref: target.ref, token, ids, mod: modules, plan, log }));
  log("  student verification scenarios (dev fixtures labelled [DEV TEST DATA])…");
  const fixtures = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/seed/verification.ts"], { env: process.env, encoding: "utf8" });
  log(fixtures.status === 0 ? `  ${fixtures.stdout.split("\n")[0]}` : `  verification fixtures skipped: ${(fixtures.stderr || fixtures.stdout).slice(0, 200)}`);

  log("\n4/4 Row counts in the database for seed accounts:");
  const counts = await managementQuery<Record<string, number>[]>(target.ref, token, COUNT_SQL);
  console.table(counts);
  log("Accounts and generated passwords are in scripts/.seed-output/accounts.json (git-ignored).");
  log("Log in at /login with any seed+<username>@example.com address and its password from that file.");
}


/** Returns the number of images uploaded. All writes happen with the member's own session. */
async function seedMember(
  target: Parameters<typeof memberClient>[0],
  member: SeedMember,
  session: Session,
  index: number,
): Promise<number> {
  const client = memberClient(target, session.token);
  let images = 0;

  const current = await client.rest<{ avatar_path: string | null; cover_path: string | null }[]>("GET", "profiles", {
    params: { id: `eq.${session.id}`, select: "avatar_path,cover_path" },
  });
  const existing = current.json[0] ?? { avatar_path: null, cover_path: null };

  let avatarPath = existing.avatar_path;
  let coverPath = existing.cover_path;
  if (member.avatar && !avatarPath) {
    const objectPath = `${session.id}/${randomUUID()}.png`;
    if ((await client.upload("avatars", objectPath, avatarPng(index), "image/png")) === 200) {
      avatarPath = objectPath;
      images++;
    }
  }
  if (member.cover && !coverPath) {
    const objectPath = `${session.id}/${randomUUID()}.png`;
    if ((await client.upload("covers", objectPath, coverPng(index), "image/png")) === 200) {
      coverPath = objectPath;
      images++;
    }
  }

  const body: Record<string, unknown> = member.complete
    ? {
        username: member.username,
        headline: member.headline,
        bio: member.bio,
        member_type: member.memberType,
        fields: member.fields,
        institution: member.institution,
        qualification: member.qualification,
        specialty: member.specialty,
        career_stage: member.careerStage,
        country: member.country,
        location_label: member.locationLabel,
        professional_journey: member.journey,
        career_aspirations: member.aspirations,
        looking_for_mentorship: member.lookingForMentorship,
        open_to_mentor: member.openToMentor,
        avatar_path: avatarPath,
        cover_path: coverPath,
        onboarding_completed: true,
      }
    : member.headline
      ? { headline: member.headline }
      : {};

  if (Object.keys(body).length > 0) {
    const result = await client.rest<unknown[]>("PATCH", "profiles", {
      params: { id: `eq.${session.id}` },
      body,
      prefer: "return=representation",
    });
    if (result.status !== 200 || result.json.length !== 1) {
      throw new Error(`Profile update failed for ${member.slug}: HTTP ${result.status} ${JSON.stringify(result.json).slice(0, 300)}`);
    }
  }

  if (member.complete) {
    await client.rest("PATCH", "onboarding_preferences", {
      params: { user_id: `eq.${session.id}` },
      body: { purposes: member.purposes, city: member.city },
    });
  }

  // Child rows: skip a section that already has rows, so reruns never duplicate anything.
  const hasRows = async (table: string) => {
    const r = await client.rest<unknown[]>("GET", table, {
      params: { profile_id: `eq.${session.id}`, select: "id", limit: "1" },
    });
    return Array.isArray(r.json) && r.json.length > 0;
  };
  const insert = async (table: string, rows: object[]) => {
    if (rows.length === 0 || (await hasRows(table))) return;
    const r = await client.rest("POST", table, {
      body: rows.map((row) => ({ ...row, profile_id: session.id })),
      prefer: "return=minimal",
    });
    if (r.status !== 201) {
      throw new Error(`Insert into ${table} failed for ${member.slug}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    }
  };
  await insert("profile_education", member.education);
  await insert("profile_experience", member.experience);
  await insert("profile_skills", member.tags);
  return images;
}

main().catch((error: unknown) => {
  if (error instanceof SeedSafetyError) {
    console.error(`\nRefusing to run: ${error.message}`);
  } else {
    console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
