// @vitest-environment node
//
// Applies the real migrations to an in-memory Postgres (PGlite) with minimal stand-ins for
// Supabase's auth and storage schemas, then checks constraints and row level security.
// This validates our SQL and policies. It does NOT replace testing against a real Supabase project.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabaseStubs } from "./helpers";

const migrationsDir = path.resolve(import.meta.dirname, "../migrations");

// The stand-ins for Supabase's auth and storage schemas are shared (see helpers.ts).

let db: PGlite;
const alice = "00000000-0000-0000-0000-00000000000a";
const bob = "00000000-0000-0000-0000-00000000000b";

async function asUser(id: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  await db.exec(id ? "set role authenticated" : "set role anon");
}

async function asAdmin() {
  await db.exec("reset role");
}

async function failure(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
  } catch (error) {
    return (error as Error).message;
  }
  return null;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(supabaseStubs);
  for (const file of readdirSync(migrationsDir).sort()) {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, 'alice@example.com', $2), ($3, 'bob@example.com', $4)",
    [
      alice,
      JSON.stringify({ first_name: "Alice", last_name: "Nguyen" }),
      bob,
      JSON.stringify({ first_name: "Bob" }),
    ],
  );
});

afterAll(async () => {
  await db.close();
});

describe("new user provisioning", () => {
  it("creates a profile and private preferences from signup metadata", async () => {
    await asAdmin();
    const profile = await db.query<{ first_name: string; last_name: string; onboarding_completed: boolean }>(
      "select first_name, last_name, onboarding_completed from public.profiles where id = $1",
      [alice],
    );
    expect(profile.rows[0]).toEqual({ first_name: "Alice", last_name: "Nguyen", onboarding_completed: false });
    const prefs = await db.query("select 1 from public.onboarding_preferences where user_id = $1", [alice]);
    expect(prefs.rows).toHaveLength(1);
  });

  it("never stores email or credentials in the profiles table", async () => {
    await asAdmin();
    const cols = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'",
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).not.toContain("email");
    expect(names.some((n) => /password|token|secret/.test(n))).toBe(false);
  });
});

describe("row level security", () => {
  it("blocks anonymous visitors entirely", async () => {
    await asUser(null);
    expect(await failure("select * from public.profiles")).toMatch(/permission denied/i);
    expect(await failure("select * from public.onboarding_preferences")).toMatch(/permission denied/i);
  });

  it("lets members see their own profile but not an incomplete one belonging to someone else", async () => {
    await asUser(alice);
    const rows = await db.query<{ id: string }>("select id from public.profiles");
    expect(rows.rows.map((r) => r.id)).toEqual([alice]);
  });

  it("shows other members a profile once onboarding is complete", async () => {
    await asAdmin();
    await db.query(
      `update public.profiles set username = 'bob_b', member_type = 'educator', fields = array['nursing'],
         career_stage = 'mid_career', country = 'CA', onboarding_completed = true where id = $1`,
      [bob],
    );
    await asUser(alice);
    const rows = await db.query<{ id: string }>("select id from public.profiles order by id");
    expect(rows.rows.map((r) => r.id)).toEqual([alice, bob]);
  });

  it("does not let a member update someone else's profile", async () => {
    await asUser(alice);
    const result = await db.query("update public.profiles set bio = 'hacked' where id = $1 returning id", [bob]);
    expect(result.rows).toHaveLength(0);
    await asAdmin();
    const bio = await db.query<{ bio: string | null }>("select bio from public.profiles where id = $1", [bob]);
    expect(bio.rows[0].bio).toBeNull();
  });

  it("lets a member update their own profile", async () => {
    await asUser(alice);
    const result = await db.query("update public.profiles set headline = 'Student nurse' where id = $1 returning id", [alice]);
    expect(result.rows).toHaveLength(1);
  });

  it("prevents changing the profile id or reassigning ownership", async () => {
    await asUser(alice);
    expect(await failure("update public.profiles set id = $1 where id = $2", [bob, alice])).toMatch(/permission denied/i);
  });

  it("does not allow members to insert or delete profiles directly", async () => {
    await asUser(alice);
    expect(
      await failure("insert into public.profiles (id, first_name) values (gen_random_uuid(), 'Fake')"),
    ).toMatch(/permission denied/i);
    expect(await failure("delete from public.profiles where id = $1", [alice])).toMatch(/permission denied/i);
  });

  it("keeps onboarding preferences private to their owner", async () => {
    await asUser(alice);
    const rows = await db.query<{ user_id: string }>("select user_id from public.onboarding_preferences");
    expect(rows.rows.map((r) => r.user_id)).toEqual([alice]);
    const update = await db.query("update public.onboarding_preferences set city = 'x' where user_id = $1 returning 1", [bob]);
    expect(update.rows).toHaveLength(0);
  });

  it("exposes no authentication data or provisioning function to members", async () => {
    await asUser(alice);
    expect(await failure("select email from auth.users")).toMatch(/permission denied/i);
    expect(await failure("select private.handle_new_user()")).toMatch(/permission denied/i);
  });
});

describe("constraints", () => {
  it("enforces unique usernames", async () => {
    await asUser(alice);
    expect(await failure("update public.profiles set username = 'bob_b' where id = $1", [alice])).toMatch(/unique/i);
  });

  it("rejects malformed and reserved usernames", async () => {
    await asUser(alice);
    expect(await failure("update public.profiles set username = 'Bad Name' where id = $1", [alice])).toMatch(/profiles_username_format/);
    expect(await failure("update public.profiles set username = 'ab' where id = $1", [alice])).toMatch(/profiles_username_format/);
    expect(await failure("update public.profiles set username = 'admin' where id = $1", [alice])).toMatch(/profiles_username_not_reserved/);
  });

  it("rejects values outside the allowed option lists", async () => {
    await asUser(alice);
    expect(await failure("update public.profiles set member_type = 'wizard' where id = $1", [alice])).toMatch(/member_type_valid/);
    expect(await failure("update public.profiles set fields = array['astrology'] where id = $1", [alice])).toMatch(/fields_valid/);
    expect(await failure("update public.profiles set country = 'canada' where id = $1", [alice])).toMatch(/country_format/);
    expect(await failure("update public.onboarding_preferences set purposes = array['spam'] where user_id = $1", [alice])).toMatch(/purposes_valid/);
  });

  it("will not mark onboarding complete without the essentials", async () => {
    await asUser(alice);
    expect(await failure("update public.profiles set onboarding_completed = true where id = $1", [alice])).toMatch(
      /completed_requires_essentials/,
    );
  });
});

describe("profile system (Phase 3)", () => {
  const carol = "00000000-0000-0000-0000-00000000000c";

  const addEdu = (profileId: string) =>
    db.query(
      "insert into public.profile_education (profile_id, institution, qualification) values ($1, 'McGill', 'BScN') returning id",
      [profileId],
    );

  beforeAll(async () => {
    await asAdmin();
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'carol@example.com', '{}')", [carol]);
  });

  it("keeps /profile/edit and other routes from being taken as usernames", async () => {
    await asUser(alice);
    for (const name of ["edit", "profile", "settings", "new"]) {
      expect(await failure("update public.profiles set username = $1 where id = $2", [name, alice])).toMatch(
        /profiles_username_not_reserved/,
      );
    }
  });

  it("lets owners write the new profile fields and validates them", async () => {
    await asUser(alice);
    const ok = await db.query(
      `update public.profiles set location_label = 'Montreal, QC', professional_journey = 'x', career_aspirations = 'y',
         looking_for_mentorship = true, open_to_mentor = true where id = $1 returning id`,
      [alice],
    );
    expect(ok.rows).toHaveLength(1);
    expect(await failure("update public.profiles set location_label = $1 where id = $2", ["x".repeat(81), alice])).toMatch(
      /location_label_length/,
    );
    expect(await failure("update public.profiles set professional_journey = $1 where id = $2", ["x".repeat(2001), alice])).toMatch(
      /journey_length/,
    );
  });

  it("lets a member add, edit and delete only their own education", async () => {
    await asUser(alice);
    const created = await addEdu(alice);
    const id = (created.rows[0] as { id: string }).id;
    const updated = await db.query("update public.profile_education set qualification = 'MScN' where id = $1 returning id", [id]);
    expect(updated.rows).toHaveLength(1);

    expect(await failure("insert into public.profile_education (profile_id, institution, qualification) values ($1, 'X', 'Y')", [bob])).toMatch(
      /row-level security/i,
    );

    await asUser(bob);
    const hijack = await db.query("update public.profile_education set qualification = 'hacked' where id = $1 returning id", [id]);
    const remove = await db.query("delete from public.profile_education where id = $1 returning id", [id]);
    expect(hijack.rows).toHaveLength(0);
    expect(remove.rows).toHaveLength(0);

    await asUser(alice);
    expect(await failure("update public.profile_education set profile_id = $1 where id = $2", [bob, id])).toMatch(/permission denied/i);
    const gone = await db.query("delete from public.profile_education where id = $1 returning id", [id]);
    expect(gone.rows).toHaveLength(1);
  });

  it("hides rows of members who have not finished onboarding, and shows completed ones", async () => {
    await asAdmin();
    await db.query("insert into public.profile_education (profile_id, institution, qualification) values ($1, 'Hidden U', 'BA')", [carol]);
    await db.query("insert into public.profile_education (profile_id, institution, qualification) values ($1, 'Bob U', 'BA')", [bob]);
    await asUser(alice);
    const rows = await db.query<{ institution: string }>("select institution from public.profile_education order by institution");
    expect(rows.rows.map((r) => r.institution)).toEqual(["Bob U"]);
  });

  it("enforces education year and current-study rules", async () => {
    await asUser(alice);
    expect(await failure("insert into public.profile_education (profile_id, institution, qualification, start_year, end_year) values ($1,'a','b',2020,2019)", [alice])).toMatch(
      /years_ordered/,
    );
    expect(
      await failure("insert into public.profile_education (profile_id, institution, qualification, currently_studying, end_year) values ($1,'a','b',true,2024)", [alice]),
    ).toMatch(/current_has_no_end/);
    expect(await failure("insert into public.profile_education (profile_id, institution, qualification, start_year) values ($1,'a','b',1800)", [alice])).toMatch(
      /start_year_range/,
    );
  });

  it("validates experience type and dates, and keeps it owner-only", async () => {
    await asUser(alice);
    const ok = await db.query(
      "insert into public.profile_experience (profile_id, title, organization, employment_type, start_date, is_current) values ($1,'RN','CHUM','full_time','2024-05-01',true) returning id",
      [alice],
    );
    expect(ok.rows).toHaveLength(1);
    expect(
      await failure("insert into public.profile_experience (profile_id, title, organization, start_date, end_date) values ($1,'a','b','2024-05-01','2023-01-01')", [alice]),
    ).toMatch(/dates_ordered/);
    expect(
      await failure("insert into public.profile_experience (profile_id, title, organization, employment_type, start_date) values ($1,'a','b','pirate','2024-05-01')", [alice]),
    ).toMatch(/type_valid/);
    expect(
      await failure("insert into public.profile_experience (profile_id, title, organization, start_date) values ($1,'a','b','2024-05-01')", [bob]),
    ).toMatch(/row-level security/i);
  });

  it("stores unique, clean skills and blocks edits to other members' lists", async () => {
    await asUser(alice);
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'Active listening', 'skill')", [alice])).toBeNull();
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'active LISTENING', 'skill')", [alice])).toMatch(/unique/i);
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'Active listening', 'interest')", [alice])).toBeNull();
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, ' padded ', 'skill')", [alice])).toMatch(/trimmed/);
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, '<b>x</b>', 'skill')", [alice])).toMatch(/no_markup/);
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'Fine', 'badge')", [alice])).toMatch(/kind_valid/);
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'Impostor', 'skill')", [bob])).toMatch(/row-level security/i);
    expect(await failure("update public.profile_skills set name = 'renamed'")).toMatch(/permission denied/i);
  });

  it("caps how many items one profile can hold", async () => {
    await asUser(alice);
    for (let i = 0; i < 10; i++) {
      await db.query("insert into public.profile_skills (profile_id, name, kind) values ($1, $2, 'mentorship_area')", [alice, `Area ${i}`]);
    }
    expect(await failure("insert into public.profile_skills (profile_id, name, kind) values ($1, 'One too many', 'mentorship_area')", [alice])).toMatch(
      /Limit of 10/,
    );
  });

  it("applies the same folder rules to cover images", async () => {
    await asUser(alice);
    expect(await failure("insert into storage.objects (bucket_id, name) values ('covers', $1)", [`${alice}/c.jpg`])).toBeNull();
    expect(await failure("insert into storage.objects (bucket_id, name) values ('covers', $1)", [`${bob}/c.jpg`])).toMatch(/row-level security/i);
    await asAdmin();
    const bucket = await db.query<{ file_size_limit: string }>("select file_size_limit from storage.buckets where id = 'covers'");
    expect(Number(bucket.rows[0].file_size_limit)).toBe(5242880);
  });

  it("never exposes email through any profile table", async () => {
    await asAdmin();
    const cols = await db.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    // Student verification keeps school-email DOMAINS, keyed hashes and a confirmation time; never an address.
    const allowed = new Set([
      "academic_institutions.email_domains",
      "academic_institutions.email_domains_status",
      "student_verification_requests.email_domain",
      "student_verification_requests.email_verified_at",
      "institutional_email_challenges.email_domain",
      "institutional_email_challenges.email_hash",
    ]);
    expect(
      cols.rows.filter((c) => /email|password|token|secret/i.test(c.column_name) && !allowed.has(`${c.table_name}.${c.column_name}`)),
    ).toEqual([]);
  });
});

describe("avatar storage policies", () => {
  it("allows uploads only inside the member's own folder", async () => {
    await asUser(alice);
    expect(await failure("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${alice}/a.png`])).toBeNull();
    expect(await failure("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${bob}/a.png`])).toMatch(
      /row-level security/i,
    );
  });

  it("limits the bucket size and mime types", async () => {
    await asAdmin();
    const bucket = await db.query<{ file_size_limit: string; allowed_mime_types: string[] }>(
      "select file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'",
    );
    expect(Number(bucket.rows[0].file_size_limit)).toBe(2097152);
    expect(bucket.rows[0].allowed_mime_types).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
});
