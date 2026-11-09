import type { SeedComment, SeedConnection, SeedFollow, SeedLike, SeedMember, SeedPost } from "./plan.ts";

/** SQL string helpers for the privileged content inserts (the Management API takes plain SQL). */

export function literal(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  // Standard conforming strings: only single quotes need escaping.
  return `'${value.replace(/'/g, "''")}'`;
}

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type IdMap = Map<string, string>;

const need = (ids: IdMap, slug: string) => {
  const id = ids.get(slug);
  if (!id) throw new Error(`No account id for ${slug}`);
  return literal(id);
};

/** Idempotent: rows have fixed ids / keys and `on conflict do nothing`. */
export function postStatements(posts: SeedPost[], ids: IdMap): string[] {
  return chunks(posts, 20).map(
    (batch) =>
      `insert into public.posts (id, author_id, category, body, created_at, updated_at, edited_at) values\n` +
      batch
        .map(
          (p) =>
            `(${literal(p.id)}, ${need(ids, p.authorSlug)}, ${literal(p.category)}, ${literal(p.body)}, ` +
            `${literal(p.createdAt)}, ${literal(p.editedAt ?? p.createdAt)}, ${literal(p.editedAt)})`,
        )
        .join(",\n") +
      `\non conflict (id) do nothing;`,
  );
}

export function commentStatements(comments: SeedComment[], ids: IdMap): string[] {
  return chunks(comments, 25).map(
    (batch) =>
      `insert into public.post_comments (id, post_id, author_id, body, created_at) values\n` +
      batch
        .map(
          (c) =>
            `(${literal(c.id)}, ${literal(c.postId)}, ${need(ids, c.authorSlug)}, ${literal(c.body)}, ${literal(c.createdAt)})`,
        )
        .join(",\n") +
      `\non conflict (id) do nothing;`,
  );
}

export function likeStatements(likes: SeedLike[], ids: IdMap): string[] {
  return chunks(likes, 100).map(
    (batch) =>
      `insert into public.post_likes (post_id, user_id, created_at) values\n` +
      batch
        .map((l) => `(${literal(l.postId)}, ${need(ids, l.userSlug)}, ${literal(l.createdAt)})`)
        .join(",\n") +
      `\non conflict (post_id, user_id) do nothing;`,
  );
}

/** Different account ages: profiles.created_at is a public column, so it can be backdated here. */
export function profileAgeStatements(members: SeedMember[], ids: IdMap): string[] {
  return chunks(members, 25).map(
    (batch) =>
      `update public.profiles p set created_at = v.t from (values\n` +
      batch.map((m) => `(${need(ids, m.slug)}::uuid, ${literal(m.profileCreatedAt)}::timestamptz)`).join(",\n") +
      `\n) as v(id, t) where p.id = v.id;`,
  );
}

export function connectionStatements(connections: SeedConnection[], ids: IdMap): string[] {
  return chunks(connections, 25).map(
    (batch) =>
      `insert into public.connections (id, requester_id, addressee_id, status, created_at, accepted_at) values\n` +
      batch
        .map(
          (c) =>
            `(${literal(c.id)}, ${need(ids, c.requesterSlug)}, ${need(ids, c.addresseeSlug)}, ${literal(c.status)}, ` +
            `${literal(c.createdAt)}, ${literal(c.acceptedAt)})`,
        )
        .join(",\n") +
      `\non conflict do nothing;`,
  );
}

export function followStatements(follows: SeedFollow[], ids: IdMap): string[] {
  return chunks(follows, 50).map(
    (batch) =>
      `insert into public.follows (follower_id, followee_id, created_at) values\n` +
      batch.map((f) => `(${need(ids, f.followerSlug)}, ${need(ids, f.followeeSlug)}, ${literal(f.createdAt)})`).join(",\n") +
      `\non conflict do nothing;`,
  );
}

/**
 * The notification triggers fire on these inserts and stamp "now". Give each notification the time
 * of the event it describes, and mark old ones read, so the inbox looks lived-in rather than new.
 */
export const TIDY_NOTIFICATIONS_SQL = `
update public.notifications n
   set created_at = c.created_at,
       read_at = case when c.status = 'accepted' then coalesce(c.accepted_at, c.created_at) else n.read_at end
  from public.connections c
 where n.type = 'connection_request' and n.entity_id = c.id
   and n.recipient_id in (select id from auth.users where email like 'seed+%@example.com');

update public.notifications n
   set created_at = t.first_at,
       read_at = case when t.first_at < now() - interval '14 days' then t.first_at + interval '1 hour' else n.read_at end
  from (
    select n2.id, (select min(pc.created_at) from public.post_comments pc
                    where pc.post_id = n2.entity_id and pc.author_id = n2.actor_id) as first_at
      from public.notifications n2
     where n2.type in ('post_comment', 'comment_reply')
       and n2.recipient_id in (select id from auth.users where email like 'seed+%@example.com')
  ) t
 where n.id = t.id and t.first_at is not null;
`;

let lastCall = 0;

/** Management API: run SQL on the project with a scoped personal access token. */
export async function managementQuery<T = unknown>(
  ref: string,
  token: string,
  query: string,
): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    // The Management API throttles bursts: keep a steady pace.
    const wait = 450 - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (response.ok) return (await response.json()) as T;
    if (response.status === 429 || response.status >= 500) {
      last = `${response.status} ${(await response.text()).slice(0, 300)}`;
      await new Promise((r) => setTimeout(r, response.status === 429 ? 5000 * (attempt + 1) : 2000 * (attempt + 1)));
      continue;
    }
    // Never echo the token; the server's message is about the SQL, not the credentials.
    throw new Error(`Management API ${response.status}: ${(await response.text()).slice(0, 4000)}`);
  }
  throw new Error(`Management API kept failing after several attempts (last: ${last}).`);
}

/** Row counts for the seed accounts only (matched by the fictional email pattern). */
export const COUNT_SQL = `
select
  (select count(*) from auth.users where email like 'seed+%@example.com')::int as accounts,
  (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email like 'seed+%@example.com' and p.onboarding_completed)::int as completed_profiles,
  (select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email like 'seed+%@example.com' and not p.onboarding_completed)::int as incomplete_profiles,
  (select count(*) from public.profile_education e join auth.users u on u.id = e.profile_id where u.email like 'seed+%@example.com')::int as education,
  (select count(*) from public.profile_experience e join auth.users u on u.id = e.profile_id where u.email like 'seed+%@example.com')::int as experience,
  (select count(*) from public.profile_skills s join auth.users u on u.id = s.profile_id where u.email like 'seed+%@example.com')::int as tags,
  (select count(*) from public.posts p join auth.users u on u.id = p.author_id where u.email like 'seed+%@example.com')::int as posts,
  (select count(*) from public.post_comments c join auth.users u on u.id = c.author_id where u.email like 'seed+%@example.com')::int as comments,
  (select count(*) from public.post_likes l join auth.users u on u.id = l.user_id where u.email like 'seed+%@example.com')::int as likes,
  (select count(*) from public.connections c join auth.users u on u.id = c.requester_id where u.email like 'seed+%@example.com')::int as connections,
  (select count(*) from public.connections c join auth.users u on u.id = c.requester_id where u.email like 'seed+%@example.com' and c.status = 'accepted')::int as accepted_connections,
  (select count(*) from public.follows f join auth.users u on u.id = f.follower_id where u.email like 'seed+%@example.com')::int as follows,
  (select count(*) from storage.objects o join auth.users u on (storage.foldername(o.name))[1] = u.id::text where u.email like 'seed+%@example.com')::int as images
`;
