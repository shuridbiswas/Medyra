/**
 * Checks the seeded dev data against the plan and exercises permissions as two real seeded
 * members through the public APIs (the same path the app uses).
 *   npm run seed:verify
 */
import { memberClient, readAccounts, signIn } from "./api.ts";
import { buildModules } from "./modules.ts";
import { buildPlan, describePlan, HEAVY_POSTER } from "./plan.ts";
import { assertDevOnly, loadEnvironment, requireManagementToken, SeedSafetyError } from "./safety.ts";
import { COUNT_SQL, managementQuery } from "./sql.ts";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
}

const OTHER_MEMBER = "sarah_mitchell";

async function main() {
  const env = loadEnvironment();
  const target = assertDevOnly(env);
  const token = requireManagementToken(env);
  const plan = buildPlan();
  const summary = describePlan(plan);
  const modules = buildModules(plan, new Date());

  // --- 1. counts match the plan -------------------------------------------------------------
  const [counts] = await managementQuery<Record<string, number>[]>(target.ref, token, COUNT_SQL);
  const expected = {
    accounts: plan.members.length,
    completed_profiles: summary.completed,
    incomplete_profiles: summary.incomplete,
    education: summary.education,
    experience: summary.experience,
    tags: summary.tags,
    posts: plan.posts.length + modules.communityPosts.length,
    comments: plan.comments.length,
    likes: plan.likes.length,
    connections: plan.connections.length,
    accepted_connections: summary.acceptedConnections,
    follows: plan.follows.length,
    images: summary.avatars + summary.covers,
  };
  for (const [key, value] of Object.entries(expected)) {
    check(`${key}: database ${counts[key]} = plan ${value}`, counts[key] === value, `got ${counts[key]}`);
  }
  const [questions] = await managementQuery<{ n: number }[]>(
    target.ref,
    token,
    `select count(*)::int as n from public.posts p join auth.users u on u.id = p.author_id
      where u.email like 'seed+%@example.com' and p.category = 'questions'`,
  );
  const expectedQuestions = summary.questions + modules.communityPosts.filter((p) => p.category === "questions").length;
  check(`question posts (feed + community): database ${questions.n} = plan ${expectedQuestions}`, questions.n === expectedQuestions);

  // --- 1b. module counts (a reply may have been removed by the staff decision) ---------------------
  const [mc] = await managementQuery<Record<string, number>[]>(
    target.ref,
    token,
    `select (select count(*) from public.communities where slug like 'seed-%')::int communities,
       (select count(*) from public.community_members m join public.communities c on c.id = m.community_id where c.slug like 'seed-%')::int community_members,
       (select count(*) from public.forum_questions)::int questions, (select count(*) from public.forum_answers)::int answers,
       (select count(*) from public.forum_replies)::int replies, (select count(*) from public.forum_votes)::int votes,
       (select count(*) from public.mentor_profiles)::int mentors, (select count(*) from public.mentorship_requests)::int mentor_requests,
       (select count(*) from public.mentorships)::int mentorships, (select count(*) from public.conversations)::int conversations,
       (select count(*) from public.messages)::int messages, (select count(*) from public.reports)::int reports,
       (select count(*) from public.audit_logs)::int audit_rows, (select count(*) from public.student_verified_credentials)::int credentials`,
  );
  console.log(`  module counts: ${JSON.stringify(mc)}`);
  check("communities: database = plan", mc.communities === modules.communities.length, `${mc.communities}`);
  check("forum questions: database = plan", mc.questions === modules.forumQuestions.length, `${mc.questions}`);
  check("forum answers: database = plan", mc.answers === modules.forumAnswers.length, `${mc.answers}`);
  check("forum replies: plan minus at most one removed by staff", mc.replies >= modules.forumReplies.length - 1 && mc.replies <= modules.forumReplies.length, `${mc.replies}`);
  check("mentor profiles: database = plan", mc.mentors === modules.mentors.length, `${mc.mentors}`);
  check("mentorship requests: database = plan", mc.mentor_requests === modules.mentorRequests.length, `${mc.mentor_requests}`);
  check("conversations created (direct + groups + accepted mentorships)", mc.conversations >= modules.dms.length + modules.groups.length, `${mc.conversations}`);
  check("staff actions wrote audit rows through the functions", mc.audit_rows > 0, `${mc.audit_rows}`);
  check("student verification credentials exist (dev fixtures)", mc.credentials > 0, `${mc.credentials}`);

  // --- 2. integrity: orphans and duplicates --------------------------------------------------
  const [integrity] = await managementQuery<Record<string, number>[]>(
    target.ref,
    token,
    `select
      (select count(*) from public.post_comments c left join public.posts p on p.id = c.post_id where p.id is null)::int as orphan_comments,
      (select count(*) from public.post_likes l left join public.posts p on p.id = l.post_id where p.id is null)::int as orphan_likes,
      (select count(*) from public.posts p left join public.profiles f on f.id = p.author_id where f.id is null)::int as orphan_posts,
      (select count(*) from public.profile_skills s left join public.profiles f on f.id = s.profile_id where f.id is null)::int as orphan_skills,
      (select count(*) from public.connections c left join public.profiles f on f.id = c.addressee_id where f.id is null)::int as orphan_connections,
      (select count(*) from storage.objects o left join auth.users u on (storage.foldername(o.name))[1] = u.id::text
        where o.bucket_id in ('avatars','covers') and u.id is null)::int as orphan_images,
      (select count(*) - count(distinct lower(username)) from public.profiles where username is not null)::int as duplicate_usernames,
      (select count(*) from public.posts where created_at > now())::int as future_posts`,
  );
  for (const [key, value] of Object.entries(integrity)) check(`${key} = 0`, value === 0, `got ${value}`);

  // --- 3. permissions as two seeded members ---------------------------------------------------
  const file = readAccounts(target.ref);
  const find = (slug: string) => file.accounts.find((a) => a.slug === slug);
  const aAccount = find(HEAVY_POSTER);
  const bAccount = find(OTHER_MEMBER);
  if (!aAccount || !bAccount) throw new Error("accounts.json does not contain the verification accounts. Run seed:dev first.");
  const aSession = await signIn(target, aAccount.email, aAccount.password);
  const bSession = await signIn(target, bAccount.email, bAccount.password);
  if (!aSession || !bSession) throw new Error("Could not sign in as the verification accounts.");
  const A = memberClient(target, aSession.token);
  const B = memberClient(target, bSession.token);

  const aPosts = plan.posts.filter((p) => p.authorSlug === HEAVY_POSTER);
  const countOf = (headers: Headers) => Number(/\/(\d+)$/.exec(headers.get("content-range") ?? "")?.[1] ?? -1);

  const seen = await B.rest<unknown[]>("GET", "posts", {
    params: { author_id: `eq.${aSession.id}`, select: "id", limit: "1" },
    prefer: "count=exact",
  });
  check("B reads all of A's posts", countOf(seen.headers) === aPosts.length, `count ${countOf(seen.headers)}`);

  const target1 = aPosts[0];
  const upd = await B.rest<unknown[]>("PATCH", "posts", {
    params: { id: `eq.${target1.id}` },
    body: { body: "hijacked" },
    prefer: "return=representation",
  });
  check("B cannot edit A's post (0 rows)", upd.status === 200 && upd.json.length === 0, JSON.stringify(upd.json).slice(0, 100));
  const del = await B.rest<unknown[]>("DELETE", "posts", {
    params: { id: `eq.${target1.id}` },
    prefer: "return=representation",
  });
  check("B cannot delete A's post (0 rows)", del.status === 200 && del.json.length === 0);
  const spoof = await B.rest("POST", "posts", {
    body: { author_id: aSession.id, category: "questions", body: "spoof" },
  });
  check("B cannot publish as A", spoof.status === 401 || spoof.status === 403, `HTTP ${spoof.status}`);
  const delComment = plan.comments.find((c) => c.authorSlug !== OTHER_MEMBER);
  if (delComment) {
    const r = await B.rest<unknown[]>("DELETE", "post_comments", {
      params: { id: `eq.${delComment.id}` },
      prefer: "return=representation",
    });
    check("B cannot delete someone else's comment (0 rows)", r.status === 200 && r.json.length === 0);
  }
  const stillThere = await A.rest<{ body: string }[]>("GET", "posts", {
    params: { id: `eq.${target1.id}`, select: "body" },
  });
  check("A's post is unchanged after B's attempts", stillThere.json[0]?.body === target1.body);

  // Incomplete profiles are hidden until onboarding is done.
  const incomplete = plan.members.filter((m) => !m.complete).map((m) => m.email);
  const incompleteIds = await managementQuery<{ id: string }[]>(
    target.ref,
    token,
    `select id from auth.users where email in (${incomplete.map((e) => `'${e}'`).join(",")})`,
  );
  const hidden = await B.rest<unknown[]>("GET", "profiles", {
    params: { id: `in.(${incompleteIds.map((r) => r.id).join(",")})`, select: "id" },
  });
  check("incomplete profiles are invisible to other members", hidden.status === 200 && hidden.json.length === 0, JSON.stringify(hidden.json).slice(0, 100));
  const listed = await B.rest<{ id: string }[]>("GET", "profiles", {
    params: { select: "id", onboarding_completed: "eq.false" },
  });
  check("B cannot list any incomplete profile", listed.status === 200 && listed.json.length === 0, `${listed.json.length} visible`);

  // Anonymity, private communities and private messages as another member.
  const anonQ = await B.rest<{ author_id: string | null }[]>("GET", "forum_questions", { params: { is_anonymous: "eq.true", select: "author_id", limit: "1000" } });
  check("anonymous questions expose no author (author_id is null for every row)", anonQ.status === 200 && anonQ.json.length > 0 && anonQ.json.every((r) => r.author_id === null), `${anonQ.json.length} rows`);
  const identity = await B.rest<{ author_id: string }[]>("GET", "forum_identity", { params: { select: "author_id", limit: "1000" } });
  check("forum_identity shows a member only their own rows", identity.status === 200 && identity.json.every((r) => r.author_id === bSession.id), `${identity.json.length} rows`);
  const privateCommunity = modules.communities.find((c) => c.visibility === "private" && !c.members.includes(OTHER_MEMBER) && c.owner !== OTHER_MEMBER && !c.moderators.includes(OTHER_MEMBER));
  if (privateCommunity) {
    const hiddenPosts = await B.rest<unknown[]>("GET", "posts", {
      params: { select: "id", community_id: `eq.${(await managementQuery<{ id: string }[]>(target.ref, token, `select id from public.communities where slug = '${privateCommunity.slug}'`))[0].id}` },
    });
    check(`posts of the private community ${privateCommunity.slug} are invisible to a non-member`, hiddenPosts.status === 200 && hiddenPosts.json.length === 0, `${hiddenPosts.json.length} visible`);
  }
  const mine = await B.rest<{ id: string }[]>("GET", "messages", { params: { select: "id", limit: "5000" } });
  const [expectedMine] = await managementQuery<{ n: number }[]>(
    target.ref, token,
    `select count(*)::int n from public.messages m where exists (select 1 from public.conversation_participants p where p.conversation_id = m.conversation_id and p.user_id = '${bSession.id}' and p.status <> 'declined')`,
  );
  check("messages: a member sees only messages from their own conversations", mine.status === 200 && mine.json.length === expectedMine.n, `${mine.json.length} vs ${expectedMine.n}`);
  const restrictedSlug = modules.restricted.find((slug) => !plan.connections.some((c) => c.status === "accepted" && [c.requesterSlug, c.addresseeSlug].includes(slug) && [c.requesterSlug, c.addresseeSlug].includes(OTHER_MEMBER)) && slug !== OTHER_MEMBER);
  const restricted = restrictedSlug ? find(restrictedSlug) : undefined;
  if (restricted) {
    const rid = (await managementQuery<{ id: string }[]>(target.ref, token, `select id from auth.users where email = '${restricted.email}'`))[0].id;
    const edu = await B.rest<unknown[]>("GET", "profile_education", { params: { profile_id: `eq.${rid}`, select: "id" } });
    check(`restricted profile (${restrictedSlug}): education hidden from a non-connection`, edu.status === 200 && edu.json.length === 0, `${edu.json.length} rows`);
  }

  // Anonymous access is blocked.
  for (const table of ["profiles", "posts", "post_comments", "post_likes", "connections", "follows"]) {
    const response = await fetch(`${target.url}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: target.publishableKey, Authorization: `Bearer ${target.publishableKey}` },
    });
    const body = (await response.json().catch(() => null)) as unknown;
    check(`anonymous cannot read ${table}`, response.status >= 400 || (Array.isArray(body) && body.length === 0), `HTTP ${response.status}`);
  }

  // Pending connections are private to the two people.
  const visibleConnections = await B.rest<{ requester_id: string; addressee_id: string; status: string }[]>("GET", "connections", {
    params: { select: "requester_id,addressee_id,status", limit: "1000" },
  });
  const leaked = visibleConnections.json.filter(
    (c) => c.status === "pending" && c.requester_id !== bSession.id && c.addressee_id !== bSession.id,
  );
  check("B sees no pending connections between other members", visibleConnections.status === 200 && leaked.length === 0, `${leaked.length} leaked`);
  check(
    "B sees the accepted connections",
    visibleConnections.json.filter((c) => c.status === "accepted").length === summary.acceptedConnections,
    `${visibleConnections.json.filter((c) => c.status === "accepted").length} accepted visible`,
  );

  // --- keyset pagination exactly as the app does it ------------------------------------------
  const ids: string[] = [];
  let cursor: { created_at: string; id: string } | null = null;
  const sizes: number[] = [];
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = {
      select: "id,created_at",
      author_id: `eq.${aSession.id}`,
      order: "created_at.desc,id.desc",
      limit: "15",
    };
    if (cursor) {
      params.or = `(created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id}))`;
    }
    const r: { json: { id: string; created_at: string }[] } = await B.rest<{ id: string; created_at: string }[]>("GET", "posts", { params });
    sizes.push(r.json.length);
    ids.push(...r.json.map((p) => p.id));
    if (r.json.length < 15) break;
    cursor = r.json[r.json.length - 1];
  }
  check(
    `pagination: pages of ${sizes.join(", ")} cover all ${aPosts.length} posts without duplicates`,
    ids.length === aPosts.length && new Set(ids).size === ids.length && sizes.slice(0, -1).every((s) => s === 15),
    `${ids.length} ids, ${new Set(ids).size} unique`,
  );

  // --- counts on a post match the plan --------------------------------------------------------
  const engaged = plan.posts.find(
    (p) => plan.likes.filter((l) => l.postId === p.id).length >= 5 && plan.comments.some((c) => c.postId === p.id),
  )!;
  const counts2 = await B.rest<{ likes: { count: number }[]; comments: { count: number }[] }[]>("GET", "posts", {
    params: { id: `eq.${engaged.id}`, select: "likes:post_likes(count),comments:post_comments(count)" },
  });
  check(
    "like and comment counts on a post match the plan",
    counts2.json[0]?.likes?.[0]?.count === plan.likes.filter((l) => l.postId === engaged.id).length &&
      counts2.json[0]?.comments?.[0]?.count === plan.comments.filter((c) => c.postId === engaged.id).length,
    JSON.stringify(counts2.json),
  );

  // --- search (same filters the app uses) -------------------------------------------------------
  const searchName = async (term: string) =>
    (
      await B.rest<{ username: string }[]>("GET", "profiles", {
        params: { select: "username", or: `(username.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%)`, onboarding_completed: "eq.true" },
      })
    ).json.map((p) => p.username);
  check("search 'Lévesque' (with accent) finds Jonathan Lévesque", (await searchName("Lévesque")).includes("jonathan_levesque"));
  check("search 'levesque' (without accent) finds him through the username", (await searchName("levesque")).includes("jonathan_levesque"));
  check("search 'Ramírez' (accented first name) finds Sofía Ramírez", (await searchName("Ramírez")).includes("sofia_ramirez"));
  check("search by first name 'Camille' finds the heavy poster", (await searchName("Camille")).includes(HEAVY_POSTER));
  const byField = await B.rest<{ username: string }[]>("GET", "profiles", {
    params: { select: "username", fields: "cs.{psychology}", onboarding_completed: "eq.true" },
  });
  const psychologyExpected = plan.members.filter((m) => m.complete && m.fields.includes("psychology")).length;
  check("search by field finds every psychology member", byField.json.length === psychologyExpected, `${byField.json.length} of ${psychologyExpected}`);
  const mentors = await B.rest<{ username: string }[]>("GET", "profiles", {
    params: { select: "username", open_to_mentor: "eq.true", onboarding_completed: "eq.true" },
  });
  check(`mentor filter finds the ${summary.openToMentor} members open to mentoring`, mentors.json.length === summary.openToMentor, `${mentors.json.length} found`);
  const montreal = await B.rest<{ username: string }[]>("GET", "profiles", {
    params: { select: "username", location_label: "ilike.%Montréal%", onboarding_completed: "eq.true" },
  });
  check("location filter 'Montréal' finds Montréal members", montreal.json.length === plan.members.filter((m) => m.complete && m.cityKey === "Montréal").length, `${montreal.json.length}`);

  // --- images load ----------------------------------------------------------------------------
  const withAvatar = await A.rest<{ avatar_path: string | null }[]>("GET", "profiles", {
    params: { select: "avatar_path", id: `eq.${aSession.id}` },
  });
  const avatarPath = withAvatar.json[0]?.avatar_path;
  if (avatarPath) {
    const image = await fetch(`${target.url}/storage/v1/object/public/avatars/${avatarPath}`);
    check("A's avatar loads from its public URL as a PNG", image.status === 200 && image.headers.get("content-type") === "image/png", `HTTP ${image.status}`);
  } else {
    console.log("SKIP  A has no avatar in this plan");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SeedSafetyError
      ? `\nRefusing to run: ${error.message}`
      : `\nVerify failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
